# Frisket 架构说明

## 依赖方向

```
        Vue 组件层
             ↓
    ┌────────────────┐
    │  store（薄）    │  ← 跨组件共享的 UI 状态，约 60 行
    └────────────────┘
             ↓
    ┌────────────────┐
    │  core（接口）   │  EditorHandle / 共享类型
    └────────────────┘
             ↓
    ┌────────────────┐
    │ editor（内核）  │  CodeMirror 6 三层 decoration
    └────────────────┘
             ↓
              CM6
```

Rust 侧（`src-tauri/`）不参与这个链条，它只通过 `src/ipc/` 暴露命令。所有跨边界的数据结构在 `src/core/interfaces.ts` 定义，两侧共用同一份 TypeScript 类型作为契约。

## 三条不可让步的纪律

### 1. `state.doc` 永远是纯 Markdown

所有 decoration 都是纯视图层，不存在「渲染模型 → 源码」的反序列化。

因此复制、导出、保存、AI diff 全部直接操作文本，不需要转换。代价是渲染能力受限于 decoration，这是主动接受的取舍。

### 2. 行高只取决于所在行的 CSS class

与语法标记是否可见**无关**。

前车之鉴：atomic-editor 早期用 block widget 替换整个块，光标移入展开、移出折叠，CLS ≈ 0.1，UI 视觉振动；改为 inline decoration 后降到 0.003。

具体做法：
- 隐藏语法标记一律用 `Decoration.replace({})`
- **禁止** `height:0` / `line-height:0` / `display:none` 作用于整行
- 标题的 `font-size` + `line-height` 是常量，`.cm-h1` 无论 `#` 显示与否都是同一行高

### 3. 影响纵向布局的 decoration 必须由 StateField 直接 provide

CodeMirror 官方明确：作为函数提供的 decoration set 在视口计算之后才被调用，**不得引入 block widget 或跨换行的 replace decoration**，否则高度图失效、滚动条长度错误。

## 三层装饰器

| 层 | 类型 | 负责 | 重算触发 |
|---|---|---|---|
| `layoutField` | StateField | 表格、图片、水平线、frontmatter、任务复选框（改变行高） | `docChanged \|\| selectionSet` |
| `inlineField` | StateField | 隐藏语法标记（`**` `##` `` ` `` `[]`），与 doc 原子生效 | `docChanged \|\| selectionSet` |
| `stylingPlugin` | ViewPlugin | 纯样式，只扫 `view.visibleRanges` | `docChanged \|\| selectionSet \|\| viewportChanged` |

**代码评审必查项**：新增的 block 级 widget 是否放在 `layoutField` 而非 `ViewPlugin`。

## 状态管理：为什么不用 Pinia

`EditorState` 是不可变大对象且内部有环，必须放在模块级 `Map<docId, EditorState>`（`src/core/docCache.ts`），用 `view.setState()` 切换。

既然最大的那块状态本来就不在 store 里，store 就没必要引入 Pinia 的抽象。当前状态量 8 个字段，一个 `reactive` 对象 + `useStore()` 足够。

切换文档时**必须先写回再切换**，否则上一个文档的状态丢失：

```ts
function setActiveDocument(id: string, text?: string) {
  if (state.currentDocId) states.set(state.currentDocId, view.state)
  view.setState(states.get(id) ?? buildState(text ?? ''))
}
```

`docCache.ts` 是非响应式的模块，**不要**把它内容放进 `reactive`，否则每次编辑都会触发 Vue 更新。

## 主题切换：零 dispatch

切换主题只做一件事：

```ts
document.documentElement.dataset.theme = 'ink'
```

不用 `Compartment` 重配 CodeMirror theme —— CodeMirror 的 `theme()` 与 `HighlightStyle` 全部写成 CSS 变量引用，且不传第二参数 `themeType`。这样切换是纯 CSS 生效，无状态变更、无闪烁。

`Compartment` 留给真正需要换扩展实例的场景：只读态、代码语言包按需加载、插件启停。

## 不引入的依赖及理由

| 不引入 | 理由 |
|---|---|
| `markdown-it` / `marked` / `prosemirror-*` | CM6 已提供增量 Markdown 解析。再加渲染器 = 两套解析器 + 两份内存，直接威胁「轻量」目标 |
| SQLite | 历史记录 1000 条 × 200 字节 ≈ 几百 KB，JSON 文件足够。原子写（tmp + rename）解决崩溃安全 |
| `libgit2` | 快照需求只要「三个备选版本 + 接受/拒绝」，diff 足够。libgit2 需维护对象库/索引/ref |
| Pinia | 见上文 |
| headless Chromium | 导出 PDF 用 `window.print()` + 打印样式表 |

## AI 侧的结构性保障

`AiPart` 的 `Context` 与 `Target` 是**两个不同的枚举变体**，而非两个不同字符串。模板必然分栏渲染，物理上无法把「允许改写的部分」和「参考的部分」混进同一个 prompt 段。

这是需求「AI 有且仅对划选部分处理」的结构性保障，比任何 prompt 工程技巧都可靠。在此之上再叠六道锁（长度护栏、位置锁随 transaction 自动映射、输出净化、全文包裹检测、单一写路径等）。

## 单页应用，无 vue-router

macOS 透明窗口在页面切换时会出现残影（WebKit 层已知问题，无法根治）。Frisket 全部视图由 store 驱动，单页切换是最优解。
