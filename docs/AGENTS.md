# 子智能体分工与协作规约

项目由多个子智能体并行开发。**并行最大的风险是文件所有权冲突**，因此按文件所有权划分，互不重叠。

## 分工

| 子智能体 | 阶段 | 文件所有权（唯一） | 职责 |
|---|---|---|---|
| **内核** `editor-core` | M0–M1 | `src/core/editor*.ts`、`src/core/docCache.ts`、`src/core/lifecycle.ts`、`src/editor/**` | CM6 三层 decoration 引擎、GFM 扩展、widget、IME 处理、光标映射 |
| **视觉** `ui-shell` | M0–M4 | `src/styles/**`、`src/components/**`（**除 `src/components/ai/`**）、`src/store/**`、`src/App.vue` | 三栏布局、快捷栏、popover、主题系统、玻璃视觉、设置面板 |
| **原生** `native` | M1–M4 | `src-tauri/**`、`src/ipc/**` | Rust 文件读写、监听、keyring、快照 diff、玻璃探针、注册全部 command |
| **AI** `ai-engine` | M2 | `src-tauri/src/ai/**`、`src/components/ai/**` | Provider 抽象、SSE 流式、划选增强六道锁、Ghost text、Agent 任务 |
| **门禁** `qa` | 全程 | `tests/**`、`vitest.config.ts`、`playwright.config.ts` | CLS / IME / 越界防护 / 包体的自动化断言 |

## 五条规约

1. **只写自己所有权内的文件。** 需要改别人文件时，在报告中列「请求变更：<文件> → <具体改动>」，由集成方统一裁决执行。

2. **共享类型一律从 `@/core/interfaces` import，禁止重复定义。** 这类同名类型冲突是并行开发最常见的结构性事故。

3. **command 名称由「原生」子智能体在 `src/ipc/commands.ts` 单一定义。** 其他子智能体不得自行发明 invoke 名。

4. **不擅自引入依赖。** 需要新包必须报告「建议新增依赖：<名>@<精确版本> — <理由>」，批准后再加。版本一律精确锁定，不用 `^`。

5. **不写占位 TODO 后宣称完成。** 每个子任务给出可验证标准；达不到就如实报告未完成。

## 依赖关系

```
        ┌──────────┐
        │ 内核     │  先产出 interfaces.ts（阻塞所有人）
        └────┬─────┘
             ↓
   ┌─────────┼─────────┐
   ↓         ↓         ↓
┌──────┐ ┌──────┐ ┌──────┐
│ 视觉 │ │ 原生 │ │ 门禁 │
└──────┘ └──────┘ └──────┘
             ↓
        ┌──────────┐
        │   AI     │  M2 才启动，依赖原生侧的 command 定义
        └──────────┘
```

`interfaces.ts` 与 `commands.ts` 必须最先落定，否则各子智能体会各自发明类型和命令名，返工成本远高于收益。

## 编码规范

| 项 | 规则 |
|---|---|
| 命名 | 语义完整，不用缩写。`decorationSet` 不写 `ds` |
| 文件长度 | 单文件 ≤ 300 行，超出必须拆分。widget 各自独立文件 |
| 函数长度 | ≤ 40 行。超出先想「是否该拆成两个函数」 |
| 注释 | 中文，只写「为什么」不写「做了什么」。每个文件顶部块注释说明**它在整体中的位置** |
| 类型 | 全部显式标注，**禁用 any**。对外接口必须有显式返回类型 |
| 装饰器 | 三层分离严格落地，影响纵向布局的一律 StateField（评审必查项） |
| CSS | 行高只由行 class 决定；隐藏标记只用 `Decoration.replace({})` 对应的 class；禁止 `height:0` / `display:none` 作用于整行 |
| 提交信息 | Conventional Commits：`feat(editor): 表格 widget 支持点击进入源码态` |

## 门禁

M0 的门禁是**止损线**，压不下来不进 M1：

| 门禁 | 阈值 | 校验方式 |
|---|---|---|
| CLS | 10 次光标进出 < 0.01 | Playwright `PerformanceObserver('layout-shift')` |
| IME 零丢字 | 三场景全通过 | CDP `Input.imeSetComposition`，**Chromium + WebKit 双引擎** |
| 大文档 | 5000 行滚动 FPS ≥ 55 | Playwright 帧计数 |
| 渲染正确性 | CommonMark 60 + GFM 60 条 | Vitest 快照 |

## 密钥安全

API key 存 macOS 钥匙串，明文永不进前端。`pre-commit` 钩子拦截密钥误提交，确认是误报时用 `SKIP_SECRET_CHECK=1 git commit` 跳过。
