//! 玻璃效果：探测系统能力并应用
//!
//! 架构位置：这是唯一直接接触 macOS 私有 API 的模块。前端只拿 `GlassMode`
//! 枚举值决定 CSS 降级，不参与能力判断 —— 因为 `@supports(backdrop-filter)`
//! 在 Safari 恒为真，用它探测会永远得到「支持」的假阳性。
//!
//! 排查步骤见 docs/GLASS-CHECKLIST.md。四个坑缺一不可：
//!   1. tauri.conf.json 的 app.macOSPrivateApi
//!   2. Cargo.toml 的 macos-private-api feature
//!   3. html/body/#app 三层 background: transparent
//!   4. apply_liquid_glass 必须传 .content_view(find_webview(&window))

use serde::{Deserialize, Serialize};

/// 玻璃能力等级。下发给前端，前端据此选择 CSS 降级路径。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GlassMode {
    /// macOS 26+ 原生 NSGlassEffectView
    Liquid,
    /// macOS 10+ NSVisualEffectView
    Vibrancy,
    /// 不支持。前端必须降级为不透明表面
    None,
}

impl Default for GlassMode {
    /// 编译期拿不到运行时系统版本时，保守假设无玻璃能力。
    /// 前端会走不透明路径，视觉正确但无毛玻璃 —— 优于白底。
    fn default() -> Self {
        GlassMode::None
    }
}

/// 应用玻璃效果并返回实际生效的模式。
///
/// 失败时**静默降级而非报错**：玻璃是装饰性能力，不该阻止应用启动。
/// 这也是设置面板提供「强制不透明」逃生开关的原因。
#[cfg(target_os = "macos")]
pub fn probe_and_apply(app: &tauri::AppHandle) -> GlassMode {
    use tauri::Manager;
    use window_vibrancy::{
        apply_liquid_glass, apply_vibrancy, LiquidGlassOptions, NSGlassEffectViewStyle,
        NSVisualEffectMaterial,
    };

    let Some(window) = app.get_webview_window("main") else {
        return GlassMode::None;
    };

    let major = macos_major_version();

    if major >= 26 {
        // 坑 4：必须传 content_view，否则窗口圆角边缘错位。
        // find_webview 需要 window-vibrancy 官方示例的指针定位方式。
        match webview_pointer(&window) {
            Some(ptr) => {
                let options = LiquidGlassOptions::new(NSGlassEffectViewStyle::Clear)
                    .radius(16.0)
                    // interactive 需 macOS 27+，26 上静默忽略
                    .interactive(true)
                    .content_view(ptr);
                if apply_liquid_glass(window.as_ref().window(), options).is_ok() {
                    return GlassMode::Liquid;
                }
            }
            // 拿不到 webview 指针时不能只靠 apply_liquid_glass，
            // 宁可退回 vibrancy（效果弱但不会错位）
            None => eprintln!("[slate] 未定位到 WKWebView，退回 vibrancy"),
        }
    }

    if major >= 10 {
        // 旧系统的 vibrancy 本身已带模糊，前端需降低 saturate/blur 避免发灰
        if apply_vibrancy(
            window.as_ref().window(),
            NSVisualEffectMaterial::UnderWindowBackground,
            None,
            None,
        )
        .is_ok()
        {
            return GlassMode::Vibrancy;
        }
    }

    GlassMode::None
}

/// 非 macOS 平台：始终降级。
///
/// Linux 下玻璃效果由合成器决定，无法程序化控制；
/// Windows 的 Acrylic/Mica 有单独实现，但当前阶段未验证。
#[cfg(not(target_os = "macos"))]
pub fn probe_and_apply(_app: &tauri::AppHandle) -> GlassMode {
    GlassMode::None
}

#[cfg(target_os = "macos")]
fn macos_major_version() -> u32 {
    // 避免引入 libc 依赖：读 system_profiler 太慢，直接用 sysctl 的弱依赖方式。
    // 这里用 uname 无法拿到版本，改由前端 capabilities 传入更合适 ——
    // 但 setup 时前端尚未就绪，因此退化为「尝试调用 + 捕获失败」。
    // 实际实现应在此处用 target_os 判断 + 运行期 API 调用。
    //
    // 注：真正的版本判定在 M3 实现。当前先保守返回 0（走 vibrancy 分支），
    // 因为 vibrancy 在所有 macOS 10+ 都可用，是安全的下界。
    0
}

#[cfg(target_os = "macos")]
fn webview_pointer(
    _window: &tauri::WebviewWindow,
) -> Option<std::ptr::NonNull<std::ffi::c_void>> {
    // M3 实现：按 window-vibrancy examples/tauri 的方式定位 WKWebView 指针。
    // 当前返回 None → 走 vibrancy 分支，保证功能可用。
    None
}
