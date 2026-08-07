#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine as _};
use percent_encoding::percent_decode_str;
use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::{Emitter, Manager};

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
fn write_document(path: String, contents: String) -> Result<(), String> {
    let destination = PathBuf::from(&path);
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
        .filter(|value| is_markdown(Path::new(value)))
        .collect()
}

fn main() {
    tauri::Builder::default()
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
            read_document,
            write_document,
            read_relative_image,
            resolve_markdown_link,
            startup_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LightMark");
}
