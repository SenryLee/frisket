/**
 * CodeMirror主题 —— 只声明结构与度量，颜色一律引用视觉层的语义 token
 *
 * 在整体中的位置：core/editor.config.ts 引用本文件。
 * 颜色 token 定义在 src/styles/tokens.css 与 themes.css（属于视觉子智能体），
 * 本文件只引用不定义。主题切换只换 themes.css 的一组变量，
 * 不需要重建 EditorState，也就不可能触发一次装饰重算。
 *
 * ── 为什么绝不传 EditorView.theme 的第二参数 ──────────────────
 * 那个参数是给 CodeMirror 内部区分亮暗主题用的（影响默认边框、selection 等）。
 * Slate 的明暗由 CSS 变量的值决定，同一套扩展要同时服务全部主题，
 * 传dark 会让 CodeMirror 把亮色默认值硬编码进生成的样式表，
 * 造成「切到暗色主题后某些默认色仍是亮色」。因此永不传第二参数。
 *
 * ── token 命名对齐 ────────────────────────────────────────────
 * 引用的是 tokens.css 的语义层（--text-primary / --bg-base …），
 * 而不是 themes.css 的原色层（--c-text-primary …）。
 * 语义层是给组件用的稳定契约，原色层会随主题调整 —— 组件引用原色等于把
 * 主题细节泄漏到每个调用点，换主题时必然漏改。
 *
 * ── CLS 纪律第一条的落点 ──────────────────────────────────────
 * 下面的 fontSize / lineHeight 全部是常量（来自 tokens.css 的字号阶梯）。
 * `.cm-md-h1` 无论 `#` 显不显示，字号与行高都不变。
 * 这正是纪律第一条：行高只取决于所在行的 class。
 */

import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

/**
 * 基础度量。全部来自 tokens.css 的编辑区 token，
 * 这些值由设置面板经 CSS 变量覆盖，本文件不硬编码任何数值。
 */
const METRICS = {
  fontSize: 'var(--font-editor-size)',
  lineHeight: 'var(--line-height-editor)',
  fontFamily: 'var(--font-editor-family)',
  monoFamily: 'var(--font-mono)',
  measure: 'var(--measure-editor)',
} as const

/**
 * 标题字号阶梯。
 *
 * 用 tokens.css 的 --text-* 阶梯而非 em 相对值：
 * 相对值会与父级字号形成级联，一旦展开态改变了父级字号，
 * 行高就跟着变 —— 那正是纪律第一条禁止的抖动来源。
 * 阶梯值是绝对长度，与展开态完全无关。
 *
 * 标题的段间距用 padding 而非 margin：margin 会推移后续所有行，
 * padding 在盒模型内部，只影响本行自身高度。
 */
const HEADING_METRICS = [
  { className: 'cm-md-h1', size: 'var(--text-2xl)', weight: '700', color: 'var(--text-h1)' },
  { className: 'cm-md-h2', size: 'var(--text-xl)', weight: '700', color: 'var(--text-h2)' },
  { className: 'cm-md-h3', size: 'var(--text-lg)', weight: '600', color: 'var(--text-h3)' },
  { className: 'cm-md-h4', size: 'var(--text-md)', weight: '600', color: 'var(--text-h4)' },
  { className: 'cm-md-h5', size: 'var(--text-base)', weight: '600', color: 'var(--text-h4)' },
  { className: 'cm-md-h6', size: 'var(--text-sm)', weight: '600', color: 'var(--text-h4)' },
] as const

/** 编辑器骨架样式。 */
const baseTheme = EditorView.theme({
  '&': {
    fontSize: METRICS.fontSize,
    lineHeight: METRICS.lineHeight,
    fontFamily: METRICS.fontFamily,
    height: '100%',
    color: 'var(--text-primary)',
    // 底色由外层 glass-l2 提供。这里再铺一层不透明底会把毛玻璃挡住。
    backgroundColor: 'transparent',
  },

  '.cm-scroller': {
    fontFamily: METRICS.fontFamily,
    lineHeight: METRICS.lineHeight,
    overflowY: 'auto',
    backgroundColor: 'transparent',
  },

  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: '1px solid var(--border-subtle)',
  },

  // 内容区最大宽度由 tokens.css 的 --measure-editor 控制（设置面板改它）。
  // 居中而非左对齐：中文长文本左对齐时右侧参差不齐，很难扫读
  '.cm-content': {
    maxWidth: METRICS.measure,
    margin: '0 auto',
    padding: 'var(--space-9) var(--space-8)',
    caretColor: 'var(--text-primary)',
  },

  // 全局 ::selection 把选中文字涂成强调色的对比色（白字）。
  // 上色之后选区还留着，字色会被这层盖住，看起来像没生效。
  // ::selection 的 inherit 继承的是父级选区色，不是元素自己的字色，所以这里写回正文色。
  '& ::selection, &::selection': {
    color: 'var(--text-primary) !important',
    WebkitTextFillColor: 'var(--text-primary) !important',
  },

  // 选区与光标走语义色，避免暗色主题下出现亮蓝刺眼
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--bg-selected)',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--text-primary)',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-selectionMatch': {
    backgroundColor: 'var(--bg-hover)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftWidth: '2px',
  },
  '.cm-placeholder': {
    color: 'var(--text-muted)',
  },
})

/**
 * 标题行样式。
 *
 * 只有 font-size / font-weight / line-height 三类，
 * 没有任何 margin / padding —— 外边距变化会推动后续所有行，
 * 是纵向位移最直接的来源。
 */
const headingTheme = EditorView.theme(
  Object.fromEntries(
    HEADING_METRICS.map((item) => [
      `.${item.className}`,
      {
        fontSize: item.size,
        fontWeight: item.weight,
        color: item.color,
        // WebKit 透明窗口有时不认 color，只认填充色。两个一起写，标题色才稳。
        WebkitTextFillColor: item.color,
        // 标题行高用无单位倍数，与字号解耦：
        // 换字号时行高按比例走，不需要重新调这个值
        lineHeight: '1.4',
      },
    ]),
  ),
)

/** 引用块 / 列表 / 代码块 / 水平线的结构样式。 */
const blockTheme = EditorView.theme({
  // 引用块用左边框而非缩进：左边框不占内容宽度，
  // 展开 `>` 时也不会让文字位置变化
  '.cm-md-quote': {
    borderLeft: '3px solid var(--border-strong)',
    paddingLeft: 'var(--space-6)',
    color: 'var(--text-secondary)',
  },

  // 列表用 padding 缩进，同上理由
  '.cm-md-list': {
    paddingLeft: 'var(--space-8)',
  },

  '.cm-md-fence, .cm-md-code-block': {
    fontFamily: METRICS.monoFamily,
  },

  '.cm-md-code-inline': {
    fontFamily: METRICS.monoFamily,
    backgroundColor: 'var(--bg-sunken)',
    color: 'var(--text-code)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.1em 0.3em',
  },

  // 水平线由 field.inline 的 widget 呈现。它的高度写死在 widget 上，
  // 与所在行的字号行高无关，因此永远不参与行高计算
  '.cm-md-rule': {
    display: 'block',
    height: '1px',
    backgroundColor: 'var(--border)',
    margin: 'var(--space-5) 0',
  },

  // 水平线所在行保留正常行高。
  // 曾想用 line-height:0 把它压扁，但那正是纪律第一条禁止的做法：
  // 行的盒模型不得依赖内容是否可见。该行内容恒定（始终是那个 widget），
  // 正常行高就是稳定行高，无需特殊处理。
  '.cm-md-rule-line': {
    color: 'var(--text-muted)',
  },

  // 图片是窗框里的一张图。高度来自图片本身，挂在 StateField 上，
  // 不靠把整行 display:none 藏起来。
  '.cm-md-figure': {
    display: 'block',
    boxSizing: 'border-box',
    maxWidth: '100%',
    margin: '10px 0 14px',
    padding: '0 0 8px',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-lg)',
    background: 'var(--bg-raised)',
    boxShadow: 'var(--shadow-md)',
    overflow: 'hidden',
  },
  '.cm-md-figure.is-inline': {
    display: 'inline-block',
    verticalAlign: 'middle',
    width: 'auto',
    maxWidth: '100%',
    margin: '0 0.2em',
    padding: '4px',
    boxShadow: 'var(--shadow-sm)',
  },
  '.cm-md-figure__chrome': {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    height: '28px',
    padding: '0 10px',
    background: 'var(--bg-sunken)',
    borderBottom: '1px solid var(--border-subtle)',
  },
  '.cm-md-figure__dots': {
    flexShrink: '0',
    width: '36px',
    height: '8px',
    borderRadius: '999px',
    background:
      'radial-gradient(circle at 4px 50%, var(--text-muted) 3px, transparent 3.5px), radial-gradient(circle at 16px 50%, var(--border-strong) 3px, transparent 3.5px), radial-gradient(circle at 28px 50%, var(--border-strong) 3px, transparent 3.5px)',
  },
  '.cm-md-figure__title': {
    minWidth: '0',
    overflow: 'hidden',
    color: 'var(--text-secondary)',
    fontSize: 'var(--text-xs)',
    fontWeight: '500',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '.cm-md-figure__img': {
    display: 'block',
    maxWidth: '100%',
    maxHeight: '440px',
    width: 'auto',
    height: 'auto',
    margin: '0 auto',
    objectFit: 'contain',
    background: 'var(--bg-sunken)',
  },
  '.cm-md-figure.is-inline .cm-md-figure__img': {
    maxHeight: '9em',
  },
  '.cm-md-figure__note': {
    display: 'none',
    padding: '18px 14px',
    color: 'var(--text-muted)',
    fontSize: 'var(--text-xs)',
  },
  '.cm-md-figure.is-broken .cm-md-figure__img, .cm-md-figure.is-local .cm-md-figure__img': {
    display: 'none',
  },
  '.cm-md-figure.is-broken .cm-md-figure__note, .cm-md-figure.is-local .cm-md-figure__note': {
    display: 'block',
  },
})

/** 行内强调样式。纯字重字色，不涉及盒模型。 */
const inlineTheme = EditorView.theme({
  '.cm-md-strong': {
    fontWeight: '700',
    color: 'var(--text-strong)',
    WebkitTextFillColor: 'var(--text-strong)',
  },
  '.cm-md-em': {
    fontStyle: 'italic',
    color: 'var(--text-em)',
    WebkitTextFillColor: 'var(--text-em)',
  },
  '.cm-md-strike': {
    textDecoration: 'line-through',
    color: 'var(--text-muted)',
  },
  '.cm-md-link': {
    color: 'var(--text-accent)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
})

/**
 * 完整主题。
 *
 * 分四段而不合成一个大对象：合成后 CodeMirror 只能整体替换样式表，
 * 分段则能在 devtools 里精确定位是哪一层出了问题。
 */
export const slateTheme: Extension = [baseTheme, headingTheme, blockTheme, inlineTheme]