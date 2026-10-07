/**
 * 统计字段 —— 字数 / 行数 / 光标位置的增量维护
 *
 * 在整体中的位置：EditorHandle.getStats() 的数据源。
 * 做成 StateField 而非每次调用现算，是因为状态栏在每次事务后都要读，
 * 现算等于每次按键都全文扫一遍。
 *
 * 增量的依据：Transaction 明确告知哪些行被改动（startLine / lines）。
 * 中文按字计，所以长度变化即字数变化；西文按词计，需要重新切分被改动的那些行，
 * 不能简单相减 —— 「a b」改成「ab」字数从2 变1，但两行长度都是 3/2，
 * 相减得不出正确结果。
 */

import { StateField } from '@codemirror/state'
import type { EditorState, Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { EditorStats } from '@/core/interfaces'

/** 中日韩统一表意文字与全角标点。 */
const CJK = /[　-〿぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/

/** 西文单词：字母数字连写。 */
const WORD = /[A-Za-z0-9_]+(?:['’-][A-Za-z0-9_]+)*/g

/** 空白（含零宽）也算一个「字符」会被 charCount 计入，但不计入字数。 */
function countWords(text: string): number {
  let count = 0
  for (const char of text) {
    if (CJK.test(char)) count += 1
  }
  WORD.lastIndex = 0
  const matches = text.match(WORD)
  if (matches !== null) count += matches.length
  return count
}

export interface Stats {
  readonly wordCount: number
  readonly charCount: number
  readonly lineCount: number
}

const EMPTY: Stats = { wordCount: 0, charCount: 0, lineCount: 1 }

function computeAll(state: EditorState): Stats {
  const text = state.doc.toString()
  return {
    wordCount: countWords(text),
    charCount: text.length,
    lineCount: state.doc.lines,
  }
}

/**
 * 增量更新：只有真正被改动的片段需要重新切词。
 *
 * 关键点：ChangeSet.iterChangedRanges 同时给出两侧坐标 ——
 * (fromA, toA) 是**变更前**文档里的范围（用来减），
 * (fromB, toB) 是**变更后**文档里的范围（用来加）。
 * 两个方向必须成对处理，只看一个会漏算被替换掉的整段内容，
 * 导致粘贴一段文字后字数只增不减。
 */
function updateStats(current: Stats, transaction: Transaction): Stats {
  if (!transaction.docChanged) return current

  const before = transaction.startState.doc
  const after = transaction.state.doc
  let wordDelta = 0
  let charDelta = 0

  transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    const removed = before.sliceString(fromA, toA)
    wordDelta -= countWords(removed)
    charDelta -= removed.length

    const added = after.sliceString(fromB, toB)
    wordDelta += countWords(added)
    charDelta += added.length
  })

  return {
    wordCount: current.wordCount + wordDelta,
    charCount: current.charCount + charDelta,
    lineCount: after.lines,
  }
}

export const statsField = StateField.define<Stats>({
  create: computeAll,
  update: updateStats,
})

/** 读取统计信息。docCache 切换文档后由 EditorState 自然带出，无需重算。 */
export function readStats(state: EditorState): Stats {
  return state.field(statsField, false) ?? EMPTY
}

/**
 * 读取完整统计快照，含光标位置。
 *
 * cursorLine / cursorColumn 未聚焦时返回 null 而不是 0 或 1：
 * 状态栏要在未聚焦时显示「未选择」，返回数字会误导用户
 * 以为光标在第一行第一列。
 *
 * 放在本文件而非 core/editor.ts：core/editor.config.ts 的 updateListener
 * 也需要它，而那个文件不能反向依赖 editor.ts（会成环）。
 */
export function collectStats(view: EditorView): EditorStats {
  const stats = readStats(view.state)
  const main = view.state.selection.main
  const cursor = view.state.doc.lineAt(main.head)
  return {
    wordCount: stats.wordCount,
    charCount: stats.charCount,
    lineCount: stats.lineCount,
    cursorLine: view.hasFocus ? cursor.number : null,
    // 按行首起算而非文档绝对偏移：状态栏展示的是「第几行第几字」
    cursorColumn: view.hasFocus ? main.head - cursor.from + 1 : null,
    selectionLength: main.to - main.from,
  }
}