//! 玻璃效果：探测系统能力并应用。
//!
//! 前端只消费 GlassMode，不自己猜系统版本。
//! `@supports (backdrop-filter)` 在 WebKit 里永远为真，不能拿来判断毛玻璃。

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

static CURRENT: Mutex<GlassMode> = Mutex::new(GlassMode::None);

/// 玻璃能力等级。下发给前端，前端据此选择 CSS 降级路径。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GlassMode {
    /// macOS 26+ 原生 NSGlassEffectView
    Liquid,
    /// macOS 10+ NSVisualEffectView，桌面被磨砂
    Vibrancy,
    /// 不支持。前端必须降级为不透明表面
    None,
}

impl Default for GlassMode {
    fn default() -> Self {
        GlassMode::None
    }
}

pub fn current() -> GlassMode {
    *CURRENT.lock().unwrap_or_else(|poison| poison.into_inner())
}

fn remember(mode: GlassMode) -> GlassMode {
    if let Ok(mut slot) = CURRENT.lock() {
        *slot = mode;
    }
    mode
}

/// 应用玻璃效果并返回实际生效的模式。失败时降级，不阻止启动。
#[cfg(target_os = "macos")]
pub fn probe_and_apply(app: &tauri::AppHandle) -> GlassMode {
    use tauri::Manager;

    let Some(window) = app.get_webview_window("main") else {
        return remember(GlassMode::None);
    };

    let major = macos_major_version();
    if major == 0 || major >= 26 {
        if apply_liquid(&window) {
            return remember(GlassMode::Liquid);
        }
    }
    if apply_vibrancy_effect(&window) {
        return remember(GlassMode::Vibrancy);
    }
    remember(GlassMode::None)
}

#[cfg(not(target_os = "macos"))]
pub fn probe_and_apply(_app: &tauri::AppHandle) -> GlassMode {
    remember(GlassMode::None)
}

#[cfg(target_os = "macos")]
fn apply_liquid(window: &tauri::WebviewWindow) -> bool {
    use objc2_app_kit::NSView;
    use std::sync::mpsc::sync_channel;
    use window_vibrancy::{apply_liquid_glass, LiquidGlassOptions, NSGlassEffectViewStyle};

    // with_webview 的闭包是 'static。主线程上它会当场执行，
    // 所以这里用 try_recv：没当场跑完就放弃液态玻璃，改走磨砂。
    let owned = window.clone();
    let (tx, rx) = sync_channel(1);
    let scheduled = owned.clone().with_webview(move |platform| {
        let view = unsafe { &*(platform.inner() as *mut NSView) };
        let options = LiquidGlassOptions::new(NSGlassEffectViewStyle::Clear)
            .radius(16.0)
            .interactive(true)
            .content_view(view);
        let _ = tx.send(apply_liquid_glass(&owned, options).is_ok());
    });
    scheduled.is_ok() && rx.try_recv().unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn apply_vibrancy_effect(window: &tauri::WebviewWindow) -> bool {
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

    apply_vibrancy(
        window,
        NSVisualEffectMaterial::HudWindow,
        Some(NSVisualEffectState::Active),
        Some(16.0),
    )
    .is_ok()
}

#[cfg(target_os = "macos")]
fn macos_major_version() -> u32 {
    let Ok(output) = std::process::Command::new("/usr/bin/sw_vers")
        .arg("-productVersion")
        .output()
    else {
        return 0;
    };
    let text = String::from_utf8_lossy(&output.stdout);
    text.trim()
        .split('.')
        .next()
        .and_then(|part| part.parse::<u32>().ok())
        .unwrap_or(0)
}
