/**
 * editor.ts —— 编辑区的 UI 状态
 *
 * 在整体中的位置：内核驱动编辑行为，本文件只描述「编辑区现在看起来怎样」。
 * 两者刻意分开：内核不直接写组件状态，而是通过 EditorHandle.getStats()
 * 交出数据，由这里存成响应式，状态栏再从这里读。
 *
 * ★ 为什么不直接把 EditorStats 存在内核 ★
 * EditorStats 每次 transaction 都会变。若存在 CM 所在的模块里，
 * 状态栏要读就得让 CM 模块反向依赖 Vue，或者每次读都手动同步。
 * 存进 store 后，依赖方向始终是单向的：内核 → store → 组件。
 */

import { reactive } from 'vue'
import type { EditorPrefs, EditorStats, TextRange } from '@/core/interfaces'

/**
 * 编辑区无文档时的统计值。
 *
 * 计数用 0、光标位置用 null —— 语义不同：0 字是可信的事实，
 * 「第 0 行」不是。状态栏据null 显示占位符，据 0 显示数字。
 *
 * 用 satisfies 而非直接标注类型：新字段加入 EditorStats 时
 * 若漏填，satisfies 会就地报错并指出缺失的键名，
 * 而普通对象标注只会报一句「缺少属性」，定位成本更高。
 */
const EMPTY_STATS = Object.freeze({
  wordCount: 0,
  charCount: 0,
  lineCount: 0,
  cursorLine: null,
  cursorColumn: null,
  selectionLength: 0,
} satisfies EditorStats)

const state = reactive<{
  stats: EditorStats
  /** 当前选区。有无选区统一用 from===to 表示，组件不必判空 */
  selection: TextRange
  /** 编辑区是否有焦点。决定状态栏是否显示光标位置 */
  focused: boolean
  /** 打字机模式 */
  typewriterMode: boolean
  /** 只读态：只读时不显示 AI 写回类操作 */
  readOnly: boolean
  /** 正文是否有未保存改动 */
  dirty: boolean
  /**
   * 正文每变一次加一。
   * 同长度换色不改变选区偏移，也不改变字数，颜色按钮靠这个刷新。
   */
  rev: number
  prefs: EditorPrefs
}>({
  stats: { ...EMPTY_STATS },
  selection: { from: 0, to: 0 },
  focused: false,
  typewriterMode: false,
  readOnly: false,
  dirty: false,
  rev: 0,
  prefs: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif',
    fontSize: 16,
    lineHeight: 1.75,
    maxWidth: 0,
    typewriterMode: false,
    showLineNumbers: false,
    tabSize: 2,
    autoPair: true,
    autoFormat: true,
    scrollWidth: 34,
  },
})

/**
 * 排版类偏好。只有这四项走 CSS 变量，
 * 其余偏好（行号、Tab 宽度等）由内核自行响应。
 */
const TYPOGRAPHY_KEYS: ReadonlySet<keyof EditorPrefs> = new Set([
  'fontFamily',
  'fontSize',
  'lineHeight',
  'maxWidth',
])

/**
 * 排版同步回调。由 store/index.ts 在装配时注入。
 *
 * 为什么注入而非直接 import appearance：appearance 要读 editor.prefs，
 * editor 改偏好后又要请 appearance 写 CSS 变量 —— 直接 import
 * 会形成循环依赖，ESM 下初始化顺序不确定，表现为一侧拿到 undefined。
 * 把「装配」这件事交给同时认识两个模块的 index.ts，
 * 这两个模块就都不必知道对方存在。
 */
let onTypographyChange: (prefs: EditorPrefs) => void = () => {
  // 未装配时的空实现。initStore 会在挂载前完成注入，
  // 真的走到这里说明装配顺序错了 —— 宁可什么都不做，也不要抛错。
}

/** 由 store/index.ts 调用，注入真正的排版写入器 */
export function setTypographyApplier(
  applier: (prefs: EditorPrefs) => void,
): void {
  onTypographyChange = applier
}

/** 把当前排版偏好推给 appearance。必须在状态写入之后调用 */
function syncTypography(): void {
  onTypographyChange(state.prefs)
}

export const editor = {
  get stats(): EditorStats {
    return state.stats
  },

  get selection(): TextRange {
    return state.selection
  },

  get focused(): boolean {
    return state.focused
  },

  get typewriterMode(): boolean {
    return state.typewriterMode
  },

  get readOnly(): boolean {
    return state.readOnly
  },

  get dirty(): boolean {
    return state.dirty
  },

  get rev(): number {
    return state.rev
  },

  get prefs(): EditorPrefs {
    return state.prefs
  },

  /** 有选区时才为 true。AI 的划选增强依赖它做可用性判断 */
  get hasSelection(): boolean {
    return state.selection.from !== state.selection.to
  },

  /**
   * 由内核在文档变化后交回统计值。
   *
   * 整对象替换而非逐字段赋值：CM 的 transaction 频率很高，
   * 逐字段赋值会产生 5 次响应式触发，逐字段写并不划算。
   */
  setStats(stats: EditorStats): void {
    state.stats = stats
  },

  setSelection(selection: TextRange): void {
    state.selection = selection
  },

  setFocused(focused: boolean): void {
    state.focused = focused
  },

  setTypewriterMode(enabled: boolean): void {
    state.typewriterMode = enabled
    state.prefs.typewriterMode = enabled
  },

  setReadOnly(readOnly: boolean): void {
    state.readOnly = readOnly
  },

  setDirty(dirty: boolean): void {
    state.dirty = dirty
  },

  /** 每次正文替换后调用。选区和字数没变时，界面仍能知道文档变了。 */
  bump(): void {
    state.rev += 1
  },

  /** 整体替换偏好（设置面板加载 / 原生侧下发） */
  setPrefs(prefs: EditorPrefs): void {
    Object.assign(state.prefs, prefs)
    syncTypography()
  },

  /** 切换单个偏好项。typewriterMode 与顶部字段同源，故两边都写 */
  setPref<K extends keyof EditorPrefs>(key: K, value: EditorPrefs[K]): void {
    state.prefs[key] = value
    if (key === 'typewriterMode') {
      state.typewriterMode = value as boolean
    }
    if (TYPOGRAPHY_KEYS.has(key)) {
      syncTypography()
    }
  },

/**
 * 切换文档时清空。
   *
   * 必须清：否则新文档打开的瞬间，状态栏会短暂显示上一篇的字数，
   * 用户会以为内容没加载出来。
   */
  reset(): void {
    state.stats = { ...EMPTY_STATS }
    state.selection = { from: 0, to: 0 }
    state.focused = false
    state.dirty = false
  },

  /**
   * 当前偏好的浅拷贝。
   *
   * 供 store/index 把它写进 CSS 变量。必须拷贝：
   * 直接把内部 reactive 对象交出去，调用方一改就绕过了 setPref，
   * 字号变化不会触发 CSS 变量更新。
   */
  getPrefsSnapshot(): EditorPrefs {
    return { ...state.prefs }
  },
}