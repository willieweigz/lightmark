use crate::anydoc_markdown;
use anydoc::{
    model::{Asset, AssetId, Document},
    ConvertError, Format,
};
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

const MAX_IMPORT_BYTES: u64 = 100 * 1024 * 1024;
const MAX_MARKDOWN_BYTES: usize = 25 * 1024 * 1024;
const MARKDOWN_PATH_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'(')
    .add(b')')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'\\');

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPayload {
    source_name: String,
    source_path: String,
    directory: String,
    suggested_name: String,
    suggested_path: String,
    contents: String,
    format_label: String,
    asset_count: usize,
    positioned_asset_count: usize,
    appended_asset_count: usize,
    skipped_asset_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSavePayload {
    document_path: String,
    asset_directory: Option<String>,
    extracted_asset_count: usize,
    positioned_asset_count: usize,
    appended_asset_count: usize,
    skipped_asset_count: usize,
}

fn path_string(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{}", unc);
    }
    value.strip_prefix(r"\\?\").unwrap_or(&value).to_owned()
}

fn format_label(format: Format) -> &'static str {
    match format {
        Format::Doc => "Word 97-2003",
        Format::Docx => "Word",
        Format::Odt => "OpenDocument 文本文档",
        Format::Pdf => "文字型 PDF",
        Format::Ppt => "PowerPoint 97-2003",
        Format::Pptx => "PowerPoint",
        Format::Rtf => "RTF 富文本",
        Format::Epub => "EPUB 电子书",
        Format::Excel => "Excel",
        Format::Ods => "OpenDocument 表格",
        Format::Odp => "OpenDocument 演示文稿",
        Format::Csv => "CSV 表格",
    }
}

pub(crate) fn is_importable(path: &Path) -> bool {
    Format::from_path(path).is_some()
}

fn friendly_error(error: ConvertError) -> String {
    match error {
        ConvertError::Unsupported(_) => {
            "无法识别这个文档。如果它是扫描 PDF，图片中的文字需要 OCR，当前离线导入暂不支持。"
                .into()
        }
        ConvertError::Malformed { .. } | ConvertError::MissingPart { .. } => {
            "文档结构损坏或缺少必要内容，无法转换。".into()
        }
        ConvertError::Encrypted => "文档已加密或受密码保护，请先解除密码后再导入。".into(),
        ConvertError::ResourceLimit { .. } => {
            "文档解压后的内容、嵌套层级或资源数量超过安全限制，已停止导入。".into()
        }
        ConvertError::Io(error) => format!("无法读取文档：{error}"),
        _ => format!("文档转换失败：{error}"),
    }
}

fn read_import_source(path: &Path) -> Result<(PathBuf, Vec<u8>, Format), String> {
    if !is_importable(path) {
        return Err("不支持这种导入格式。请选择 Word、PowerPoint、Excel、OpenDocument、RTF、EPUB、CSV 或 PDF。".into());
    }
    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    if !canonical.is_file() {
        return Err("所选路径不是文件。".into());
    }
    let metadata = fs::metadata(&canonical).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_IMPORT_BYTES {
        return Err("文档超过 100 MB，为避免占用过多内存，未导入。".into());
    }
    let bytes = fs::read(&canonical).map_err(|error| error.to_string())?;
    let format = Format::from_bytes(&bytes)
        .or_else(|| Format::from_path(&canonical))
        .ok_or("无法识别这个文档的格式。")?;
    Ok((canonical, bytes, format))
}

fn raster_extension(media_type: &str) -> Option<&'static str> {
    match media_type.to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/bmp" | "image/x-ms-bmp" => Some("bmp"),
        _ => None,
    }
}

fn asset_file_name(asset: &Asset) -> Option<String> {
    let extension = raster_extension(&asset.media_type)?;
    let digest = Sha256::digest(&asset.bytes);
    let short_hash = digest[..6]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Some(format!(
        "image-{:03}-{short_hash}.{extension}",
        asset.id.0 + 1
    ))
}

fn encoded_asset_directory(stem: &str) -> String {
    utf8_percent_encode(&format!("{stem}.assets"), MARKDOWN_PATH_ENCODE_SET).to_string()
}

fn asset_urls(assets: &[Asset], stem: &str) -> HashMap<AssetId, String> {
    let directory = encoded_asset_directory(stem);
    assets
        .iter()
        .filter_map(|asset| {
            asset_file_name(asset).map(|file_name| (asset.id, format!("{directory}/{file_name}")))
        })
        .collect()
}

fn render_document_with_assets(document: &Document, stem: &str) -> (String, usize, usize, usize) {
    let urls = asset_urls(&document.assets, stem);
    let asset_count = urls.len();
    let skipped_asset_count = document.assets.len().saturating_sub(asset_count);
    let mut contents = anydoc_markdown::document_to_markdown(document, urls.clone());
    let mut unpositioned: Vec<_> = urls
        .iter()
        .filter(|(_, url)| !contents.contains(url.as_str()))
        .collect();
    unpositioned.sort_by_key(|(id, _)| id.0);
    let appended_asset_count = unpositioned.len();
    let positioned_asset_count = asset_count.saturating_sub(appended_asset_count);

    if !unpositioned.is_empty() {
        if !contents.trim().is_empty() {
            contents = contents.trim_end().to_owned();
            contents.push_str("\n\n---\n\n");
        }
        contents.push_str("## 无法定位的导入图片\n\n");
        for (offset, (id, url)) in unpositioned.iter().enumerate() {
            if offset > 0 {
                contents.push_str("\n\n");
            }
            contents.push_str(&format!("![导入图片 {}]({url})", id.0 + 1));
        }
        contents.push('\n');
    }

    (
        contents,
        positioned_asset_count,
        appended_asset_count,
        skipped_asset_count,
    )
}

fn convert_path(path: &Path) -> Result<ImportPayload, String> {
    let (canonical, bytes, format) = read_import_source(path)?;
    let directory = canonical.parent().ok_or("无法确定源文档所在文件夹。")?;
    let source_stem = canonical.file_stem().unwrap_or_default().to_string_lossy();
    let (contents, positioned_asset_count, appended_asset_count, skipped_asset_count) =
        if format == Format::Pdf {
            (
                anydoc::to_markdown_bytes(&bytes, format).map_err(friendly_error)?,
                0,
                0,
                0,
            )
        } else {
            let document = anydoc::to_document(&bytes, format).map_err(friendly_error)?;
            render_document_with_assets(&document, &source_stem)
        };
    if contents.len() > MAX_MARKDOWN_BYTES {
        return Err("转换后的 Markdown 超过 25 MB，为避免界面失去响应，未打开。".into());
    }
    let asset_count = positioned_asset_count + appended_asset_count;
    let suggested_name = format!("{source_stem}.md");
    let suggested_path = directory.join(&suggested_name);
    Ok(ImportPayload {
        source_name: canonical
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        source_path: path_string(&canonical),
        directory: path_string(directory),
        suggested_name,
        suggested_path: path_string(&suggested_path),
        contents,
        format_label: format_label(format).into(),
        asset_count,
        positioned_asset_count,
        appended_asset_count,
        skipped_asset_count,
    })
}

fn save_import(
    path: &Path,
    source_path: &Path,
    contents: &str,
) -> Result<ImportSavePayload, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown") {
        return Err("保存路径必须使用 .md 或 .markdown 扩展名。".into());
    }
    let parent = path.parent().ok_or("无法确定保存文件夹。")?;
    if !parent.exists() || !parent.is_dir() {
        return Err("保存文件夹不存在。".into());
    }

    let (_, bytes, format) = read_import_source(source_path)?;
    let (assets, positioned_asset_count, appended_asset_count, skipped_asset_count) =
        if format == Format::Pdf {
            (Vec::new(), 0, 0, 0)
        } else {
            let document = anydoc::to_document(&bytes, format).map_err(friendly_error)?;
            let source_stem = source_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy();
            let (_, positioned, appended, skipped) =
                render_document_with_assets(&document, &source_stem);
            (document.assets, positioned, appended, skipped)
        };
    let supported_assets: Vec<_> = assets
        .into_iter()
        .filter(|asset| raster_extension(&asset.media_type).is_some())
        .collect();

    let source_stem = source_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let target_stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let source_directory_url = encoded_asset_directory(&source_stem);
    let target_directory_url = encoded_asset_directory(&target_stem);
    let mut final_contents = contents
        .replace(
            &format!("{source_directory_url}/"),
            &format!("{target_directory_url}/"),
        )
        .trim_end()
        .to_owned();
    if !final_contents.is_empty() {
        final_contents.push('\n');
    }
    if final_contents.len() > MAX_MARKDOWN_BYTES {
        return Err("Markdown 超过 25 MB，未保存。".into());
    }

    let mut asset_directory = None;
    let mut extracted_asset_count = 0usize;
    if !supported_assets.is_empty() {
        let directory_name = format!("{target_stem}.assets");
        let directory = parent.join(&directory_name);
        fs::create_dir_all(&directory).map_err(|error| format!("无法创建图片文件夹：{error}"))?;
        for asset in &supported_assets {
            let file_name = asset_file_name(asset).expect("filtered raster asset");
            let target = directory.join(file_name);
            if target.exists() {
                let existing =
                    fs::read(&target).map_err(|error| format!("无法检查已有导入图片：{error}"))?;
                if existing != asset.bytes {
                    return Err(format!(
                        "图片文件已存在但内容不同，为避免覆盖，已停止保存：{}",
                        target.display()
                    ));
                }
            } else {
                fs::write(&target, &asset.bytes)
                    .map_err(|error| format!("无法保存导入图片：{error}"))?;
            }
            extracted_asset_count += 1;
        }
        asset_directory = Some(path_string(&directory));
    }

    fs::write(path, final_contents.as_bytes())
        .map_err(|error| format!("无法保存 Markdown：{error}"))?;
    Ok(ImportSavePayload {
        document_path: path_string(path),
        asset_directory,
        extracted_asset_count,
        positioned_asset_count,
        appended_asset_count,
        skipped_asset_count,
    })
}

#[tauri::command]
pub async fn import_document(path: String) -> Result<ImportPayload, String> {
    tauri::async_runtime::spawn_blocking(move || convert_path(Path::new(&path)))
        .await
        .map_err(|error| format!("导入任务意外停止：{error}"))?
}

#[tauri::command]
pub async fn save_imported_document(
    path: String,
    source_path: String,
    contents: String,
) -> Result<ImportSavePayload, String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_import(Path::new(&path), Path::new(&source_path), &contents)
    })
    .await
    .map_err(|error| format!("保存任务意外停止：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::{convert_path, render_document_with_assets, save_import};
    use anydoc::model::{Asset, AssetId, Block, Document, ImageSource, Inline};
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temporary_directory(label: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("lightmark-{label}-{unique}"));
        fs::create_dir(&directory).expect("create temporary directory");
        directory
    }

    #[test]
    fn imports_utf8_csv_from_a_chinese_windows_style_name() {
        let directory = temporary_directory("import-csv");
        let source = directory.join("中文 课程表.csv");
        fs::write(&source, "课程,课时\n历史,10\n文学,12\n").expect("write CSV fixture");

        let payload = convert_path(&source).expect("convert CSV");
        assert_eq!(payload.suggested_name, "中文 课程表.md");
        assert!(payload.contents.contains("课程"));
        assert!(payload.contents.contains("历史"));
        assert_eq!(payload.format_label, "CSV 表格");

        fs::remove_file(&source).expect("remove fixture");
        fs::remove_dir(&directory).expect("remove temporary directory");
    }

    #[test]
    fn saves_converted_markdown_without_modifying_the_source() {
        let directory = temporary_directory("save-import");
        let source = directory.join("说明 文档.rtf");
        let destination = directory.join("说明 文档.md");
        let rtf =
            r#"{\rtf1\ansi\deff0 {\fonttbl {\f0 Arial;}} \b LightMark\b0\par Offline import.}"#;
        fs::write(&source, rtf).expect("write RTF fixture");
        let original = fs::read(&source).expect("read source before conversion");
        let payload = convert_path(&source).expect("convert RTF");
        let result = save_import(&destination, &source, &payload.contents).expect("save Markdown");

        assert_eq!(
            fs::read(&source).expect("read source after conversion"),
            original
        );
        assert!(fs::read_to_string(&destination)
            .expect("read saved Markdown")
            .contains("LightMark"));
        assert_eq!(result.extracted_asset_count, 0);

        fs::remove_file(&source).expect("remove fixture");
        fs::remove_file(&destination).expect("remove output");
        fs::remove_dir(&directory).expect("remove temporary directory");
    }

    #[test]
    fn keeps_an_embedded_image_between_its_source_paragraphs() {
        let document = Document {
            blocks: vec![
                Block::Paragraph(vec![Inline::plain("图片前面的文字")]),
                Block::Paragraph(vec![Inline::Image {
                    alt: "示意图".into(),
                    source: ImageSource::Asset(AssetId(0)),
                }]),
                Block::Paragraph(vec![Inline::plain("图片后面的文字")]),
            ],
            notes: Vec::new(),
            assets: vec![Asset {
                id: AssetId(0),
                media_type: "image/png".into(),
                origin_part: "word/media/image1.png".into(),
                bytes: vec![0x89, b'P', b'N', b'G'],
            }],
        };

        let (markdown, positioned, appended, skipped) =
            render_document_with_assets(&document, "中文 文档");
        let before = markdown.find("图片前面的文字").expect("before text");
        let image = markdown.find("![示意图]").expect("positioned image");
        let after = markdown.find("图片后面的文字").expect("after text");

        assert!(before < image && image < after, "{markdown}");
        assert!(markdown.contains("%E4%B8%AD%E6%96%87%20%E6%96%87%E6%A1%A3.assets/"));
        assert_eq!((positioned, appended, skipped), (1, 0, 0));
        assert!(!markdown.contains("无法定位的导入图片"));
    }

    #[test]
    fn appends_only_assets_without_a_reading_position() {
        let document = Document {
            blocks: vec![Block::Paragraph(vec![Inline::plain("正文")])],
            notes: Vec::new(),
            assets: vec![Asset {
                id: AssetId(0),
                media_type: "image/jpeg".into(),
                origin_part: "ppt/media/image1.jpeg".into(),
                bytes: vec![0xff, 0xd8, 0xff],
            }],
        };

        let (markdown, positioned, appended, skipped) =
            render_document_with_assets(&document, "演示文稿");

        assert!(markdown.contains("## 无法定位的导入图片"));
        assert!(markdown.contains("![导入图片 1]"));
        assert_eq!((positioned, appended, skipped), (0, 1, 0));
    }
}
