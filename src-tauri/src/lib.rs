//! Slate 桌面端入口
//!
//! 架构位置：Rust 侧只负责原生能力（文件、钥匙串、玻璃、快照）与网络请求，
//! 不持有任何编辑器状态。编辑器状态在 `src/core/docCache.ts` 的模块级 Map 中，
//! 由前端 `view.setState()` 切换。两侧通过 `src/ipc/commands.ts` 的命令表通信。

mod glass;

use glass::GlassMode;

/// 应用启动。
///
/// 刻意保持极简：setup 里只做窗口与玻璃两件事（目标 < 5ms）。
/// 磁盘 IO（读历史、扫目录）全部延后到前端异步触发，避免阻塞首屏。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 玻璃模式必须在窗口创建后探测，且结果要下发给前端做降级判断。
            // 前端不自行判断 —— @supports(backdrop-filter) 在 Safari 恒为真，不可靠。
            let mode = glass::probe_and_apply(app.handle());
            eprintln!("[slate] glass mode: {mode:?}");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Slate 失败");
}

/// 供前端查询当前玻璃模式。前端不应自行推断。
#[tauri::command]
fn glass_probe() -> GlassMode {
    GlassMode::default()
}
