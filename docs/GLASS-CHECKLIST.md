# macOS 透明窗口排查清单

透明窗口 + 毛玻璃/液态玻璃需要以下四项**同时**满足。缺任一项都会出现白底、边缘错位或残影。

## 四件事

| # | 位置 | 配置 | 缺了会怎样 |
|---|---|---|---|
| 1 | `src-tauri/tauri.conf.json` | `app.macOSPrivateApi: true` | 玻璃效果完全不生效 |
| 2 | `src-tauri/Cargo.toml` | `tauri` features 含 `macos-private-api` | 同上 |
| 3 | `src/styles/` | `html` / `body` / `#app` **三层**都 `background: transparent` | 窗口渗出白底 |
| 4 | `src-tauri/src/glass/mod.rs` | `apply_liquid_glass` 必须传 `.content_view(find_webview(&window))` | 窗口圆角边缘错位 |

第 3 项容易漏：很多示例只写了 `body { background: transparent }`，但 `#app` 若有背景色仍会挡住。

第 4 项的 `find_webview` 需要按 window-vibrancy 官方示例定位 WKWebView 指针后 reparent 到玻璃层的 contentView。

## 排查顺序

出现异常时按此顺序查，不要跳步：

1. **Rust 是否真的调用了玻璃 API？** 看启动日志打印的 `GlassMode`
2. **三处 transparent 是否都写了？** DevTools 里检查 `html` / `body` / `#app` 的 computed background
3. **不透明层是否画在了玻璃层上方？** 不透明的 WebView 背景会**完全阻断**玻璃效果。opaque 层必须在 glass view **下方**（NSBox）
4. **是否在页面切换/缩放后出现？** 若是，属 WebKit 残影，见下方「已知无解项」

## 已知无解项

**页面切换 / 窗口缩放后的残影**：WebKit 透明窗口的社区已知问题，Apple 未提供公开修复方案。

**架构层面的规避**：Frisket 是单页应用，**不使用 vue-router**，全部视图由 store 驱动。没有路由切换就没有页面切换，从根上规避了这个残影。

不要为了功能方便引入路由 —— 引入前先回到这个文档确认代价。

## 降级策略

`GlassMode` 由 Rust 侧探测后下发，**前端不自行判断**：

| GlassMode | 条件 | CSS 处理 |
|---|---|---|
| `liquid` | macOS 26+ | 全套玻璃 |
| `vibrancy` | macOS 10+ | `saturate` 降到 140%、blur 降到 14px。旧系统 vibrancy 本身已模糊，叠加过度会发灰 |
| `none` | 其他 | **必须降级为不透明表面**（`background: var(--bg-base)`），用阴影和边框表达层次，**不能留半透明** |

`none` 的检测不能只靠 `@supports (backdrop-filter)` —— Safari 也支持 backdrop-filter，这个检测永远为真。可靠做法是 Rust 探测后下发 + 监听 `prefers-reduced-transparency` 媒体查询 + 运行时探针。

系统开启「降低透明度」时前端 CSS 需同步提升不透明度，避免「原生不透明 + CSS 半透明」的割裂。

## 逃生通道

设置面板提供「**强制不透明**」开关：`transparent: false` + 不调用 vibrancy。

玻璃一出问题，用户一键恢复，不需要重启应用、不需要命令行。

## 诊断信息

设置面板有「复制诊断信息」，导出结构化数据而非截图：

```
GlassMode / 是否 opaque / prefers-reduced-transparency
WKWebView 版本 / 系统版本 / macOSPrivateApi 是否生效
```

远程排障从「你截图看看」变成「点一下给我数据」。

## 分发影响

`macOSPrivateApi: true` 使用私有 API，**与 App Store 审核冲突**。

因此 Frisket **不上 App Store**，分发方式为 Developer ID 签名 + Apple 公证后的直链下载 / Homebrew Cask。README、下载页、首次启动三处都需写明。

未签名构建首次启动时 Gatekeeper 会拦截，需在「系统设置 → 隐私与安全」放行，或：

```bash
xattr -cr /Applications/Frisket.app
```
