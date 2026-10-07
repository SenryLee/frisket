/**
 * Markdown 片段构造 —— 表格与链接的插入文本生成
 *
 * 在整体中的位置：core/editor.ts 的 insertTable / insertLink / insertImage 调用。
 * 单独成文件是因为这些函数有实际算法（对齐列宽、空格处理、光标落点），
 * 塞进 editor.ts 会把那个文件推过300 行且淹没掉契约实现。
 *
 * 共同约定：所有构造函数只产出事务spec，不自己 dispatch。
 * 这样「谁来 dispatch、挂什么来源注解」始终由editor.ts 一处决定。
 */

import type { EditorState, TransactionSpec } from '@codemirror/state'

/** 表格列之间的分隔符。GFM 要求至少一个连字符。 */
const TABLE_DELIMITER = '---'

/**
 * 构造 GFM 表格插入。
 *
 * 列宽按各列标题长度自适应，太窄的列在渲染态会被内容撑开，
 * 源码态则显得参差。至少 3 字符是能显示「内容」的下限。
 */
export function buildTableInsertion(state: EditorState, rows: number, cols: number): TransactionSpec {
  const rowCount = Math.max(2, Math.trunc(rows))
  const colCount = Math.max(1, Math.trunc(cols))

  const anchor = resolveAnchor(state)
  const block = renderTable(rowCount, colCount)

  return {
    changes: { from: anchor.from, to: anchor.to, insert: block },
    // 光标落在第一个数据单元格的首行首个字符前，插完即可直接打字
    selection: { anchor: anchor.from + block.indexOf('|', block.indexOf('|') + 1) + 1 },
  }
}

function renderTable(rows: number, cols: number): string {
  const widths = computeWidths(cols)
  const lines: string[] = []

  lines.push(renderRow(Array.from({ length: cols }, () => ' '), widths))
  lines.push(renderRow(Array.from({ length: cols }, () => TABLE_DELIMITER), widths))
  for (let row = 1; row < rows; row += 1) {
    lines.push(renderRow(Array.from({ length: cols }, () => ' '), widths))
  }
  return lines.join('\n')
}

/** 列宽取「分隔符长度」与「最小可读宽度」的较大者。 */
function computeWidths(cols: number): number[] {
  const minimum = TABLE_DELIMITER.length + 2
  return Array.from({ length: cols }, () => minimum)
}

function renderRow(cells: readonly string[], widths: readonly number[]): string {
  const rendered = cells.map((cell, index) => {
    const width = widths[index] ?? cell.length
    return ` ${cell.padEnd(width, ' ')} `
  })
  return `|${rendered.join('|')}|`
}

/**
 * 插入位置：选区所在的整行。
 *
 * 替换整行而不是插入到光标处 —— 表格是块级元素，
 * 插在段落中间会得到「文字|表格|文字」这种无法解析的结构。
 */
function resolveAnchor(state: EditorState): { from: number; to: number } {
  const main = state.selection.main
  const line = state.doc.lineAt(main.from)
  // 已经在一行空白的行上则就地插入，避免多出一个空行
  return line.text.trim() === ''
    ? { from: line.from, to: line.to }
    : { from: line.to, to: line.to }
}

/**
 * 构造链接 / 图片插入。
 *
 * 有选区时把选中文本作为链接文字（这是用户最常见的意图：
 * 选中一段文字后点「插入链接」）；
 * 无选区时插入骨架并把光标放进文字位。
 */
export function buildLinkInsertion(
  state: EditorState,
  text: string,
  url: string,
  isImage: boolean,
): TransactionSpec {
  const main = state.selection.main
  const selected = state.doc.sliceString(main.from, main.to)
  const prefix = isImage ? '![' : '['
  const closeBracket = isImage ? '](url)' : '](url)'

  if (selected !== '') {
    const insert = `${prefix}${selected}${closeBracket}`
    return {
      changes: { from: main.from, to: main.to, insert },
      // 选区整体保持选中，用户接着就能改文字部分
      selection: { anchor: main.from, head: main.from + insert.length },
    }
  }

  const label = text === '' ? '链接文字' : text
  const insert = `${prefix}${label}](${url})`
  return {
    changes: { from: main.from, to: main.to, insert },
    selection: { anchor: main.from + prefix.length },
  }
}