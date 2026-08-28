use super::{path_string, write_markdown};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::{header::LOCATION, redirect::Policy, Client, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs},
    path::{Path, PathBuf},
    time::Duration,
};

const PASTED_IMAGE_SCHEME: &str = "lightmark-paste-image://";
const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 100 * 1024 * 1024;
const MAX_IMAGE_COUNT: usize = 50;
const MAX_REDIRECTS: usize = 5;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PastedImageInput {
    id: String,
    source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePastedImagesResult {
    contents: String,
    saved_image_count: usize,
    reused_image_count: usize,
    asset_directory: String,
}

struct DownloadedImage {
    placeholder: String,
    bytes: Vec<u8>,
    extension: &'static str,
    digest: String,
}

fn valid_image_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.starts_with(b"BM") {
        Some("bmp")
    } else {
        None
    }
}

fn decode_data_image(source: &str) -> Result<Vec<u8>, String> {
    let (metadata, payload) = source.split_once(',').ok_or("剪贴板内嵌图片格式不完整。")?;
    let metadata = metadata.to_ascii_lowercase();
    if !matches!(
        metadata.as_str(),
        "data:image/png;base64"
            | "data:image/jpeg;base64"
            | "data:image/jpg;base64"
            | "data:image/webp;base64"
            | "data:image/gif;base64"
            | "data:image/bmp;base64"
    ) {
        return Err("只支持 Base64 编码的 PNG、JPG、WebP、GIF 或 BMP 剪贴板图片。".into());
    }
    if payload.len() > (MAX_IMAGE_BYTES * 4 / 3) + 16 {
        return Err("粘贴图片超过 25 MB，未保存。".into());
    }
    STANDARD
        .decode(payload)
        .map_err(|_| "剪贴板内嵌图片 Base64 数据损坏。".to_string())
}

fn unsafe_ipv4(address: Ipv4Addr) -> bool {
    let [a, b, _, _] = address.octets();
    address.is_private()
        || address.is_loopback()
        || address.is_link_local()
        || address.is_multicast()
        || address.is_broadcast()
        || address.is_unspecified()
        || a == 0
        || (a == 100 && (64..=127).contains(&b))
        || (a == 192 && b == 0)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 192 && b == 0 && address.octets()[2] == 2)
        || (a == 198 && b == 51 && address.octets()[2] == 100)
        || (a == 203 && b == 0 && address.octets()[2] == 113)
        || a >= 240
}

fn unsafe_ipv6(address: Ipv6Addr) -> bool {
    if let Some(mapped) = address.to_ipv4_mapped() {
        return unsafe_ipv4(mapped);
    }
    let first = address.segments()[0];
    address.is_loopback()
        || address.is_unspecified()
        || address.is_multicast()
        || (first & 0xfe00) == 0xfc00
        || (first & 0xffc0) == 0xfe80
}

fn unsafe_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => unsafe_ipv4(address),
        IpAddr::V6(address) => unsafe_ipv6(address),
    }
}

fn validated_addresses(url: &Url) -> Result<(String, Vec<SocketAddr>), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("图片地址只允许使用 HTTP 或 HTTPS。".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("图片地址不能包含用户名或密码。".into());
    }
    let host = url.host_str().ok_or("图片地址没有有效域名。")?.to_owned();
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") {
        return Err("为了安全，不能从本机或内网地址下载粘贴图片。".into());
    }
    let port = url.port_or_known_default().ok_or("图片地址端口无效。")?;
    let addresses = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|error| format!("无法解析图片域名：{error}"))?
        .collect::<Vec<_>>();
    if addresses.is_empty() || addresses.iter().any(|address| unsafe_ip(address.ip())) {
        return Err("为了安全，不能从本机或内网地址下载粘贴图片。".into());
    }
    Ok((host, addresses))
}

fn client_for(url: &Url) -> Result<Client, String> {
    let (host, addresses) = validated_addresses(url)?;
    let mut builder = Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30));
    for address in addresses {
        builder = builder.resolve(&host, address);
    }
    builder
        .build()
        .map_err(|error| format!("无法建立图片下载连接：{error}"))
}

async fn download_remote_image(source: &str) -> Result<Vec<u8>, String> {
    let mut url = Url::parse(source).map_err(|_| "粘贴图片地址无效。".to_string())?;
    for redirect_index in 0..=MAX_REDIRECTS {
        let client = client_for(&url)?;
        let mut response = client
            .get(url.clone())
            .header("User-Agent", "LightMark/0.5 pasted-image-saver")
            .send()
            .await
            .map_err(|error| format!("图片下载失败：{error}"))?;
        if response.status().is_redirection() {
            if redirect_index == MAX_REDIRECTS {
                return Err("图片地址跳转次数过多。".into());
            }
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or("图片跳转地址无效。")?;
            url = url
                .join(location)
                .map_err(|_| "图片跳转地址无效。".to_string())?;
            continue;
        }
        if !response.status().is_success() {
            return Err(format!("图片服务器返回错误：{}", response.status()));
        }
        if response.content_length().unwrap_or_default() > MAX_IMAGE_BYTES as u64 {
            return Err("粘贴图片超过 25 MB，未保存。".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("图片读取失败：{error}"))?
        {
            if bytes.len().saturating_add(chunk.len()) > MAX_IMAGE_BYTES {
                return Err("粘贴图片超过 25 MB，未保存。".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        return Ok(bytes);
    }
    Err("图片下载失败。".into())
}

async fn prepare_image(image: &PastedImageInput) -> Result<DownloadedImage, String> {
    if !valid_image_id(&image.id) {
        return Err("粘贴图片标记无效。".into());
    }
    let bytes = if image.source.to_ascii_lowercase().starts_with("data:image/") {
        decode_data_image(&image.source)?
    } else {
        download_remote_image(&image.source).await?
    };
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("粘贴图片为空或超过 25 MB。".into());
    }
    let extension =
        image_extension(&bytes).ok_or("下载内容不是受支持的 PNG、JPG、WebP、GIF 或 BMP 图片。")?;
    let digest = format!("{:x}", Sha256::digest(&bytes));
    Ok(DownloadedImage {
        placeholder: format!("{PASTED_IMAGE_SCHEME}{}", image.id),
        bytes,
        extension,
        digest,
    })
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<bool, String> {
    if path.exists() {
        return fs::read(path)
            .map(|existing| existing == bytes)
            .map_err(|error| error.to_string())
            .and_then(|identical| {
                if identical {
                    Ok(false)
                } else {
                    Err("assets 中存在同名但内容不同的图片，未覆盖原文件。".into())
                }
            });
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    let result = file
        .write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| error.to_string());
    drop(file);
    match result {
        Ok(()) => Ok(true),
        Err(error) => {
            let _ = fs::remove_file(path);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn save_document_with_pasted_images(
    path: String,
    contents: String,
    images: Vec<PastedImageInput>,
) -> Result<SavePastedImagesResult, String> {
    if images.len() > MAX_IMAGE_COUNT {
        return Err("一次最多保存 50 张粘贴图片。".into());
    }
    let destination = PathBuf::from(path);
    let parent = destination
        .parent()
        .ok_or("无法确定 Markdown 保存文件夹。")?;
    if !parent.is_dir() {
        return Err("Markdown 保存文件夹不存在。".into());
    }

    let mut unique_ids = HashSet::new();
    let mut prepared = Vec::new();
    let mut total_bytes = 0usize;
    for image in images {
        if !unique_ids.insert(image.id.clone()) {
            return Err("粘贴图片标记重复。".into());
        }
        let placeholder = format!("{PASTED_IMAGE_SCHEME}{}", image.id);
        if !contents.contains(&placeholder) {
            continue;
        }
        let downloaded = prepare_image(&image).await?;
        total_bytes = total_bytes.saturating_add(downloaded.bytes.len());
        if total_bytes > MAX_TOTAL_BYTES {
            return Err("本次粘贴图片合计超过 100 MB，未保存。".into());
        }
        prepared.push(downloaded);
    }

    if prepared.is_empty() {
        write_markdown(&destination, &contents)?;
        return Ok(SavePastedImagesResult {
            contents,
            saved_image_count: 0,
            reused_image_count: 0,
            asset_directory: path_string(&parent.join("assets")),
        });
    }

    let asset_directory = parent.join("assets");
    fs::create_dir_all(&asset_directory).map_err(|error| error.to_string())?;
    let mut localized_contents = contents;
    let mut created_paths = Vec::new();
    let mut saved_image_count = 0usize;
    let mut reused_image_count = 0usize;

    for image in prepared {
        let file_name = format!("paste-{}.{}", &image.digest[..12], image.extension);
        let image_path = asset_directory.join(&file_name);
        match write_new_file(&image_path, &image.bytes) {
            Ok(true) => {
                saved_image_count += 1;
                created_paths.push(image_path);
            }
            Ok(false) => reused_image_count += 1,
            Err(error) => {
                for path in created_paths {
                    let _ = fs::remove_file(path);
                }
                return Err(error);
            }
        }
        localized_contents =
            localized_contents.replace(&image.placeholder, &format!("assets/{file_name}"));
    }

    if let Err(error) = write_markdown(&destination, &localized_contents) {
        for path in created_paths {
            let _ = fs::remove_file(path);
        }
        return Err(error);
    }

    Ok(SavePastedImagesResult {
        contents: localized_contents,
        saved_image_count,
        reused_image_count,
        asset_directory: path_string(&asset_directory),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        decode_data_image, download_remote_image, image_extension,
        save_document_with_pasted_images, unsafe_ip, valid_image_id, PastedImageInput,
        PASTED_IMAGE_SCHEME,
    };
    use crate::path_string;
    use std::fs;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    #[test]
    fn recognizes_only_supported_raster_images() {
        assert_eq!(image_extension(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(image_extension(b"\xff\xd8\xffrest"), Some("jpg"));
        assert_eq!(image_extension(b"<svg><script/></svg>"), None);
    }

    #[test]
    fn decodes_clipboard_data_images() {
        let bytes = decode_data_image("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB")
            .expect("decode base64");
        assert_eq!(image_extension(&bytes), Some("png"));
        assert!(decode_data_image("data:image/svg+xml;base64,PHN2Zz4=").is_err());
    }

    #[test]
    fn blocks_local_and_private_networks() {
        assert!(unsafe_ip(IpAddr::V4(Ipv4Addr::LOCALHOST)));
        assert!(unsafe_ip(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 8))));
        assert!(unsafe_ip(IpAddr::V6(Ipv6Addr::LOCALHOST)));
        assert!(!unsafe_ip(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
    }

    #[test]
    fn validates_generated_placeholder_ids() {
        assert!(valid_image_id("a1b2c3-4d5e"));
        assert!(!valid_image_id("../assets/bad"));
    }

    #[test]
    #[ignore = "需要访问公开 HTTPS 图片，用于发布前的显式联网验收"]
    fn downloads_a_public_remote_png_with_network_guards() {
        let bytes = tauri::async_runtime::block_on(download_remote_image(
            "https://raw.githubusercontent.com/github/explore/main/topics/rust/rust.png",
        ))
        .expect("download public image");
        assert_eq!(image_extension(&bytes), Some("png"));
    }

    #[test]
    fn saves_embedded_clipboard_image_and_rewrites_markdown_on_disk() {
        let root = std::env::temp_dir().join(format!(
            "lightmark-pasted-image-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("create test directory");
        let document_path = root.join("中文 文档.md");
        let placeholder = format!("{PASTED_IMAGE_SCHEME}clipboard-1");
        let contents = format!("# 测试\n\n![网页图片]({placeholder})\n");
        let images = vec![PastedImageInput {
            id: "clipboard-1".into(),
            source: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=".into(),
        }];

        let result = tauri::async_runtime::block_on(save_document_with_pasted_images(
            path_string(&document_path),
            contents,
            images,
        ))
        .expect("save pasted image");

        assert_eq!(result.saved_image_count, 1);
        assert_eq!(result.reused_image_count, 0);
        assert!(!result.contents.contains(PASTED_IMAGE_SCHEME));
        assert!(result.contents.contains("![网页图片](assets/paste-"));
        assert_eq!(
            fs::read_to_string(&document_path).expect("read document"),
            result.contents
        );
        let saved_image = fs::read_dir(root.join("assets"))
            .expect("read assets")
            .next()
            .expect("one asset")
            .expect("asset entry")
            .path();
        assert_eq!(
            image_extension(&fs::read(saved_image).expect("read image")),
            Some("png")
        );

        let second_result = tauri::async_runtime::block_on(save_document_with_pasted_images(
            path_string(&document_path),
            format!("# 再次保存\n\n![网页图片]({placeholder})\n"),
            vec![PastedImageInput {
                id: "clipboard-1".into(),
                source: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=".into(),
            }],
        ))
        .expect("reuse pasted image");
        assert_eq!(second_result.saved_image_count, 0);
        assert_eq!(second_result.reused_image_count, 1);

        fs::remove_dir_all(root).expect("remove test directory");
    }
}
