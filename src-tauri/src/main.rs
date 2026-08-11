#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine as _};
use percent_encoding::percent_decode_str;
use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::{Emitter, Manager};

mod anydoc_markdown;
mod codex;
mod document_import;
mod pdf_import;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentEntry {
    name: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentPayload {
    name: String,
    path: String,
    directory: String,
    contents: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImagePayload {
    name: String,
    path: String,
    directory: String,
    data_url: String,
    mime_type: String,
    byte_size: u64,
}

const MAX_IMAGE_BYTES: u64 = 50 * 1024 * 1024;

fn path_string(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{}", unc);
    }
    value.strip_prefix(r"\\?\").unwrap_or(&value).to_owned()
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
}

fn image_mime(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => Some("image/png"),
        Some("jpg" | "jpeg") => Some("image/jpeg"),
        Some("webp") => Some("image/webp"),
        Some("gif") => Some("image/gif"),
        Some("bmp") => Some("image/bmp"),
        _ => None,
    }
}

fn is_image(path: &Path) -> bool {
    image_mime(path).is_some()
}

fn canonical_image(path: &Path) -> Result<PathBuf, String> {
    if !is_image(path) {
        return Err("只支持 PNG、JPG、JPEG、WebP、GIF 和 BMP 图片。".into());
    }
    path.canonicalize().map_err(|error| error.to_string())
}

fn canonical_markdown(path: &Path) -> Result<PathBuf, String> {
    if !is_markdown(path) {
        return Err("只支持 .md 和 .markdown 文件。".into());
    }
    path.canonicalize().map_err(|error| error.to_string())
}

#[tauri::command]
fn list_markdown_files(directory_path: String) -> Result<Vec<DocumentEntry>, String> {
    let directory = PathBuf::from(directory_path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !directory.is_dir() {
        return Err("所选路径不是文件夹。".into());
    }

    let mut files = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.is_file() && is_markdown(&path) {
            files.push(DocumentEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: path_string(&path),
            });
        }
    }
    Ok(files)
}

#[tauri::command]
fn list_image_files(directory_path: String) -> Result<Vec<DocumentEntry>, String> {
    let directory = PathBuf::from(directory_path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !directory.is_dir() {
        return Err("所选路径不是文件夹。".into());
    }

    let mut files = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.is_file() && is_image(&path) {
            files.push(DocumentEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: path_string(&path),
            });
        }
    }
    Ok(files)
}

#[tauri::command]
fn read_document(path: String) -> Result<DocumentPayload, String> {
    let canonical = canonical_markdown(Path::new(&path))?;
    let directory = canonical.parent().ok_or("无法确定文档所在文件夹。")?;
    let mut contents = fs::read_to_string(&canonical).map_err(|error| error.to_string())?;
    if contents.starts_with('\u{feff}') {
        contents.remove(0);
    }
    Ok(DocumentPayload {
        name: canonical
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        path: path_string(&canonical),
        directory: path_string(directory),
        contents,
    })
}

#[tauri::command]
fn read_image(path: String) -> Result<ImagePayload, String> {
    let canonical = canonical_image(Path::new(&path))?;
    let directory = canonical.parent().ok_or("无法确定图片所在文件夹。")?;
    let metadata = fs::metadata(&canonical).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err("图片超过 50 MB，未加载。".into());
    }
    let mime_type = image_mime(&canonical).ok_or("不支持这种图片格式。")?;
    let bytes = fs::read(&canonical).map_err(|error| error.to_string())?;
    Ok(ImagePayload {
        name: canonical
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        path: path_string(&canonical),
        directory: path_string(directory),
        data_url: format!("data:{mime_type};base64,{}", STANDARD.encode(bytes)),
        mime_type: mime_type.to_owned(),
        byte_size: metadata.len(),
    })
}

#[tauri::command]
fn write_document(path: String, contents: String) -> Result<(), String> {
    write_markdown(Path::new(&path), &contents)
}

fn write_markdown(destination: &Path, contents: &str) -> Result<(), String> {
    if !is_markdown(&destination) {
        return Err("保存路径必须使用 .md 或 .markdown 扩展名。".into());
    }
    let parent = destination.parent().ok_or("无法确定保存文件夹。")?;
    if !parent.exists() || !parent.is_dir() {
        return Err("保存文件夹不存在。".into());
    }
    fs::write(destination, contents.as_bytes()).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_relative_image(document_path: String, source: String) -> Result<String, String> {
    let document = canonical_markdown(Path::new(&document_path))?;
    let decoded = percent_decode_str(source.split(['?', '#']).next().unwrap_or_default())
        .decode_utf8()
        .map_err(|_| "图片路径不是有效的 UTF-8。")?;
    let relative = Path::new(decoded.as_ref());
    if relative.is_absolute() {
        return Err("只允许 Markdown 中的相对图片路径。".into());
    }
    let image_path = document
        .parent()
        .ok_or("无法确定文档目录。")?
        .join(relative)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !image_path.is_file() {
        return Err("图片文件不存在。".into());
    }
    let mime = mime_guess::from_path(&image_path).first_or_octet_stream();
    if mime.type_().as_str() != "image" {
        return Err("相对路径不是受支持的图片文件。".into());
    }
    let bytes = fs::read(&image_path).map_err(|error| error.to_string())?;
    if bytes.len() > 25 * 1024 * 1024 {
        return Err("图片超过 25 MB，未加载。".into());
    }
    Ok(format!("data:{};base64,{}", mime, STANDARD.encode(bytes)))
}

#[tauri::command]
fn resolve_markdown_link(document_path: String, target: String) -> Result<String, String> {
    let document = canonical_markdown(Path::new(&document_path))?;
    let raw_target = target.split(['?', '#']).next().unwrap_or_default().trim();
    if raw_target.is_empty() {
        return Err("链接没有指定 Markdown 文档。".into());
    }
    let decoded = percent_decode_str(raw_target)
        .decode_utf8()
        .map_err(|_| "链接路径不是有效的 UTF-8。")?;
    let relative = Path::new(decoded.as_ref());
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("只允许打开当前文件夹内的相对 Markdown 链接。".into());
    }

    let directory = document.parent().ok_or("无法确定当前文档目录。")?;
    let mut candidates = vec![directory.join(relative)];
    if relative.extension().is_none() {
        candidates.push(directory.join(relative).with_extension("md"));
        candidates.push(directory.join(relative).with_extension("markdown"));
    }

    for candidate in candidates {
        let Ok(canonical) = candidate.canonicalize() else {
            continue;
        };
        if canonical.starts_with(directory) && canonical.is_file() && is_markdown(&canonical) {
            return Ok(path_string(&canonical));
        }
    }
    Err(format!("找不到链接对应的 Markdown 文档：{}", decoded))
}

#[tauri::command]
fn startup_paths() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .map(|value| PathBuf::from(value).to_string_lossy().into_owned())
        .filter(|value| {
            let path = Path::new(value);
            is_markdown(path) || is_image(path) || document_import::is_importable(path)
        })
        .collect()
}

fn main() {
    tauri::Builder::default()
        .manage(codex::CodexBridge::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            let _ = app.emit("single-instance", args);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_markdown_files,
            list_image_files,
            read_document,
            read_image,
            write_document,
            read_relative_image,
            resolve_markdown_link,
            startup_paths,
            document_import::import_document,
            document_import::save_imported_document,
            codex::codex_status,
            codex::codex_connect,
            codex::codex_ask,
            codex::codex_interrupt,
            codex::codex_new_conversation,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LightMark");
}

#[cfg(test)]
mod tests {
    use super::{image_mime, is_image, write_markdown};
    use std::{
        fs,
        path::Path,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn accepts_common_raster_images_case_insensitively() {
        assert_eq!(image_mime(Path::new("照片.JPG")), Some("image/jpeg"));
        assert_eq!(image_mime(Path::new("图表.webp")), Some("image/webp"));
        assert!(is_image(Path::new("动画.GIF")));
        assert!(is_image(Path::new("扫描.bmp")));
    }

    #[test]
    fn rejects_svg_and_unrelated_files() {
        assert_eq!(image_mime(Path::new("可能包含脚本.svg")), None);
        assert!(!is_image(Path::new("说明.txt")));
        assert!(!is_image(Path::new("无扩展名")));
    }

    #[test]
    fn creates_and_reads_back_a_blank_markdown_document_on_disk() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("lightmark-new-document-{unique}"));
        fs::create_dir(&directory).expect("create temporary test directory");
        let document = directory.join("中文 新建文档.md");

        write_markdown(&document, "").expect("create blank Markdown document");
        assert!(document.is_file());
        assert_eq!(
            fs::read_to_string(&document).expect("read created document"),
            ""
        );

        fs::remove_file(&document).expect("remove exact temporary document");
        fs::remove_dir(&directory).expect("remove exact temporary directory");
    }
}
