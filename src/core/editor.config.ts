/**
 * 编辑器基础扩展装配 —— 把内核各层拼成一个可用的 CodeMirror 配置
 *
 * 在整体中的位置：core/editor.ts 调baseExtensions() 拿到静态部分，
 * 语言包异步到位后再通过 Compartment 补上动态部分。
 *
 * 为什么语言包要用 Compartment：CodeMirror 的扩展在 EditorState.create
 * 时就固化了，之后无法追加。Compartment 是官方提供的「原地换扩展」通道，
 * 换的时候编辑器重建内部配置但保留 state 与滚动位置 —— 这正是切文档要的行为。
 *
 * 扩展顺序不是随意的：keymap 越靠后优先级越低，
 * 所以通用键位放在 markdownKeymap 之后，让 Markdown 语义键位能抢到 Enter。
 */

import {
  EditorView,
  keymap,
  drawSelection,
  highlightSpecialChars,
  placeholder,
  lineNumbers as lineNumbersGutter,
} from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import type { ViewUpdate } from '@codemirror/view'
import { Compartment, Prec } from '@codemirror/state'
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { lintKeymap } from '@codemirror/lint'
import { slateTheme } from '@/editor/theme'
import { markdownKeymap } from '@/editor/keys'
import { formatKeymap } from '@/editor/format-keys'
import { colorField, colorTheme } from '@/editor/live/field.color'
import { layoutField } from '@/editor/live/field.layout'
import { inlineField } from '@/editor/live/field.inline'
import { revealField } from '@/editor/live/field.reveal'
import { stylingPlugin } from '@/editor/live/plugin.styling'
import { statsField, collectStats } from '@/editor/live/field.stats'
import { readOrigin } from './origin'
import type { ChangeOrigin, EditorPrefs, EditorStats, TextRange } from '@/core/interfaces'

/** 语言包插槽。语言到位后用 reconfigure 原地换入。 */
export const languageCompartment = new Compartment()

/** 设置面板改动后重配置用。 */
export const prefsCompartment = new Compartment()

/**
 * 依据设置产出偏好相关扩展。
 *
 * 抽成函数而非常量：设置变了要能重新算出同一组扩展，
 * 而 Compartment.reconfigure 只接受 Extension，不接受「重算函数」。
 */
export function prefExtensions(prefs: EditorPrefs): Extension[] {
  const extensions: Extension[] = []
  if (prefs.showLineNumbers) extensions.push(lineNumbersGutter())
  if (prefs.autoPair) extensions.push(closeBrackets())
  return extensions
}

/**
 * 正文 / 统计 / 选区 / 焦点的变化回调。
 *
 * 为什么全部走 onChange 风格的独立回调而不是让消费方自己挂 updateListener：
 * updateListener 是 Extension 对象，多实例共享，事后赋值会互相覆盖。
 * 在 State 创建时挂载是唯一正确的方式。
 */
export interface EditorChangeCallbacks {
  /** 正文变化。origin 用于区分用户输入与 AI 写回 */
  readonly onChange?: (text: string, origin: ChangeOrigin) => void
  /** 统计变化（已去重，值确实变了才调） */
  readonly onStats?: (stats: EditorStats) => void
  /** 选区变化（已去重） */
  readonly onSelection?: (range: TextRange) => void
  /** 焦点变化（已去重） */
  readonly onFocus?: (focused: boolean) => void
}

export interface BaseExtensionOptions extends EditorChangeCallbacks {
  readonly prefs: EditorPrefs
  readonly docLabel?: string
}

/**
 * 静态扩展集 —— 与语言包无关的部分。
 *
 * 三层装饰器在这里汇合，是整个内核唯一的装配点：
 * 少挂一层意味着某个行为失效，多挂一层意味着 CLS 纪律被绕过。
 */
export function baseExtensions(options: BaseExtensionOptions): Extension[] {
  const extensions: Extension[] = [
    // ── 内核三层 ──
    // 顺序有讲究：layoutField 提供行高（编辑器算高度图时最需要它），
    // revealField 只存状态，inlineField 消费 revealField 的结果。
    layoutField,
    revealField,
    inlineField,
    stylingPlugin,
    colorField,
    colorTheme,
    statsField,

    // ── 编辑基础 ──
    history(),
    drawSelection(),
    highlightSpecialChars(),

    // ── 键位 ──
    // markdownKeymap 在前（Prec.highest），通用键位在后。
    // 这不是巧合：Markdown 语义键位必须在 Enter 上压过默认换行。
    markdownKeymap,
    formatKeymap,
    Prec.lowest(keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap])),
    placeholder('从这里开始写。选中文字后，快捷栏会跟到光标旁边。'),
    // closeBracketsKeymap / lintKeymap 是导出的键位数组，不是 Extension ——
    // 数组里的 KeyBinding 只有绑上 keymap facet 才成为扩展，故必须包一层 keymap.of()。
    // lintKeymap 只提供键位（打开 lint 面板），不带 linter 本身：
    // M0 不挂 linter，语法告警属于 M1
    keymap.of(closeBracketsKeymap),
    keymap.of(lintKeymap),

    // ── 外观 ──
    slateTheme,
    // 自动换行必须开：不换行的话超长行会撑出横向滚动条，
    // 纵向 CLS 门禁的测量也会失真
    EditorView.lineWrapping,
    highlightSelectionMatches(),

    // ── 插槽 ──
    languageCompartment.of([]),
    prefsCompartment.of(prefExtensions(options.prefs)),
  ]

  if (needsListener(options)) {
    extensions.push(changeReporter(options))
  }
  return extensions
}

/** 任一回调存在才值得挂监听器。全空时省掉一次每事务调用。 */
function needsListener(options: BaseExtensionOptions): boolean {
  return (
    options.onChange !== undefined ||
    options.onStats !== undefined ||
    options.onSelection !== undefined ||
    options.onFocus !== undefined
  )
}

/**
 * 变化上报。
 *
 * updateListener 的类型是 Facet<(update: ViewUpdate) => void>，
 * 所以塞进去的是函数本身，不是带 update 字段的对象。
 *
 * 统计与选区做了去重：它们是高频信号，每次事务都发会让状态栏无意义重渲染。
 * 去重键存在闭包里而非 state 上 —— 重建闭包等价于重置去重状态，
 * 而这正是我们想要的（新 state 就该重新播报一次初始值）。
 */
function changeReporter(options: BaseExtensionOptions): Extension {
  let lastStats = ''
  let lastSelection = ''
  let lastFocus: boolean | null = null

  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (update.docChanged && options.onChange !== undefined) {
      options.onChange(update.state.doc.toString(), readOrigin(update.transactions) ?? 'user')
    }

    const wantStats = options.onStats !== undefined
    const wantSelection = options.onSelection !== undefined
    const wantFocus = options.onFocus !== undefined
    if (!wantStats && !wantSelection && !wantFocus) return

    // 视口变化也会走到这里，但没有 selection 变化时无需广播
    if (!update.selectionSet && !update.docChanged && !update.focusChanged) return

    if (wantStats) {
      const stats = collectStats(update.view)
      const key = JSON.stringify(stats)
      if (key !== lastStats) {
        lastStats = key
        options.onStats?.(stats)
      }
    }
    if (wantSelection) {
      const main = update.state.selection.main
      const key = `${main.from}:${main.to}`
      if (key !== lastSelection) {
        lastSelection = key
        options.onSelection?.({ from: main.from, to: main.to })
      }
    }
    if (wantFocus && lastFocus !== update.view.hasFocus) {
      lastFocus = update.view.hasFocus
      options.onFocus?.(update.view.hasFocus)
    }
  })
}