//! Frisket 桌面端入口。
//!
//! Rust 侧只负责文件、历史和窗口毛玻璃。编辑器状态在前端。

mod ai;
mod files;
mod glass;
mod open_files;

use ai::{ai_cancel, ai_chat, ai_list_models, settings_get, settings_set};
use files::{
    doc_create, doc_history, doc_history_remove, doc_history_touch, doc_list_markdown,
    doc_pick_folder, doc_pick_open, doc_pick_save, doc_read, doc_rename, doc_reveal_in_finder,
    doc_write, wallpaper_pick,
};
use glass::GlassMode;
use open_files::OpenedFiles;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(OpenedFiles::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            glass_probe,
            doc_take_opens,
            doc_pick_open,
            doc_pick_save,
            doc_pick_folder,
            doc_list_markdown,
            doc_create,
            doc_rename,
            doc_read,
            doc_write,
            doc_reveal_in_finder,
            doc_history,
            doc_history_remove,
            doc_history_touch,
            wallpaper_pick,
            settings_get,
            settings_set,
            ai_chat,
            ai_cancel,
            ai_list_models,
        ])
        .setup(|app| {
            migrate_legacy_data(app.handle());
            open_files::claim_markdown_handler(app.handle());
            open_files::capture_arguments(app.handle());
            let mode = glass::probe_and_apply(app.handle());
            eprintln!("[frisket] glass mode: {mode:?}");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("glass:mode", mode);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("启动 Frisket 失败");

    app.run(|app, event| {
        if let tauri::RunEvent::Opened { urls } = event {
            open_files::capture_urls(app, &urls);
        }
    });
}

/// 标识从 com.slate.md 改成 com.frisket.md 之后，应用数据目录会换地方。
/// 新目录还没有这些文件时，从旧目录复制一份。旧文件留着，旧安装还能开。
fn migrate_legacy_data(app: &tauri::AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let Some(home) = std::env::var_os("HOME") else {
        return;
    };
    let legacy = std::path::PathBuf::from(home).join("Library/Application Support/com.slate.md");
    if !legacy.is_dir() {
        return;
    }
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    for name in ["history.json", "ai-settings.json", "api-key"] {
        let from = legacy.join(name);
        let to = dir.join(name);
        if !from.is_file() || to.exists() {
            continue;
        }
        if std::fs::copy(&from, &to).is_err() {
            continue;
        }
        if name == "api-key" {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&to, std::fs::Permissions::from_mode(0o600));
            }
        }
    }
}

/// 供前端在错过启动事件时再问一次。返回的是已经应用过的模式。
#[tauri::command]
fn glass_probe() -> GlassMode {
    glass::current()
}

/// 取走 Finder 交来、前端还没打开的 Markdown 路径。
#[tauri::command]
fn doc_take_opens(opened: tauri::State<'_, OpenedFiles>) -> Vec<String> {
    opened.take()
}
