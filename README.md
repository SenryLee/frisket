# Slate

本地离线 Markdown 编辑器。对标 Typora，源码永远是纯 Markdown。

## 技术栈

| 层 | 选择 |
|---|---|
| 运行时 | Tauri 2（复用系统 WebView，不打包 Chromium） |
| 编辑内核 | CodeMirror 6 + @lezer/markdown（GFM） |
| 前端 | Vue 3 + Vite |
| 后端 | Rust |

## 开发

前置：Node ≥ 20、pnpm ≥ 10、Rust ≥ 1.77（macOS 需 Xcode Command Line Tools）。

```bash
pnpm install
pnpm tauri dev      # 开发（带热更新）
pnpm tauri build    # 构建
```

仅前端（浏览器调试，不含 Rust 能力）：

```bash
pnpm dev
```

## 平台说明

**当前仅支持 macOS。** 玻璃效果依赖系统原生 API，其他平台的降级路径尚未验证。

**本项目不上 App Store。** 液态玻璃需要 `macOSPrivateApi: true`（私有 API），这与 App Store 审核冲突。分发方式为 Developer ID 签名 + 公证后的直链下载 / Homebrew Cask。

未签名构建首次启动时 Gatekeeper 会拦截，需在「系统设置 → 隐私与安全」中放行，或：

```bash
xattr -cr /Applications/Slate.app
```

## 玻璃效果的四件事

macOS 透明窗口 + 毛玻璃/液态玻璃需要以下四项同时满足，缺任一项都会出现白底、边缘错位或残影。详见 `docs/GLASS-CHECKLIST.md`。

1. `src-tauri/tauri.conf.json` 中 `app.macOSPrivateApi: true`
2. `src-tauri/Cargo.toml` 中启用 `macos-private-api` feature
3. `html` / `body` / `#app` **三层**都要 `background: transparent`
4. 调用 `apply_liquid_glass` 必须传 `.content_view(find_webview(&window))`

若玻璃异常，设置面板有「强制不透明」开关可一键恢复。

## 文档

| 文件 | 内容 |
|---|---|
| `docs/SPEC.md` | 完整技术方案与设计理由 |
| `docs/ARCHITECTURE.md` | 模块边界、依赖方向、状态管理纪律 |
| `docs/AGENTS.md` | 子智能体分工与协作规约 |
| `docs/GLASS-CHECKLIST.md` | macOS 透明窗口排查清单 |

## 隐私

- 文档文件只在本机，不上传
- API key 存于 macOS 钥匙串，**明文永不进前端**（不存在读取 key 的 IPC 命令，网络请求全在 Rust 侧发起）
- AI 请求由本机直连所选厂商，无中转

## License

MIT
