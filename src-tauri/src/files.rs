//! 本地文档与打开历史。
//!
//! 编辑器状态仍在前端。这里只读写用户选中的文件，并把最近打开的
//! 元信息记在应用数据目录的 history.json 里。

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMeta {
    pub id: String,
    pub path: String,
    pub title: String,
    pub preview: String,
    pub word_count: usize,
    pub created_at: String,
    pub opened_at: String,
}

#[tauri::command]
pub async fn doc_pick_folder(app: AppHandle, title: Option<String>) -> Option<String> {
    let heading = title
        .filter(|text| !text.trim().is_empty())
        .unwrap_or_else(|| "选择保存位置".to_string());
    let mut builder = app.dialog().file().set_title(heading);
    if let Some(window) = app.get_webview_window("main") {
        builder = builder.set_parent(&window);
    }
    builder.blocking_pick_folder().and_then(file_path_string)
}

const MARKDOWN_DEPTH: u32 = 4;
const MARKDOWN_LIMIT: usize = 300;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownEntry {
    pub path: String,
    pub name: String,
}

/// 列出文件夹里的 Markdown。跳过隐藏项、依赖目录和符号链接。
/// 最多往下四层，最多 300 个文件。
#[tauri::command]
pub fn doc_list_markdown(folder: String) -> Result<Vec<MarkdownEntry>, String> {
    let root = checked_directory(&folder)?;
    let mut files = Vec::new();
    walk_markdown(&root, &root, 0, &mut files)?;
    files.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(files)
}

fn walk_markdown(
    root: &Path,
    dir: &Path,
    depth: u32,
    files: &mut Vec<MarkdownEntry>,
) -> Result<(), String> {
    if depth > MARKDOWN_DEPTH || files.len() >= MARKDOWN_LIMIT {
        return Ok(());
    }
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) if depth == 0 => return Err("无法读取文件夹".to_string()),
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        if files.len() >= MARKDOWN_LIMIT {
            break;
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == "dist" {
            continue;
        }
        let path = entry.path();
        if kind.is_dir() {
            walk_markdown(root, &path, depth + 1, files)?;
            continue;
        }
        if !kind.is_file() {
            continue;
        }
        let Some(ext) = path.extension().and_then(|ext| ext.to_str()) else {
            continue;
        };
        if !ext.eq_ignore_ascii_case("md") && !ext.eq_ignore_ascii_case("markdown") {
            continue;
        }
        let relative = path.strip_prefix(root).unwrap_or(&path);
        files.push(MarkdownEntry {
            path: path.to_string_lossy().into_owned(),
            name: relative.to_string_lossy().replace('\\', "/"),
        });
    }
    Ok(())
}

#[tauri::command]
pub fn doc_create(folder: String, name: String) -> Result<String, String> {
    let dir = checked_directory(&folder)?;
    let stem = sanitized_stem(&name)?;
    let file = allocate_markdown(&dir, &stem)?;
    let file = checked_path(&file.to_string_lossy())?;
    fs::write(&file, b"").map_err(|error| format!("无法创建文件：{error}"))?;
    Ok(file.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn doc_rename(app: AppHandle, from: String, name: String) -> Result<String, String> {
    let source = safe_file(&from)?;
    let stem = sanitized_stem(&name)?;
    let destination = rename_markdown(&source, &stem)?;
    let next = destination.to_string_lossy().into_owned();
    if let Err(error) = rewrite_history_path(&app, &from, &next, &stem) {
        eprintln!("[frisket] 重命名后没能更新历史：{error}");
    }
    Ok(next)
}

#[tauri::command]
pub async fn doc_pick_open(app: AppHandle) -> Option<String> {
    // 异步命令跑在工作线程上。blocking_* 会把面板派回主线程再等待，
    // 如果命令本身就在主线程，这里会把事件循环堵死。
    let mut builder = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .set_title("打开 Markdown");
    if let Some(window) = app.get_webview_window("main") {
        builder = builder.set_parent(&window);
    }
    builder.blocking_pick_file().and_then(file_path_string)
}

#[tauri::command]
pub async fn wallpaper_pick(app: AppHandle) -> Option<String> {
    let mut builder = app
        .dialog()
        .file()
        .add_filter("图片", &["png", "jpg", "jpeg", "webp", "gif", "heic"])
        .set_title("选择壁纸");
    if let Some(window) = app.get_webview_window("main") {
        builder = builder.set_parent(&window);
    }
    builder.blocking_pick_file().and_then(file_path_string)
}

#[tauri::command]
pub async fn doc_pick_save(app: AppHandle, suggested: Option<String>) -> Option<String> {
    let name = suggested
        .as_deref()
        .map(file_name_only)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "未命名.md".to_string());
    let mut builder = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md"])
        .set_title("保存 Markdown")
        .set_file_name(name);
    if let Some(window) = app.get_webview_window("main") {
        builder = builder.set_parent(&window);
    }
    builder.blocking_save_file().and_then(file_path_string).map(|path| {
        let file = PathBuf::from(&path);
        if file.extension().is_some() {
            path
        } else {
            file.with_extension("md").to_string_lossy().into_owned()
        }
    })
}

#[tauri::command]
pub fn doc_read(path: String) -> Result<String, String> {
    let file = safe_file(&path)?;
    fs::read_to_string(&file).map_err(|error| format!("无法读取文件：{error}"))
}

#[tauri::command]
pub fn doc_write(path: String, text: String) -> Result<(), String> {
    let file = safe_destination(&path)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建目录：{error}"))?;
    }
    let temporary = file.with_extension("md.tmp");
    fs::write(&temporary, text.as_bytes()).map_err(|error| format!("无法写入文件：{error}"))?;
    fs::rename(&temporary, &file).map_err(|error| format!("无法保存文件：{error}"))?;
    Ok(())
}

#[tauri::command]
pub fn doc_history(app: AppHandle) -> Result<Vec<DocumentMeta>, String> {
    let file = history_file(&app)?;
    if !file.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&file).map_err(|error| format!("无法读取历史：{error}"))?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&raw).map_err(|error| format!("历史记录已损坏：{error}"))
}

#[tauri::command]
pub fn doc_history_touch(app: AppHandle, meta: DocumentMeta) -> Result<(), String> {
    let mut items = doc_history(app.clone()).unwrap_or_default();
    items.retain(|item| item.id != meta.id);
    items.insert(0, meta);
    items.truncate(1000);
    write_history(&app, &items)
}

/// 从历史里去掉这些记录。只改 history.json，不删除用户的文件。
#[tauri::command]
pub fn doc_history_remove(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let items = doc_history(app.clone())?;
    let next = omit_history_entries(&items, &ids);
    if next.len() == items.len() {
        return Ok(());
    }
    write_history(&app, &next)
}

fn omit_history_entries(items: &[DocumentMeta], ids: &[String]) -> Vec<DocumentMeta> {
    let drop: HashSet<&str> = ids.iter().map(String::as_str).filter(|id| !id.is_empty()).collect();
    if drop.is_empty() {
        return items.to_vec();
    }
    items
        .iter()
        .filter(|item| !drop.contains(item.id.as_str()) && !drop.contains(item.path.as_str()))
        .cloned()
        .collect()
}

/// 在 Finder 中显示这个文件。路径必须是绝对路径，且不能含 `..`。
#[tauri::command]
pub fn doc_reveal_in_finder(path: String) -> Result<(), String> {
    let file = checked_path(&path)?;
    if !file.exists() {
        return Err("找不到这个文件".to_string());
    }
    let status = std::process::Command::new("/usr/bin/open")
        .arg("-R")
        .arg(&file)
        .status()
        .map_err(|error| format!("无法打开 Finder：{error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Finder 没有打开这个文件".to_string())
    }
}

fn write_history(app: &AppHandle, items: &[DocumentMeta]) -> Result<(), String> {
    let file = history_file(app)?;
    let raw = serde_json::to_string_pretty(items).map_err(|error| error.to_string())?;
    let temporary = file.with_extension("json.tmp");
    fs::write(&temporary, raw).map_err(|error| format!("无法写入历史：{error}"))?;
    fs::rename(&temporary, &file).map_err(|error| format!("无法保存历史：{error}"))?;
    Ok(())
}

fn rewrite_history_path(app: &AppHandle, from: &str, dest: &str, stem: &str) -> Result<(), String> {
    let mut items = doc_history(app.clone()).unwrap_or_default();
    let old_stem = Path::new(from)
        .file_stem()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    for item in &mut items {
        if item.id == from || item.path == from {
            if item.title == old_stem {
                item.title = stem.to_string();
            }
            item.id = dest.to_string();
            item.path = dest.to_string();
        }
    }
    let mut seen = HashSet::new();
    items.retain(|item| seen.insert(item.id.clone()));
    write_history(app, &items)
}

fn checked_directory(path: &str) -> Result<PathBuf, String> {
    let dir = checked_path(path)?;
    if !dir.is_dir() {
        return Err("找不到这个文件夹".to_string());
    }
    Ok(dir)
}

fn sanitized_stem(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    let stem = strip_md_suffix(trimmed).trim();
    if stem.is_empty() || stem == "." || stem == ".." {
        return Err("请写一个文件名".to_string());
    }
    if stem.contains('/') || stem.contains('\\') || stem.contains('\0') || stem.contains(':') {
        return Err("文件名不能包含斜杠或冒号".to_string());
    }
    if stem.chars().count() > 180 {
        return Err("文件名太长".to_string());
    }
    Ok(stem.to_string())
}

fn strip_md_suffix(name: &str) -> &str {
    if name.len() >= 3 && name[name.len() - 3..].eq_ignore_ascii_case(".md") {
        &name[..name.len() - 3]
    } else {
        name
    }
}

fn allocate_markdown(dir: &Path, stem: &str) -> Result<PathBuf, String> {
    let first = dir.join(format!("{stem}.md"));
    if !first.exists() {
        return Ok(first);
    }
    for index in 2..1000 {
        let candidate = dir.join(format!("{stem} {index}.md"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("这个文件夹里同名文件太多".to_string())
}

fn rename_markdown(source: &Path, stem: &str) -> Result<PathBuf, String> {
    let parent = source
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .ok_or_else(|| "找不到所在文件夹".to_string())?;
    let destination = checked_path(&parent.join(format!("{stem}.md")).to_string_lossy())?;
    if destination == source {
        return Ok(destination);
    }
    if destination.exists() && !same_file(source, &destination) {
        return Err("这个名字已经有文件了".to_string());
    }
    fs::rename(source, &destination).map_err(|error| format!("无法重命名：{error}"))?;
    Ok(destination)
}

fn same_file(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn history_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("找不到数据目录：{error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建数据目录：{error}"))?;
    Ok(dir.join("history.json"))
}

fn safe_file(path: &str) -> Result<PathBuf, String> {
    let file = checked_path(path)?;
    if !file.is_file() {
        return Err("找不到这个文件".to_string());
    }
    Ok(file)
}

fn safe_destination(path: &str) -> Result<PathBuf, String> {
    checked_path(path)
}

fn checked_path(path: &str) -> Result<PathBuf, String> {
    let file = PathBuf::from(path);
    if !file.is_absolute() {
        return Err("请使用绝对路径".to_string());
    }
    if path_has_parent(&file) {
        return Err("路径不合法".to_string());
    }
    Ok(file)
}

fn path_has_parent(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
}

/// 每篇文档只留最近一次采纳前的正文，外加回退前的那一版，用来再点一次。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMeta {
    pub id: String,
    pub document_id: String,
    pub created_at: String,
    pub reason: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ai_action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub word_delta: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevertResult {
    pub text: String,
}

#[derive(Default, Serialize, Deserialize)]
struct SnapshotPair {
    ai_write: Option<SnapshotBody>,
    pre_restore: Option<SnapshotBody>,
}

#[derive(Clone, Serialize, Deserialize)]
struct SnapshotBody {
    meta: SnapshotMeta,
    text: String,
}

enum SnapshotStore {
    Memory,
    Disk(PathBuf),
}

fn snapshot_memory() -> &'static Mutex<HashMap<String, SnapshotPair>> {
    static MEMORY: OnceLock<Mutex<HashMap<String, SnapshotPair>>> = OnceLock::new();
    MEMORY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn snapshot_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn snapshot_key(path: &str, document_id: &str) -> Result<String, String> {
    let key = if path.trim().is_empty() {
        document_id.trim()
    } else {
        path.trim()
    };
    if key.is_empty() {
        return Err("没有文档可以快照".to_string());
    }
    Ok(key.to_string())
}

fn snapshot_store(app: &AppHandle, path: &str) -> Result<SnapshotStore, String> {
    if path.trim().is_empty() {
        return Ok(SnapshotStore::Memory);
    }
    let _ = checked_path(path)?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("找不到数据目录：{error}"))?
        .join("ai-snapshots");
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建快照目录：{error}"))?;
    Ok(SnapshotStore::Disk(dir))
}

fn with_snapshot_pair<T>(
    store: &SnapshotStore,
    key: &str,
    edit: impl FnOnce(&mut SnapshotPair) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = snapshot_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    match store {
        SnapshotStore::Memory => {
            let mut memory = snapshot_memory()
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            let pair = memory.entry(key.to_string()).or_default();
            edit(pair)
        }
        SnapshotStore::Disk(dir) => {
            let mut pair = read_snapshot_pair(dir, key)?;
            let result = edit(&mut pair)?;
            write_snapshot_pair(dir, key, &pair)?;
            Ok(result)
        }
    }
}

fn snapshot_file(dir: &Path, key: &str) -> PathBuf {
    dir.join(format!("{}.json", snapshot_name(key)))
}

fn snapshot_name(key: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in key.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn read_snapshot_pair(dir: &Path, key: &str) -> Result<SnapshotPair, String> {
    let file = snapshot_file(dir, key);
    if !file.exists() {
        return Ok(SnapshotPair::default());
    }
    let raw = fs::read_to_string(&file).map_err(|error| format!("无法读取快照：{error}"))?;
    serde_json::from_str(&raw).map_err(|error| format!("快照已损坏：{error}"))
}

fn write_snapshot_pair(dir: &Path, key: &str, pair: &SnapshotPair) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|error| format!("无法创建快照目录：{error}"))?;
    let raw = serde_json::to_string(pair).map_err(|error| error.to_string())?;
    let file = snapshot_file(dir, key);
    let temporary = file.with_extension("json.tmp");
    fs::write(&temporary, raw).map_err(|error| format!("无法写入快照：{error}"))?;
    fs::rename(&temporary, &file).map_err(|error| format!("无法保存快照：{error}"))?;
    Ok(())
}

fn new_snapshot_meta(
    document_id: &str,
    path: &str,
    reason: &str,
    ai_action: Option<String>,
    word_delta: Option<i64>,
) -> SnapshotMeta {
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    SnapshotMeta {
        id: format!("{id}"),
        document_id: document_id.to_string(),
        created_at: iso_utc_now(),
        reason: reason.to_string(),
        path: path.to_string(),
        ai_action,
        word_delta,
    }
}

fn iso_utc_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    iso_utc(secs)
}

fn iso_utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let tod = secs % 86_400;
    let hour = tod / 3_600;
    let minute = (tod % 3_600) / 60;
    let second = tod % 60;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    if month <= 2 {
        year += 1;
    }
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn record_ai_write(
    store: &SnapshotStore,
    key: &str,
    document_id: &str,
    path: &str,
    text: &str,
    ai_action: Option<String>,
    word_delta: Option<i64>,
) -> Result<SnapshotMeta, String> {
    with_snapshot_pair(store, key, |pair| {
        let meta = new_snapshot_meta(document_id, path, "ai-write", ai_action, word_delta);
        pair.ai_write = Some(SnapshotBody {
            meta: meta.clone(),
            text: text.to_string(),
        });
        pair.pre_restore = None;
        Ok(meta)
    })
}

fn list_ai_writes(store: &SnapshotStore, key: &str) -> Result<Vec<SnapshotMeta>, String> {
    with_snapshot_pair(store, key, |pair| {
        Ok(pair
            .ai_write
            .as_ref()
            .map(|shot| vec![shot.meta.clone()])
            .unwrap_or_default())
    })
}

fn revert_ai_write(store: &SnapshotStore, key: &str, current: &str) -> Result<String, String> {
    with_snapshot_pair(store, key, |pair| {
        let Some(ai_write) = pair.ai_write.clone() else {
            return Err("还没有这次采纳之前的正文".to_string());
        };
        if pair.pre_restore.is_some() && current == ai_write.text {
            return Ok(pair
                .pre_restore
                .as_ref()
                .map(|shot| shot.text.clone())
                .unwrap_or_default());
        }
        let meta = new_snapshot_meta(
            &ai_write.meta.document_id,
            &ai_write.meta.path,
            "pre-restore",
            None,
            None,
        );
        pair.pre_restore = Some(SnapshotBody {
            meta,
            text: current.to_string(),
        });
        Ok(ai_write.text)
    })
}

#[tauri::command]
pub fn doc_snapshot(
    app: AppHandle,
    path: String,
    document_id: String,
    text: String,
    reason: String,
    ai_action: Option<String>,
    word_delta: Option<i64>,
) -> Result<SnapshotMeta, String> {
    if reason != "ai-write" {
        return Err("写回前的快照原因是 ai-write".to_string());
    }
    let key = snapshot_key(&path, &document_id)?;
    let store = snapshot_store(&app, &path)?;
    let document_id = if document_id.trim().is_empty() {
        key.clone()
    } else {
        document_id
    };
    record_ai_write(&store, &key, &document_id, path.trim(), &text, ai_action, word_delta)
}

#[tauri::command]
pub fn doc_snapshot_list(app: AppHandle, path: String, document_id: String) -> Result<Vec<SnapshotMeta>, String> {
    let key = snapshot_key(&path, &document_id)?;
    let store = snapshot_store(&app, &path)?;
    list_ai_writes(&store, &key)
}

#[tauri::command]
pub fn doc_revert(app: AppHandle, path: String, document_id: String, text: String) -> Result<RevertResult, String> {
    let key = snapshot_key(&path, &document_id)?;
    let store = snapshot_store(&app, &path)?;
    let text = revert_ai_write(&store, &key, &text)?;
    Ok(RevertResult { text })
}

fn file_path_string(path: tauri_plugin_dialog::FilePath) -> Option<String> {
    path.into_path().ok().map(|file| file.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::{
        allocate_markdown, checked_path, doc_list_markdown, iso_utc, list_ai_writes, omit_history_entries,
        record_ai_write, rename_markdown, revert_ai_write, sanitized_stem, snapshot_file, DocumentMeta,
        SnapshotStore,
    };
    use std::fs;

    #[test]
    fn reveal_path_rejects_relative_and_parent() {
        assert!(checked_path("notes.md").is_err());
        assert!(checked_path("/tmp/../etc/passwd").is_err());
        assert!(checked_path("/tmp/frisket-note.md").is_ok());
    }

    #[test]
    fn stem_rejects_path_pieces() {
        assert!(sanitized_stem("../x").is_err());
        assert!(sanitized_stem("a/b").is_err());
        assert!(sanitized_stem("  ").is_err());
        assert_eq!(sanitized_stem("会议纪要.md").unwrap(), "会议纪要");
        assert_eq!(sanitized_stem("Notes.MD").unwrap(), "Notes");
    }

    #[test]
    fn allocate_and_rename_stay_in_the_folder() {
        let dir = std::env::temp_dir().join(format!("frisket-name-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let first = dir.join("未命名.md");
        fs::write(&first, b"a").unwrap();
        let next = allocate_markdown(&dir, "未命名").unwrap();
        assert_eq!(next.file_name().unwrap(), "未命名 2.md");
        fs::write(&next, b"b").unwrap();
        let renamed = rename_markdown(&next, "纪要").unwrap();
        assert_eq!(renamed.file_name().unwrap(), "纪要.md");
        assert!(renamed.is_file());
        assert!(!next.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_markdown_reads_notes_and_skips_noise() {
        let root = std::env::temp_dir().join(format!("frisket-lib-{}", std::process::id()));
        let outside = std::env::temp_dir().join(format!("frisket-lib-out-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(root.join("子")).unwrap();
        fs::create_dir_all(root.join("a/b/c/d/e")).unwrap();
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::create_dir_all(root.join(".hidden")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(root.join("甲.md"), b"a").unwrap();
        fs::write(root.join("子/乙.markdown"), b"b").unwrap();
        fs::write(root.join("跳过.txt"), b"t").unwrap();
        fs::write(root.join("a/b/c/d/深.md"), b"d").unwrap();
        fs::write(root.join("a/b/c/d/e/太深.md"), b"e").unwrap();
        fs::write(root.join("node_modules/依赖.md"), b"n").unwrap();
        fs::write(root.join(".hidden/隐藏.md"), b"h").unwrap();
        fs::write(outside.join("逃.md"), b"x").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            symlink(outside.join("逃.md"), root.join("链接.md")).unwrap();
            symlink(&outside, root.join("外链")).unwrap();
        }

        let listed = doc_list_markdown(root.to_string_lossy().into_owned()).unwrap();
        let names: Vec<String> = listed.into_iter().map(|file| file.name).collect();
        assert!(names.iter().any(|name| name == "甲.md"));
        assert!(names.iter().any(|name| name == "子/乙.markdown"));
        assert!(names.iter().any(|name| name == "a/b/c/d/深.md"));
        assert!(!names.iter().any(|name| {
            name.contains("太深")
                || name.ends_with(".txt")
                || name.contains("隐藏")
                || name.contains("依赖")
                || name.contains("逃")
                || name.contains("链接")
        }));
        assert_eq!(doc_list_markdown("notes".into()).unwrap_err(), "请使用绝对路径");
        assert_eq!(
            doc_list_markdown("/tmp/../etc".into()).unwrap_err(),
            "路径不合法"
        );

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn list_markdown_stops_at_three_hundred() {
        let root = std::env::temp_dir().join(format!("frisket-lib-cap-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        for index in 0..301 {
            fs::write(root.join(format!("n{index:03}.md")), b"x").unwrap();
        }
        let listed = doc_list_markdown(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(listed.len(), 300);
        let _ = fs::remove_dir_all(&root);
    }

    fn meta(id: &str, path: &str) -> DocumentMeta {
        DocumentMeta {
            id: id.to_string(),
            path: path.to_string(),
            title: id.to_string(),
            preview: String::new(),
            word_count: 1,
            created_at: "a".to_string(),
            opened_at: "b".to_string(),
        }
    }

    #[test]
    fn omit_history_drops_matching_records_only() {
        let items = vec![
            meta("/notes/甲.md", "/notes/甲.md"),
            meta("hash-乙", "/notes/乙.md"),
            meta("/notes/丙.md", "/notes/丙.md"),
        ];
        let left = omit_history_entries(&items, &["/notes/甲.md".into(), "/notes/乙.md".into()]);
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, "/notes/丙.md");
        assert_eq!(omit_history_entries(&items, &[]).len(), 3);
        assert_eq!(omit_history_entries(&items, &["".into(), "/missing".into()]).len(), 3);
    }

    #[test]
    fn iso_epoch_is_utc() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
    }

    #[test]
    fn memory_snapshot_keeps_one_and_revert_toggles() {
        let store = SnapshotStore::Memory;
        let key = format!("draft-{}", std::process::id());
        let first = record_ai_write(&store, &key, &key, "", "采纳前", Some("rewrite".into()), Some(2)).unwrap();
        assert_eq!(first.reason, "ai-write");
        let second = record_ai_write(&store, &key, &key, "", "第二次采纳前", None, None).unwrap();
        let listed = list_ai_writes(&store, &key).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, second.id);
        let current = "采纳后的正文，又手改了一句";
        let restored = revert_ai_write(&store, &key, current).unwrap();
        assert_eq!(restored, "第二次采纳前");
        let back = revert_ai_write(&store, &key, &restored).unwrap();
        assert_eq!(back, current);
        assert!(!snapshot_file(&std::env::temp_dir(), &key).exists());
    }

    #[test]
    fn disk_snapshot_roundtrip_stays_in_the_data_dir() {
        let dir = std::env::temp_dir().join(format!("frisket-snap-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let store = SnapshotStore::Disk(dir.clone());
        let key = "/tmp/frisket-note.md";
        record_ai_write(&store, key, key, key, "采纳前全文", Some("shorten".into()), Some(-3)).unwrap();
        let file = snapshot_file(&dir, key);
        assert!(file.starts_with(&dir));
        assert_eq!(list_ai_writes(&store, key).unwrap()[0].path, key);
        assert_eq!(revert_ai_write(&store, key, "写回后又改过").unwrap(), "采纳前全文");
        assert_eq!(revert_ai_write(&store, key, "采纳前全文").unwrap(), "写回后又改过");
        let _ = fs::remove_dir_all(&dir);
    }
}

fn file_name_only(suggested: &str) -> String {
    Path::new(suggested)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "未命名.md".to_string())
}
