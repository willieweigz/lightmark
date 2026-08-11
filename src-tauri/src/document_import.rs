use anydoc::{model::Asset, ConvertError, Format};
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use serde::Serialize;
use std::{
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
    skipped_asset_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSavePayload {
    document_path: String,
    asset_directory: Option<String>,
    extracted_asset_count: usize,
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

fn asset_counts(assets: &[Asset]) -> (usize, usize) {
    let supported = assets
        .iter()
        .filter(|asset| raster_extension(&asset.media_type).is_some())
        .count();
    (supported, assets.len().saturating_sub(supported))
}

fn convert_path(path: &Path) -> Result<ImportPayload, String> {
    let (canonical, bytes, format) = read_import_source(path)?;
    let contents = anydoc::to_markdown_bytes(&bytes, format).map_err(friendly_error)?;
    if contents.len() > MAX_MARKDOWN_BYTES {
        return Err("转换后的 Markdown 超过 25 MB，为避免界面失去响应，未打开。".into());
    }
    let (asset_count, skipped_asset_count) = if format == Format::Pdf {
        (0, 0)
    } else {
        let document = anydoc::to_document(&bytes, format).map_err(friendly_error)?;
        asset_counts(&document.assets)
    };
    let directory = canonical.parent().ok_or("无法确定源文档所在文件夹。")?;
    let source_stem = canonical.file_stem().unwrap_or_default().to_string_lossy();
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
        skipped_asset_count,
    })
}

fn available_asset_path(
    directory: &Path,
    index: usize,
    extension: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let base = format!("image-{index:03}");
    for suffix in 0..10_000usize {
        let name = if suffix == 0 {
            format!("{base}.{extension}")
        } else {
            format!("{base}-{}.{}", suffix + 1, extension)
        };
        let candidate = directory.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
        if fs::read(&candidate).map_err(|error| error.to_string())? == bytes {
            return Ok(candidate);
        }
    }
    Err("无法为导入图片生成安全的文件名。".into())
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
    if contents.len() > MAX_MARKDOWN_BYTES {
        return Err("Markdown 超过 25 MB，未保存。".into());
    }
    let parent = path.parent().ok_or("无法确定保存文件夹。")?;
    if !parent.exists() || !parent.is_dir() {
        return Err("保存文件夹不存在。".into());
    }

    let (_, bytes, format) = read_import_source(source_path)?;
    let assets = if format == Format::Pdf {
        Vec::new()
    } else {
        anydoc::to_document(&bytes, format)
            .map_err(friendly_error)?
            .assets
    };
    let (_, skipped_asset_count) = asset_counts(&assets);
    let supported_assets: Vec<_> = assets
        .into_iter()
        .filter(|asset| raster_extension(&asset.media_type).is_some())
        .collect();

    let mut final_contents = contents.trim_end().to_owned();
    let mut asset_directory = None;
    let mut extracted_asset_count = 0usize;
    if !supported_assets.is_empty() {
        let stem = path.file_stem().unwrap_or_default().to_string_lossy();
        let directory_name = format!("{stem}.assets");
        let directory = parent.join(&directory_name);
        fs::create_dir_all(&directory).map_err(|error| format!("无法创建图片文件夹：{error}"))?;
        let mut image_links = Vec::new();
        for (offset, asset) in supported_assets.iter().enumerate() {
            let extension = raster_extension(&asset.media_type).expect("filtered raster asset");
            let target = available_asset_path(&directory, offset + 1, extension, &asset.bytes)?;
            if !target.exists() {
                fs::write(&target, &asset.bytes)
                    .map_err(|error| format!("无法保存导入图片：{error}"))?;
            }
            let file_name = target.file_name().unwrap_or_default().to_string_lossy();
            let directory_url = utf8_percent_encode(&directory_name, MARKDOWN_PATH_ENCODE_SET);
            let file_url = utf8_percent_encode(&file_name, MARKDOWN_PATH_ENCODE_SET);
            image_links.push(format!(
                "![导入图片 {}]({directory_url}/{file_url})",
                offset + 1
            ));
            extracted_asset_count += 1;
        }
        if !final_contents.is_empty() {
            final_contents.push_str("\n\n---\n\n");
        }
        final_contents.push_str("## 导入的图片\n\n");
        final_contents.push_str(&image_links.join("\n\n"));
        final_contents.push('\n');
        asset_directory = Some(path_string(&directory));
    } else if !final_contents.is_empty() {
        final_contents.push('\n');
    }

    fs::write(path, final_contents.as_bytes())
        .map_err(|error| format!("无法保存 Markdown：{error}"))?;
    Ok(ImportSavePayload {
        document_path: path_string(path),
        asset_directory,
        extracted_asset_count,
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
    use super::{convert_path, save_import};
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
}
