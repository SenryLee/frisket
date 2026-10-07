# Frisket · 技术方案（Spec v0.1）

> 本文是已确认的技术方案。目录见仓库根目录的 `README.md`，架构纪律见 `ARCHITECTURE.md`。

---

## 一、项目定位与硬约束

**一句话定位**：一个装在 macOS 上的、打开就能写字的 Markdown 编辑器，源码永远是纯 Markdown，AI 只在你划定的范围内动手。

**四条不可让步的硬约束**（后续所有技术决策与之冲突时，约束优先）：

| 编号 | 约束 | 量化标准 | 校验方式 |
|---|---|---|---|
| H1 | 轻量 | dmg ≤ 12 MB，冷启动 ≤ 400 ms，空闲内存 ≤ 80 MB | 每次发版自动测量 |
| H2 | 源码即真相 | `state.doc` 永远是纯 Markdown，不存在「渲染模型 → 源码」的反序列化 | 代码约束 + 复制粘贴测试 |
| H3 | 零抖动 | 10 次光标进出元素，Cumulative Layout Shift < 0.01 | CI 门禁（Playwright `layout-shift`） |
| H4 | 零丢字 | 中文 IME 组合输入在任何语法元素内部不丢字、不乱码 | CI 门禁（CDP `Input.imeSetComposition`） |

H3 和 H4 是本项目与「能跑」和「好用」的分界线，也是最容易在上线后才发现的问题。必须做成 CI 门禁而非人工检查。

---

## 二、技术选型

### 2.1 选型结论

| 层 | 选择 | 版本（锁定） | 关键理由 |
|---|---|---|---|
| 运行时 | Tauri 2 | `2.12.1` | 复用系统 WebView，不打包 Chromium。Electron 基础包 80MB+，与 H1 直接冲突 |
| 后端 | Rust | 1.95+ | 文件监听、keychain、diff、加密快照 —— 都需要原生能力 |
| 前端 | Vue 3 + Vite | Vue 3.5 / Vite 7 | 单页应用，无路由（见 §6.4 坑 5） |
| 编辑内核 | CodeMirror 6 | `@codemirror/view` 6.43.13、`state` 6.7.6、`lang-markdown` 6.5.2 | 虚拟化 + 增量解析 + 装饰器机制，是「源码即真相」唯一可行路线 |
| Markdown 解析 | `@lezer/markdown` | 随 CM6 | GFM 扩展已在解析器层实现（Table/Task/Strikethrough 节点） |
| 玻璃效果 | `window-vibrancy` | `0.8.1` | 已并入 Tauri 官方 `tauri-plugin-vibrancy`；macOS 26+ 走原生 `NSGlassEffectView` |
| 密钥存储 | `keyring` | `3` | macOS Keychain，明文永不进前端 |
| diff | `similar` | `2` | diff-match-patch 的 Rust 移植，行级 + 字符级两级 |
| 状态管理 | 自研 ~60 行 | — | 状态量 8 个字段，Pinia 的抽象成本大于收益 |

**版本必须精确锁定（不用 `^`）**：`@codemirror/view` 在 6.39.6 / 6.39.7 / 6.39.8 连续修了三个 IME 相关 bug，其升级必须伴随 IME 回归测试通过。

### 2.2 明确不引入的依赖

| 不引入 | 理由 |
|---|---|
| `markdown-it` / `marked` / `prosemirror-*` | CM6 已提供增量 Markdown 解析。再加一个完整渲染器 = 两套解析器 + 两份内存。渲染层用 decoration 实现 |
| SQLite（`rusqlite`） | 历史记录 1000 条 × 200 字节 ≈ 几百 KB，JSON 文件足够，且 +1.5MB 包体、+ C 编译依赖。原子写（tmp + rename）解决崩溃安全 |
| `libgit2` | 快照需求只要「三个备选版本 + 接受/拒绝」，diff 足够。libgit2 需维护对象库、索引、ref |
| Pinia | `EditorState` 放在模块级 `Map`，最大状态本就不在 store 里 |
| headless Chromium | 导出 PDF 用 `window.print()` + 打印样式表覆盖 90% 需求 |

---

## 三、核心引擎：所见即所得

### 3.1 三条架构铁律

1. **`state.doc` 永远是纯 Markdown 原文。** 所有 decoration 是纯视图层。因此复制、导出、保存、AI diff 全部不需要「反向序列化」。代价是渲染能力受限于 decoration —— 这是主动接受的取舍。
2. **行高只取决于所在行的 CSS class，与语法标记是否可见无关。** 前车之鉴：atomic-editor 早期用 block widget 替换整个块，光标移入展开、移出折叠，CLS ≈ 0.1，UI 视觉振动；改为 inline live preview 后降到 0.003。**隐藏语法标记一律用 `Decoration.replace({})`，绝不用 `height:0` / `line-height:0` / `display:none` 作用于整行。**
3. **凡影响纵向布局的 decoration，必须由 `StateField` 直接 provide 给 `EditorView.decorations`。** CodeMirror 官方明确：作为函数提供的 decoration set 在视口计算之后才被调用，不得引入 block widget 或跨换行的 replace decoration。放 `ViewPlugin` 会让高度图失效，滚动条长度错误。**代码评审 checklist 必查项。**

### 3.2 三层装饰器架构

```
L1  layoutField   (StateField)  ── 影响纵向布局，全文档可见
    表格 / 图片 / 水平线 / Frontmatter / 脚注块 / 任务复选框
L2  inlineField   (StateField)  ── replace 语法标记（隐藏 ** ## ` [] 等）
    必须与 doc 原子生效；展开态由 revealField 决定
L3  stylingPlugin (ViewPlugin)   ── 只扫 view.visibleRanges，纯 mark decoration
    加粗/斜体/标题字号/链接样式/行内代码底色/引用竖线
```

| 字段 | 触发条件 | 扫描范围 |
|---|---|---|
| `layoutField` | `docChanged \|\| selectionSet` | 变更区间 ± 一行（用 `tr.changes.iterChangedRanges()` 定位） |
| `inlineField` | `docChanged \|\| selectionSet` | `visibleRanges` 扩展 2000 字符余量 |
| `stylingPlugin` | `docChanged \|\| selectionSet \|\| viewportChanged` | `view.visibleRanges` |

朴素实现每次 `syntaxTree.iterate` 整棵树，32k 节点文档单次约 2–4ms。`layoutField` 的增量重建是性能关键。

### 3.3 逐语法元素处理策略

替换类型：`M` = Mark（样式化）｜`R` = Replace（零高隐藏）｜`W` = Widget（完全替换）｜`L` = Line

| 语法 | lezer 节点 | 处理 | 关键细节 |
|---|---|---|---|
| ATX 标题 | `ATXHeading1..6` + `HeaderMark` | `L` + `R` | **空标题例外**：`content.size === 0` 时不隐藏，让用户看见刚敲的 `#` |
| Setext 标题 | `SetextHeading1/2` | `L` only | **不隐藏下划线行** —— 隐藏它等于删行，会产生巨大纵向位移。诚实的取舍，Typora 亦然 |
| 粗体 | `StrongEmphasis` + `EmphasisMark`×2 | `M` + `R` | 仅父节点 active 时才 R |
| 斜体 / 删除线 | `Emphasis` / `Strikethrough` | `M` + `R` | 删除线是 GFM |
| 行内代码 | `InlineCode` + `CodeMark`×2 | `M` + `R` | |
| 围栏代码块 | `FencedCode` + `CodeMark`/`CodeInfo` | `M` + `R` | `CodeText` 挂嵌套语言高亮（需顶层注册 `language-data`） |
| 引用块 | `Blockquote` + `QuoteMark` | `L` + `R(→竖线widget)` | 竖线用 `inline-block; width:2px; height:1em`，不改行高 |
| 列表 | `BulletList`/`OrderedList` + `ListMark` | `R(→widget)` | 序号需按 `ListItem` 在 `OrderedList` 中的位置计算，尊重 `start` |
| 任务列表 | `Task` + `TaskMarker` | `R(→CheckboxWidget)` | 放 `layoutField`（会改行高）；点击 dispatch 改 `[ ]`→`[x]` |
| 表格 | `Table`/`TableHeader`/`TableRow`/`TableCell` | `R(→TableWidget)` | 放 `layoutField`，range **不含尾随换行** |
| 图片 | `Image` + `LinkLabel` + `URL` | `R(→ImgWidget)` | inline 节点不跨行，安全 |
| 链接 | `Link` + `LinkMark`×2 + `LinkLabel` + `URL` | `M(LinkLabel)` + `R(LinkMark)` + `R(URL)` | **必须校验 URL 非空** |
| 水平线 | `HorizontalRule` | `R(→`<hr>`)` | 节点范围含换行 → 必须 StateField |
| 硬换行 | `HardBreak` | `M(::after content:'↵')` | 弱化显示 |
| 转义 | `Escape` | `R(反斜杠)` | 隐藏斜杠，显示被转义字符 |
| HTML 块 | `HTMLBlock` | `M(monospace)` | **MVP 不渲染，保留源码** |
| YAML frontmatter | 自定义 `FrontMatter` | `R(→属性表 widget)` | lezer-markdown 原生不支持，需自写 `MarkdownConfig` |
| 脚注 | 自定义 `FootnoteRef` / `FootnoteDef` | `W` / `R` | 需自写解析器 |
| 数学公式 | — | **不解析** | `$...$` 按行内代码样式呈现。半成品的错误渲染比不渲染更糟 |

**链接误渲染防御**：lezer-markdown 不校验引用定义，会把 `[foo]`、`[文字]()` 都产出 `Link` 节点。判定：`urlNode && urlNode.text.trim().length > 0` 为 false 时，**不生成任何 decoration，退化为纯文本，且不隐藏 `[]`**。

### 3.4 「光标进入则展开原始语法」状态机

嵌套元素（粗体里的斜体）必须从内向外判定，且外层激活不能误展开内层。

**算法**：
```
① 收集光标位置的祖先链（tree.resolveInner(head, 1) 向上遍历），
   记录每个祖先的 {type, from, to}
② 遍历视口内节点，对每个 marker 类型 token：
   activated = 祖先链中存在 {type, from, to} 三者全匹配的节点
   activated → 该 marker 不隐藏
```

**为什么正确**：父节点范围严格包含子节点。以 `[**粗斜**](url)` 为例，光标在 URL 上时：`Link` 激活 → reveal 其 `[`、`]`、URL；`StrongEmphasis` 不在链中（范围不含 URL）→ `**` 保持隐藏。正是「只展开光标真正所在的那一层及其外层祖先」。

**空标记的渐进披露**：用户刚敲下 `##` 时若 `#` 立即隐藏，会误以为没生效。规则：空标题、空围栏、空任务标记一律不隐藏，一旦输入内容立即隐藏。同一条规则让「输入即转换」与快捷栏零冲突 —— 前者改渲染层，后者改文档层，永不触碰同一段代码。

### 3.5 表格方案：inline StateField + 点击即退出 Widget

**明确不使用 block widget，也不使用 contenteditable。**

```
mousedown(e):
  e.preventDefault()                      // 阻止 CM6 默认光标放置
  (row, col) = hitTestCell(e)             // 自维护 cellRect 缓存
  pos = tableMap.toSourcePos(row, col)
  dispatch({ selection: {anchor: pos},
             effects: revealEffect.of(tableRange) })
  view.focus()
```

效果：点击任意单元格 → 表格 widget 消失、源码出现、**光标正好落在那格文本起始处**。

**这个决策直接消灭两个已知缺陷**：`codemirror-rich-markdown` 的「点击后光标跳到区域另一端」和 Keystroke 透传地狱。因为点击后立刻进入源码态，**根本不存在透传问题** —— 不需要 contenteditable，不需要精细编排 `ignoreEvent()`。

保留三个交互：Tab / Shift+Tab 单元格跳转（独立 keymap，`Prec.highest`）；源码态下当前行高亮；列对齐（读 `TableDelimiter` 的 `:` 位置决定 `text-align`）。

### 3.6 图片方案

**加载路径：Tauri asset protocol，零字节拷贝。**

```jsonc
// tauri.conf.json
"app": { "security": { "assetProtocol": { "enable": true, "scope": ["$HOME/**"] } } }
// widget: img.src = convertFileSrc(absolutePath)
```

WKWebView 直接从磁盘读取，零 IPC、零 JS 堆占用。对比 base64 走 IPC：5MB 图片 = 6.7MB base64 字符串 + 5MB 解码 bitmap，**两份都在堆里**，且 data URL 会进入 `state.doc`，污染撤销历史与 AI diff。

**因此 MVP 对 data URL 图片只显示 alt 文本 + 「另存为文件」提示，不渲染。**

**零布局抖动**：Rust 侧用 `imagesize` crate 读图片宽高，widget 用 `aspect-ratio: W/H; height: auto` 锁定盒模型，加载前后 CLS = 0。

**远程图片默认不加载**，渲染「远程图片，点击加载」占位块 —— 离线优先 + 隐私。

### 3.7 中文 IME 处理（CM6 上的活跃风险区）

CodeMirror changelog 在 6.39.6 / 6.39.7 / 6.39.8 连续修了三个 composing 相关 bug。四重措施：

**A. 计算冻结**
```
if (view.composing || view.compositionStarted) {
  this.decos = this.decos.map(changes)   // 仅平移位置，绝不重算
  this.dirty = true
  return
}
```
IME 标志通过 `StateField<boolean>` + effect 传播，**不依赖 ViewPlugin 时序**。

**B. 边界纪律** —— 应对 "composing on the boundary of a decoration"：标记 token 成对替换，绝不切在 `**` 中间；任何 replace 的 `to` 恰好等于光标时，收缩 1 字符改用 mark。

**C. 收敛补算** —— `compositionend` 后 `requestAnimationFrame` + 空 effect 强制全量重算。

**D. CI 门禁** —— Playwright + CDP `Input.imeSetComposition`，三个必测场景：在 `**粗|体**` 两星号间输入中文；在行首连续输入中文标点；组合输入进行中点击 AI 面板 / 切主题。

### 3.8 光标位置映射

| 方向 | API | 用途 |
|---|---|---|
| DOM 坐标 → doc pos | `posAtCoords` / `posAndSideAtCoords` | 编辑区常规点击 |
| doc pos → DOM 坐标 | `coordsAtPos` | 划选高亮、AI 结果定位、滚动 |
| Widget 内点击 → doc pos | 手工 rect 命中测试 | 表格（`posAtCoords` 会返回 widget 边缘，不可用） |

### 3.9 样式硬约束

```css
.cm-h1 { font-size: 1.85em; line-height: 1.35; }   /* 行高是常量 */
.cm-h6 { font-size: 0.92em; line-height: 1.35; }
.cm-hidden { display: none; }   /* 隐藏标记：零尺寸，但不改父行高 */
.cm-reveal  { display: inline; } /* 展开态：字符回流，改行宽不改行高 → CLS=0 */
.cm-line   { line-height: var(--lh-body); }
```

---

## 四、输入快捷栏

### 4.1 形态与分组

单行横向条，宽度不足时**横向滚动，绝不换行**。

```
H▾ │ B I S ` │ H1 H2 H3 │ ❝ • 1. ☑ │ ── ↵ │ 🔗 🖼 ▦ │ ✨ │ ⌘K
```

| 分组 | 按钮 | 语义类型 |
|---|---|---|
| 标题 | `H▾`（H1–H6 下拉） | wrap / skeleton |
| 强调 | `B` `I` `S` `` ` `` | wrap / skeleton |
| 层级 | `H1` `H2` `H3` | wrap / skeleton |
| 块结构 | `❝` `•` `1.` `☑` | wrap / skeleton（行级） |
| 插入 | `──` 水平线、`↵` 硬换行 | skeleton only |
| 需参数 | `🔗` 链接、`🖼` 图片、`▦` 表格 | popover |
| AI | `✨` 润色/续写/精简/翻译/总结/改表格 | popover |

### 4.2 三种点击语义

```
① Popover 类 → 永远走弹窗
② Wrap 类 → 有选区则包裹，无选区插骨架并把光标放进内容区
③ 纯插入类 → 直接插骨架
```

| 操作 | 行为 |
|---|---|
| 加粗 | 插入 `****`，光标落在中间两星号之间（from+2） |
| H2 | 插入 `## `，光标落在行首之后，**不插占位文本** |
| 水平线 | 在当前行下方插入 `\n---\n`，**光标留在原位** |
| 硬换行 | 插入 `  \n`（两空格换行），光标落到新行首 |

### 4.3 Popover 设计

自研轻量 popover（跟随锚点、Esc 关闭、外部点击关闭、视口翻转），不用原生 `<dialog>`。

- **表格**：网格选择器（hover 高亮 `rows × cols`，默认 3×3）
- **链接**：两行输入 `[显示文字]` / `(URL)`，无选区时预填选区文本
- **图片**：Tab 切换本地（Tauri 文件选择器）/ 远程（URL）

**Popover 内的输入必须独立于编辑器焦点**，否则会丢编辑器选区。做法：所有输入框 `mousedown` 时 `preventDefault` 保住选区快照。

---

## 五、AI 架构

### 5.1 Provider 抽象：10 家厂商 → 2 个协议实现 + 1 张配置表

| 厂商 | 协议 | base_url | 特殊处理 |
|---|---|---|---|
| OpenAI | OpenAI-compat | `api.openai.com/v1` | — |
| DeepSeek | OpenAI-compat | `api.deepseek.com/v1` | — |
| 豆包 Doubao | OpenAI-compat | `ark.cn-beijing.volces.com/api/v3` | 模型名是 endpoint id（`ep-xxx`） |
| Kimi | OpenAI-compat | `api.moonshot.cn/v1` | — |
| 通义千问 | OpenAI-compat | `dashscope.aliyuncs.com/compatible-mode/v1` | — |
| 智谱 GLM | OpenAI-compat | `open.bigmodel.cn/api/paas/v4` | — |
| Google Gemini | **OpenAI-compat** | `generativelanguage.googleapis.com/v1beta/openai` | 官方提供兼容端点，**零适配代码** |
| Ollama | OpenAI-compat | `127.0.0.1:11434/v1` | 额外用 `/api/tags` 列模型 |
| Anthropic / Claude | **原生 Messages API** | `api.anthropic.com/v1` | 需独立实现 |
| 自定义 | 用户选协议 | 用户填 | 覆盖 OpenRouter / SiliconFlow / 私有网关 |

配置放 `providers.toml`（数据文件，不是代码）。新增厂商是加一行配置，不是加一个类。

### 5.2 内部统一 IR —— 需求 6 的结构性保障

```rust
enum AiPart {
    Text(String),
    Context(String),                    // 只读上下文，prompt 里包 <context>
    Target { from, to, text: String },  // 唯一允许改写的部分，prompt 里包 <target>
}
```

`Context` 与 `Target` 是**不同的枚举变体**，而非不同字符串。模板必然分栏渲染，**物理上无法把「允许改写的部分」和「参考的部分」混进同一个 prompt 段**。这比任何 prompt 工程技巧都可靠。

### 5.3 API Key 存储：明文永不进前端

- **没有 `get_api_key` 命令。** 设置页输入框提交后立即清空，前端只保留 `hasKey: true`
- 所有网络请求在 Rust 侧发起，前端只订阅 `Channel<AiEvent>`
- 降级：未签名 dev build 下 keyring 可能失败 → 降级 `aes-gcm` 加密文件，降级时设置页显式红字提示

### 5.4 流式响应：Rust 侧

**第一理由不是性能而是安全** —— key 在 Rust 侧，前端发起请求就必须把 key 交给前端。其余理由：CORS（国产厂商与 Ollama 浏览器直连大多不可用）、重试/超时/限流统一治理。

用 `tauri::ipc::Channel<T>` 而非全局 event —— 按请求实例化、有序、低开销。

**SSE 解析手写增量解析器（约 80 行），不用通用库** —— Anthropic 的 SSE 需按 `event:` 名分派且 `data:` 可能多行，通用 eventsource 库的状态机反而碍事。

- 超时：首字节 30s，chunk 间空闲 60s
- 校验 `stream: true`，非流式响应直接报错，**不静默降级**
- 某些厂商 HTTP 200 但 data 里返回 `{"error":{...}}` → 必须检查
- 取消：Rust 持 `CancellationToken`

### 5.5 划选增强的交互流程

```
① 划选 [from, to)
② debounce 220ms（键盘 Shift+方向键划选则 0ms 立即触发）
③ 快照 target（唯一可改写范围）+ context（前后各 400 字符，只读参考）
④ AI 面板滑出，编辑区用 Decoration.mark 标出 target 范围
⑤ invoke("ai_chat", {kind:"rewrite", target, context}) → Channel
⑥ 流式回 Delta，面板内实时显示
⑦ Done → 卡片式三按钮 [采纳] [重试] [丢弃] + 字数变化
⑧ 采纳 → 应用写回（见六道锁）
```

**Prompt 严格分区**：
```
system: 你只能输出 <target> 标签内文本的替换版本。
        1. 绝不输出 <target> 之外的任何内容
        2. 绝不添加解释、前言、结语、代码块围栏
        3. 保持原有 Markdown 语法结构不被破坏
        4. <context> 仅供理解上下文，绝对不可修改或复述
```

### 5.6 保证「有且仅有」的六道锁

| # | 机制 | 防御什么 |
|---|---|---|
| 1 | **IR 类型隔离**：`Target` 与 `Context` 是不同枚举变体 | 提示词层面混淆 |
| 2 | **长度护栏**：`len > 原长×3 + 200` → UI 拒绝 + 报错 | 模型复述全文 / 跑飞 |
| 3 | **位置锁**：用请求发起时捕获的 RangeSet 随 `tr.changes` 自动映射；映射后长度不符 → 拒绝并提示「文档已变更，请重新划选」 | 用户在生成期间编辑了同一区域 |
| 4 | **输出净化**：剥掉 ` ```markdown ` 围栏（仅当整体包裹）、剥首尾空白与多余空行 | 模型习惯性加围栏 |
| 5 | **全文包裹检测**：若 newText 含 context 中连续 20 字符以上的片段 → 判定模型吐了全文 → 拒绝 | 模型无视指令 |
| 6 | **单一写路径**：永远 `dispatch({changes:{from: targetFrom, to: targetTo, insert: newText}})`，**不存在第二条写路径** | 代码层面越权 |

**呈现选卡片式而非原地 diff**：markdown 短行文本的逐字符 diff 视觉噪声极大；卡片可直接显示「字数 42 → 51」、模型名、耗时。**接受后仍给一次 ⌘Z**（因为它是一次普通 transaction，落在同一 undo 历史里）。

### 5.7 行内 AI 补全：绝对定位 Overlay

**不���用 `Decoration.replace` 做 ghost text** —— inline widget 会增加该行宽度 → 可能换行 → **纵向位移 → CLS 回归**。这正是 atomic-editor 踩过的坑。

```
方案：在 contentDOM 上挂绝对定位的 <div class="cm-ghost">
     每帧跟随：const c = view.coordsAtPos(head)
               ghost.style.transform = `translate(${c.left}px, ${c.top}px)`
     pointer-events: none → 零 DOM 布局影响
```

- **触发**：Tab（空行/行尾）/ `⌘.` / Esc 关闭。**无选区时**才触发
- **节流**：Delta 累积到 60ms 或 64 字符才 dispatch 一次 effect
- **`addToHistory: false` 强制**，否则一次补全产生几十个 undo 步骤
- **接受**：`{changes:{from, insert}, addToHistory: true}` 整个补全作为一步 undo

### 5.8 自动化 Agent 任务（克制的两种）

**A. On-save 润色（可开关，per-document 可配）**
```
触发：保存成功 → debounce 800ms → 命中润色信号则触发
润色信号（纯本地零成本判定）：
  · 连续 3 句以上长度 > 80 字
  · ≥ 3 处 "。。" / "，，"
  · 段落内重复短语
输出：**不写回文档**。顶部提示「AI 建议：本段可优化」+ [查看] → diff 侧栏 → 逐 hunk 接受
```

**B. 显式「整理全文」命令**
```
输出：结构大纲面板（标题层级树 + 每节 AI 摘要），不直接改文档
```

**写回审批：快照式 diff，不引入 git**
```
存储：~/Library/Application Support/<id>/snapshots/{doc_id}/{ts}.snap
格式：zstd 压缩纯文本 + 40 字节 header
保留：最近 20 个 + 里程碑（首开 / 每日首个 / 手动标记）
典型占用：1MB 文档 ≈ 30KB/快照，20 个 = 600KB

diff 两级：similar crate 行级 myers → hunk 列表
            每个 hunk 内做字符级 diff
写回：hunk 从后往前排序 → 放进同一个 transaction 的 changes 数组
     → 一次 ⌘Z 完全回滚
     → transaction.userEvent 打 origin:'ai' 标记
时间线：编辑区右上角时钟图标 → 所有 AI 写回记录 + [恢复到此处]
```

---

## 六、主题与玻璃系统

### 6.1 三层 Token 架构

```
L0  原生层（Rust）    glassMode: 'liquid' | 'vibrancy' | 'none' + material 参数
L1  语义层（CSS变量） --bg-base / --text-primary / --accent / --border / --radius-* / --glass-*
L2  组件层（CSS）      只引用 L1，禁止硬编码任何颜色值
```

**关键：CodeMirror 的 theme 与 HighlightStyle 全部写成 CSS 变量引用，且不传第二参数 `themeType`。**

**切换主题 = `document.documentElement.dataset.theme = 'x'`** —— 零 dispatch、零重建、零闪烁。

### 6.2 自定义皮肤的三级策略

| 级别 | 能力 | 阶段 |
|---|---|---|
| L1 Token 编辑 | 设置面板调 accent / 背景 / 字号 / 圆角 / 字体 / 玻璃强度，即时预览 | MVP |
| L2 主题文件导入 | 导入 `.json`，含完整 token 集 + 可选 `overrides` | v1 |
| L3 主题市场 | — | **明确砍掉** |

字体不内嵌（包体），只做已安装字体的名字枚举。

### 6.3 玻璃层次设计

```
L0 窗口级  vibrancy / liquid glass        ← Rust，NSView 层
L1 侧边栏 / AI 面板   backdrop-filter: blur(20px) saturate(180%)
L2 编辑区   color-mix(in oklab, var(--bg-base) 88%, transparent)
L3 浮层（popover / 命令面板 / diff 侧栏） blur(32px) saturate(200%) + shadow-lg
```

**为什么编辑区不设全透明**：全透明窗口 + 大面积 backdrop-filter 在 macOS 滚动时有明显重绘成本，且长文本在动态背景上可读性差。编辑区 88% 不透明是**可读性与美观的最优解** —— 玻璃感来自侧边栏与浮层的层次对比。

### 6.4 液态玻璃与五个必避的坑

```rust
if os.major >= 26 {
    apply_liquid_glass(window, LiquidGlassOptions::new(NSGlassEffectViewStyle::Clear)
        .radius(16.0).opaque(false).interactive(true)   // interactive 需 macOS 27+
        .content_view(find_webview(&window)))?;        // ← 坑 4 的解法
    return GlassMode::Liquid;
}
if os.major >= 10 {
    apply_vibrancy(window, NSVisualEffectMaterial::UnderWindowBackground, ...)?;
    return GlassMode::Vibrancy;
}
GlassMode::None
```

| 坑 | 现象 | 解法 |
|---|---|---|
| 1 | 缺 `macOSPrivateApi: true` | tauri.conf.json + Cargo feature，**两处都要** |
| 2 | 白底渗出 | `html` / `body` / `#app` **三层**都要 transparent |
| 3 | 窗口圆角边缘错位 | `apply_liquid_glass` 必须传 `.content_view(find_webview(&window))` |
| 4 | 玻璃完全没生效 | 不透明背景设在 WebView 上会完全阻断玻璃；opaque 层必须在 glass view **下方** |
| 5 | 页面切换 / 缩放残影 | 社区已知 macOS 透明窗口无解。**架构规避：单页应用，绝不用 vue-router** |

排查流程见 `GLASS-CHECKLIST.md`。

### 6.5 内置主题（四套）

| 主题 | 定位 | 关键 token |
|---|---|---|
| **Ink** | 默认亮色，暖纸白墨黑 | `bg #FBFAF7` / `text #1A1A1A` / `accent #2F6FEB` / `code #B5446E` |
| **Graphite** | 暗色，石墨灰，低饱和护眼 | `bg #1C1C1E` / `text #E8E6E3` / `accent #7AB8FF` / `code #FF9EBB` |
| **Sepia** | 暖米色，长时间写作 | `bg #F5EFE1` / `text #3B3229` / `accent #A8542A` |
| **Neon Glass** | 深底高饱和，「美观第一」的招牌 | `bg #0B0D12` / `accent #7DF9C7` / `accent2 #C77DFF` / `radius-lg 20px` |

### 6.6 动画规范

```
--ease-out: cubic-bezier(0.22, 1, 0.36, 1)
--dur-fast 120ms / --dur-base 180ms / --dur-panel 260ms

AI 面板滑出  transform 260ms + opacity 160ms
Popover      transform 120ms + opacity 90ms
Diff 高亮    background-color 3000ms linear（3 秒后清空 decoration）
Decoration   **零动画**（必须无延迟）
prefers-reduced-motion: reduce → 全部 1ms
```

**decoration 切换绝不能有动画** —— 那会让 CLS 指标本身失去意义，且直接被感知为「卡顿」。

---

## 七、数据与工程

### 7.1 目录结构

见仓库根目录 `README.md` 的目录一节。

### 7.2 状态管理：CodeMirror 进不了 store

**硬约束**：`EditorState` 是不可变大对象且内部有环，必须放在模块级 `Map<docId, EditorState>`，用 `view.setState()` 切换。既然最大的那块状态本来就不在 store 里，store 就没必要用 Pinia。

详见 `ARCHITECTURE.md`。

### 7.3 文档历史：JSON 文件

```
路径：~/Library/Application Support/<bundle-id>/history.json
条目：{ id, path, title, preview, createdAt, openedAt, wordCount }
写入：debounce 500ms → 写 .tmp + fsync → rename（POSIX 原子）→ 上限 1000 条按 openedAt 淘汰
搜索：纯内存 filter（1000 条 < 1ms，不需要索引）
```

### 7.4 性能预算

| 指标 | 目标 | 达成手段 |
|---|---|---|
| 安装包 | ≤ 12 MB | 复用系统 WebView；Rust `opt-level="z"` + `lto="fat"` + `codegen-units=1` + `strip` + `panic="abort"`；前端 ≤ 350KB gzip（所有 `@codemirror/lang-*` 走动态 `import()`） |
| 冷启动 → 可输入 | ≤ 400 ms | setup 只做 window + vibrancy（<5ms）；无磁盘阻塞 IO；history 异步加载 |
| 空闲内存 | ≤ 80 MB | **关键：不做第二套 markdown-it 预览渲染** |
| 打开 1MB / 5 万字 | ≤ 300 ms | CM6 增量解析；不预渲染屏外内容 |
| 输入延迟 P99 | ≤ 16 ms | decoration 只扫 visibleRanges；IME 冻结；layoutField 增量重建 |
| 滚动 | 60fps @ 5000 行 | 布局类 decoration 全在 StateField；禁止任何 decoration 上的 CSS transition |
| CLS | < 0.01 | §3.9 CSS 硬约束 + CI 门禁 |
| AI 首 token | ≤ 800 ms | Rust 直连无中转；`reqwest` Client 全局单例 |

### 7.5 里程碑

| 里程碑 | 周期 | 范围 | 可验收标准 |
|---|---|---|---|
| **M0 内核验证** | 1 周 | CM6 + lezer-markdown(GFM) + 三层 decoration + 主题骨架 | CLS < 0.01｜IME 三场景零丢字｜5000 行 FPS ≥ 55｜CommonMark+GFM 各 60 条渲染快照 |
| **M1 可用编辑器** | 2 周 | 全语法、快捷栏、主题系统、文件读写、历史、状态栏 | 50 语法元素截图｜表格交互｜图片相对路径｜连续 100 次 ⌘Z｜包体 ≤ 14MB |
| **M2 AI** | 2 周 | Provider 抽象 + keyring + 流式对话 + 划选增强 + Ghost text | 10 厂商跑通｜**30 次划选改写断言 target 外字节级未变**｜长度护栏｜`grep` key 零命中 |
| **M3 玻璃与视觉** | 1 周 | vibrancy / liquid glass + 降级 + 玻璃层次 + 主题导入 | macOS 26 与 15 各截图无异常｜降低透明度自动降级｜强制不透明开关 |
| **M4 Agent 与 v1** | 2 周 | on-save 润色 + 快照 diff + 写回审批 + 时间线撤销 | **hunk 应用后一次 ⌘Z 完全回滚（自动化断言）**｜E2E 30 步｜包体 ≤ 12MB |

**M0 的意义**：它验证或证伪整个项目最大的技术假设。如果 CLS 压不下来，M1 之后的所有工作都没有意义。

### 7.6 三大技术风险

| 风险 | 表现 | 应对 |
|---|---|---|
| **1. decoration 切换引起纵向位移（最高）** | CLS 反弹、表格/图片进出时滚动跳变 | CSS 硬约束 + 架构约束（StateField）+ 利用 CM6 6.39+ 的 block wrappers + **CI 门禁阈值 0.01** |
| **2. 中文 IME 丢字** | 候选词被吞、中文标点要按两次 | `view.composing` 时只 map 不重算 + 标记成对替换 + `compositionend` 后强制重算 + **CDP `Input.imeSetComposition` 测三场景，Chromium + WebKit 双引擎** + 精确锁版本 |
| **3. macOS 透明窗口 + 液态玻璃可靠性** | 白底、边缘错位、resize 残影、App Store 拒审 | 四件事 checklist + 单页应用规避残影 + **明确放弃 App Store** + 强制不透明逃生开关 + 玻璃诊断面板 |

---

## 八、值得补充的功能建议

| 优先级 | 功能 | 理由 | 成本 |
|---|---|---|---|
| **高** | **⌘K 命令面板** | 极简编辑器必须有万能入口，否则功能只能藏在快捷栏里。命令注册表已作为唯一真相存在 | 1–2 天 |
| **高** | **文档大纲面板** | 长文档导航刚需。CM6 语法树里标题节点现成 | 2–3 天 |
| **高** | **专注模式 / 打字机模式** | 直接服务「极其轻量」的写作体验。打字机模式约 100 行 | 1 天 |
| **高** | **文本片段库** | 写合同条款、邮件模板是每天的真实高频动作 | 2 天 |
| 中 | 全局搜索（跨文档） | 侧栏已有元数据，加一个过滤即可 | 1 天 |
| 中 | 导出 HTML / PDF | `window.print()` + 打印样式表覆盖 90% 需求 | 2 天 |
| 中 | 拖拽文件到窗口 | 用户最自然的文件打开方式 | 1 天 |
| 中 | 拼写检查 | 中文 `cspell` 词典，英文系统 Hunspell | 3 天 |
| 低 | 自定义快捷键 | 已有命令注册表，导出/导入 JSON | 1 天 |
| 低 | Git 版本管理 | 需 libgit2（~4MB）。若做建议用系统 `git` CLI | 3 天 |
| **不做** | 多窗口 / 实时协作 | 多窗口省不掉跨窗口状态同步；协作需 CRDT（+180KB gzip） | — |
| **不做** | 全库语义检索 / RAG | 已明确排除，技术上也确实会显著推高复杂度 | — |
| **不做** | 主题市场 | 与「极简」不符 | — |
| **不做** | 移动端 | 与 macOS 优先的决策冲突 | — |

---

## 附录 · 需求对照表

| # | 需求 | 落点 | 里程碑 |
|---|---|---|---|
| 1 | 全面 Markdown 编辑 + 所见即所得 | §3 全节，重点 3.3 策略表 / 3.4 状态机 / 3.7 IME | M0 / M1 |
| 2 | 输入方式做成一栏快捷按钮 | §4，4.2 按钮集合 + 与「输入即转换」零冲突设计 | M1 |
| 3 | 配置主流 AI API Key + AI 优化整理 | §5.1 三类适配器 + 5.3 keyring | M2 |
| 4 | 极其轻量、简洁 | §7.4 性能预算 + §2.2 不引入依赖 | 全程 |
| 5 | 左历史 / 右编辑 / AI 面板收敛 | §3 三栏布局 + §7.3 历史数据结构 | M1 |
| 6 | 划选送 AI，仅处理该部分 | §5.6 六道锁（IR 类型隔离是结构性保障） | M2 |
| 7 | 自定义皮肤 + 磨砂/液态玻璃 | §6.1 三层 token + 6.4 五个坑 + 降级 | M3 |
