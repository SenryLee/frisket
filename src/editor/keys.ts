/**
 * 快捷键 —— 编辑器语义与 CodeMirror 默认键位的差异集中在此
 *
 * 在整体中的位置：core/editor.config.ts 把本文件产出的 keymap 装进编辑器。
 * 集中定义的原因：默认键位里有几处对 Markdown 语义不合适，
 * 散落覆盖会互相打架，且键位表是评审时最容易漏看的地方。
 *
 * ── 纪律：不静态 import 任何 @codemirror/lang-* ─────────────────
 * lang-markdown 有 300KB+，静态 import 会让它无条件进主 bundle，
 * 与 markdown.config.ts 的动态加载策略冲突。
 * 需要语言包能力的键位（列表续行）改为接收注入的 Command，
 * 由 core/editor.config.ts 在语言包加载完成后组装。
 *
 * 约定：需要抢在默认键位之前的用 Prec.highest 显式声明，
 * 不依赖注册顺序这种隐式约定。
 */

import { keymap } from '@codemirror/view'
import type { Command, EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { Prec } from '@codemirror/state'
import { insertTab, indentMore, indentLess } from '@codemirror/commands'
import { newlineOutsideMarker } from '@/core/newline'

/** 空列表记号的形态：只含缩进与一个列表记号。 */
const EMPTY_LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s$/

/**
 * 空列表项上回车应退出列表，而不是留一个空记号挂在那里。
 *
 * 纯语法判断，不需要语言包：行文本匹配空列表形态即可。
 */
const exitEmptyListItem: Command = (view: EditorView) => {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.head)
  const marker = EMPTY_LIST_ITEM.exec(line.text.trimEnd())
  if (marker === null) return false

  const indent = marker[1] ?? ''
  // 有缩进先减一级，没缩进则整行删掉 —— 此时列表只剩这一个空项，退出的语义是删掉它
  if (indent.length > 0) return indentLess(view)

  view.dispatch({
    changes: { from: line.from, to: line.to, insert: '' },
    selection: { anchor: line.from },
  })
  return true
}

/**
 * Tab 缩进。
 *
 * M1 的表格需要让位：表格内 Tab 应跳下一个单元格，
 * 届时由 tableField 提供的 keymap 以更高优先级接管。
 */
/**
 * 光标贴着行内标记时，换行放到标记外面。
 *
 * 放在空列表退出之后：空列表行仍然先退出列表。
 * 光标在文字中间时这个命令返回 false，默认换行接着处理。
 */
const exitInlineMarker: Command = (view: EditorView) => {
  if (view.state.selection.ranges.length !== 1) return false
  const range = view.state.selection.main
  const edit = newlineOutsideMarker(view.state.doc.toString(), range.from, range.to)
  if (edit === null) return false
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: { anchor: edit.cursor },
    scrollIntoView: true,
    userEvent: 'input',
  })
  return true
}

const indentForward: Command = (view: EditorView) => insertTab(view) || indentMore(view)

/** 选中整行。所见即所得下用户操作单位常是「一段」而非精确到字符。 */
const selectLine: Command = (view: EditorView) => {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  view.dispatch({ selection: { anchor: line.from, head: line.to } })
  return true
}

/**
 * 与语言无关的键位表。
 *
 * CodeMirror 自带的编辑键位（undo / redo / copy / search）由
 * @codemirror/commands 与 @codemirror/search 的默认 keymap 提供，
 * 不在这里重复定义，避免同一动作有两个来源。
 */
const baseKeymap: Extension = Prec.highest(
  keymap.of([
    { key: 'Enter', run: exitEmptyListItem },
    { key: 'Enter', run: exitInlineMarker },
    { key: 'Mod-Enter', run: exitEmptyListItem },
    { key: 'Tab', run: indentForward },
    { key: 'Shift-Tab', run: indentLess },
    { key: 'Alt-ArrowUp', run: selectLine },
    { key: 'Alt-ArrowDown', run: selectLine },
  ]),
)

/**
 * 需要语言包能力的键位。
 *
 * 由 core/editor.config.ts 在 markdown.config 加载成功后调用，
 * 传入 insertNewlineContinueMarkup —— 这样 lang-markdown
 * 仍是动态 import，静态依赖图里看不到它。
 */
export function languageKeymap(continueMarkup: Command): Extension {
  return Prec.highest(keymap.of([{ key: 'Enter', run: continueMarkup }]))
}

/** 无语言包时的降级键位集。 */
export const markdownKeymap: Extension = baseKeymap