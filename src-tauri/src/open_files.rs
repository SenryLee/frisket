//! Finder 双击 Markdown 时，把路径交给窗口。
//!
//! 启动瞬间前端还没挂上监听，路径先留在这里。
//! 窗口就绪后再取走。应用已经开着时，同一条路径也会推一次事件。

use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Url};

const MARKDOWN_HANDLER: &str = "markdown-handler";
const MARKDOWN_TYPE: &str = "net.daringfireball.markdown";
const BUNDLE_ID: &str = "com.frisket.md";

pub struct OpenedFiles {
    paths: Mutex<Vec<String>>,
}

impl OpenedFiles {
    pub fn push(&self, incoming: Vec<String>) {
        let mut guard = self
            .paths
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        for path in incoming {
            if !guard.iter().any(|have| have == &path) {
                guard.push(path);
            }
        }
    }

    pub fn take(&self) -> Vec<String> {
        let mut guard = self
            .paths
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        std::mem::take(&mut *guard)
    }
}

impl Default for OpenedFiles {
    fn default() -> Self {
        Self {
            paths: Mutex::new(Vec::new()),
        }
    }
}

pub fn capture_urls(app: &AppHandle, urls: &[Url]) {
    let paths = urls
        .iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter(|path| is_markdown_file(path))
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    deliver(app, paths);
}

pub fn capture_arguments(app: &AppHandle) {
    let paths = std::env::args()
        .skip(1)
        .map(PathBuf::from)
        .filter(|path| path.is_file() && is_markdown_file(path))
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    deliver(app, paths);
}

/// 只在正式安装包里做一次。开发窗口不改系统的默认打开方式。
pub fn claim_markdown_handler(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let flag = dir.join(MARKDOWN_HANDLER);
    if flag.is_file() {
        return;
    }
    if let Some(bundle) = app_bundle() {
        let _ = std::process::Command::new("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister")
            .arg("-f")
            .arg(&bundle)
            .status();
    }
    if !set_default_handler(MARKDOWN_TYPE, BUNDLE_ID) {
        return;
    }
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let _ = std::fs::write(flag, "1\n");
}

fn deliver(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Some(opened) = app.try_state::<OpenedFiles>() {
        opened.push(paths.clone());
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.emit("doc:open", &paths);
}

fn app_bundle() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    let bundle = executable.parent()?.parent()?.parent()?;
    if bundle.extension().and_then(|ext| ext.to_str()) == Some("app") {
        Some(bundle.to_path_buf())
    } else {
        None
    }
}

fn is_markdown_file(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|ext| ext.to_str()) else {
        return false;
    };
    matches!(
        extension.to_ascii_lowercase().as_str(),
        "md" | "markdown" | "mdown" | "mkd" | "mdwn" | "mdx"
    )
}

fn set_default_handler(content_type: &str, bundle_id: &str) -> bool {
    let content = cf_string(content_type);
    let bundle = cf_string(bundle_id);
    if content.is_null() || bundle.is_null() {
        if !content.is_null() {
            unsafe { CFRelease(content) };
        }
        if !bundle.is_null() {
            unsafe { CFRelease(bundle) };
        }
        return false;
    }
    // kLSRolesAll。编辑器要能成为双击时的打开方式。
    let status = unsafe { LSSetDefaultRoleHandlerForContentType(content, 0xFFFF_FFFF, bundle) };
    unsafe {
        CFRelease(content);
        CFRelease(bundle);
    }
    status == 0
}

fn cf_string(text: &str) -> *const c_void {
    unsafe {
        CFStringCreateWithBytes(
            std::ptr::null(),
            text.as_ptr(),
            text.len() as isize,
            0x0800_0100,
            0,
        )
    }
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringCreateWithBytes(
        allocator: *const c_void,
        bytes: *const u8,
        num_bytes: isize,
        encoding: u32,
        is_external: u8,
    ) -> *const c_void;
    fn CFRelease(value: *const c_void);
}

#[link(name = "CoreServices", kind = "framework")]
extern "C" {
    fn LSSetDefaultRoleHandlerForContentType(
        content_type: *const c_void,
        role: u32,
        bundle_id: *const c_void,
    ) -> i32;
}

#[cfg(test)]
mod tests {
    use super::is_markdown_file;
    use std::path::Path;

    #[test]
    fn markdown_extensions_are_accepted() {
        assert!(is_markdown_file(Path::new("/tmp/笔记.md")));
        assert!(is_markdown_file(Path::new("/tmp/Note.MD")));
        assert!(is_markdown_file(Path::new("/tmp/draft.markdown")));
        assert!(is_markdown_file(Path::new("/tmp/draft.mdx")));
    }

    #[test]
    fn other_files_are_left_alone() {
        assert!(!is_markdown_file(Path::new("/tmp/笔记.txt")));
        assert!(!is_markdown_file(Path::new("/tmp/图片.png")));
        assert!(!is_markdown_file(Path::new("/tmp/无扩展名")));
    }
}
