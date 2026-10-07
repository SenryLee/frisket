# Slate 项目长期记忆

## 项目定位
本地离线 Markdown 编辑器，对标 Typora。工作目录 `/Users/senrylee/Coding/projects/md文档编辑器`。

**核心特色**：源码永远是纯 Markdown（无反序列化）、所见即所得、AI 只处理划选范围、液态玻璃。

## 技术栈（已锁定，精确版本，勿升级）
- Tauri 2.12.1 / Rust 1.95
- CodeMirror 6：`@codemirror/view` 6.43.13、`state` 6.7.6、`lang-markdown` 6.5.2
- Vue 3.5 / Vite 7 / TypeScript 5.9

**版本锁定的原因**：`@codemirror/view` 在 6.39.6–6.39.8 连续修了三个 IME 相关 bug，升级必须伴随 IME 回归测试。

## 四条硬约束
| 编号 | 约束 | 阈值 |
|---|---|---|
| H1 | 轻量 | dmg ≤ 12MB，冷启动 ≤ 400ms，空闲内存 ≤ 80MB |
| H2 | 源码即真相 | `state.doc` 永远是纯 Markdown |
| H3 | 零抖动 | 10 次光标进出 CLS < 0.01 |
| H4 | 零丢字 | 中文 IME 零丢字 |

**H3/H4 是止损线，M0 压不下来不进 M1。**

## 关键决策与理由（勿轻易推翻）

| 决策 | 理由 |
|---|---|
| 不用 ProseMirror | 它把文档变成结构树，屏幕源码与内部模型不一致，序列化后「源码读回来不一样」 |
| 不用 markdown-it/marked | CM6 已提供增量解析，再加渲染器 = 两套解析器 + 两份内存 |
| 不用 Pinia | `EditorState` 必须放模块级 `Map`，最大状态本就不在 store |
| 不用 SQLite | 1000 条历史 ≈ 几百 KB，JSON + 原子写足够 |
| 不用 libgit2 | 快照只需「备选版本 + 接受/拒绝」，diff 足够 |
| 主题切换零 dispatch | 只改 `documentElement.dataset.theme`，CodeMirror theme 全用 CSS 变量 |
| 单页无 vue-router | macOS 透明窗口页面切换有 WebKit 残影，架构上规避 |
| Ghost text 用绝对定位 overlay | `Decoration.replace` 会改变行宽 → 可能换行 → CLS 回归 |

## 三个核心技术风险

1. **CLS（最高）** —— 行高只由行 CSS class 决定；隐藏标记只用 `Decoration.replace({})`；禁止 `height:0`/`display:none` 作用于整行；影响纵向布局的 decoration 一律 StateField。CI 门禁阈值 0.01。

2. **中文 IME** —— `view.composing` 时只 map 不重算；标记成对替换，边界不落在光标字符上；`compositionend` 后 rAF 强制重算。CDP `Input.imeSetComposition` 是 Chromium-only，WebKit 需替代方案。

3. **macOS 透明窗口** —— 四件事缺一不可：`macOSPrivateApi` + Cargo feature + html/body/#app 三层 transparent + `apply_liquid_glass` 传 `.content_view(find_webview())`。因私有 API **不上 App Store**，走 Developer ID + 公证。

## 子智能体分工（按文件所有权，互不重叠）
| 角色 | 文件所有权 |
|---|---|
| 内核 editor-core | `src/editor/**`、`src/core/editor*.ts`、`docCache.ts`、`lifecycle.ts` |
| 视觉 ui-shell | `src/styles/**`、`src/components/**`（除 `ai/`）、`src/store/**`、`src/App.vue` |
| 原生 native | `src-tauri/**`、`src/ipc/**` |
| AI ai-engine | `src-tauri/src/ai/**`、`src/components/ai/**` |
| 门禁 qa | `tests/**`、vitest/playwright 配置 |

共享类型唯一来源：`src/core/interfaces.ts`。command 名称唯一来源：`src/ipc/commands.ts`。

## 待实现的显式占位
- `src-tauri/src/glass/mod.rs` 的 `macos_major_version()` 与 `webview_pointer()` 返回保守值，M3 实现。**不要写看起来能跑但实际错位的假实现。**
- frontmatter / 脚注的 lezer 扩展（M1）

## 默认假设（用户未逐条确认，可推翻）
- 命名 **Slate**，bundle `com.slate.md`
- 历史仅本机文件路径，**不引入工作区文件夹概念**
- HTML 导出排到 v1 之后
- 先做未签名本地构建，公证放 v1 之后
- 首版**不渲染** HTML 块与数学公式（保留源码）
- Setext 标题**不隐藏下划线行**（隐藏等于删行，会产生巨大位移）

## 工程约定
- 提交前自动拦截密钥：钩子已装（`.githooks/pre-commit`），`SKIP_SECRET_CHECK=1` 可跳过
- API key 存 macOS 钥匙串，**不存在 `get_api_key` 命令**，网络请求全在 Rust 侧
- tsconfig 开了 `noUnusedLocals` / `noUnusedParameters` / `noUncheckedIndexedAccess` / `verbatimModuleSyntax`

## 环境注意事项
本机 pnpm 在沙箱下安装依赖时 `sandbox-exec` 会崩（`data object length exceeds maximum`）。
**绕过方式：改用 `npm install`**。Bash 通道整体失效时（任何命令都返回该错误），改用文件读写工具继续推进。
