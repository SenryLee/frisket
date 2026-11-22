/**
 * 选区原文和新文的对比。不引入 diff 库。
 * 多行按行标出增删，单行把相同的头尾收成省略号，只留下中间换掉的片段。
 */

export interface DiffLine {
  kind: 'same' | 'remove' | 'add'
  text: string
}

export interface DiffFragment {
  kind: 'equal' | 'remove' | 'add'
  text: string
}

export type TextDiff =
  | { mode: 'lines'; lines: DiffLine[] }
  | { mode: 'fragment'; pieces: DiffFragment[] }

export function diffText(before: string, after: string): TextDiff {
  if (!before.includes('\n') && !after.includes('\n')) {
    return { mode: 'fragment', pieces: fragmentPieces(before, after) }
  }
  return { mode: 'lines', lines: lineChanges(before, after) }
}

function lineChanges(before: string, after: string): DiffLine[] {
  const oldLines = before.split('\n')
  const newLines = after.split('\n')
  const rows = oldLines.length
  const cols = newLines.length
  const scores: number[][] = Array.from({ length: rows + 1 }, () => Array<number>(cols + 1).fill(0))
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      const next = scores[row + 1]?.[col + 1] ?? 0
      const down = scores[row + 1]?.[col] ?? 0
      const right = scores[row]?.[col + 1] ?? 0
      scores[row]![col] = oldLines[row] === newLines[col] ? next + 1 : Math.max(down, right)
    }
  }
  const lines: DiffLine[] = []
  let row = 0
  let col = 0
  while (row < rows && col < cols) {
    if (oldLines[row] === newLines[col]) {
      lines.push({ kind: 'same', text: oldLines[row] ?? '' })
      row += 1
      col += 1
      continue
    }
    const down = scores[row + 1]?.[col] ?? 0
    const right = scores[row]?.[col + 1] ?? 0
    if (down >= right) {
      lines.push({ kind: 'remove', text: oldLines[row] ?? '' })
      row += 1
    } else {
      lines.push({ kind: 'add', text: newLines[col] ?? '' })
      col += 1
    }
  }
  while (row < rows) {
    lines.push({ kind: 'remove', text: oldLines[row] ?? '' })
    row += 1
  }
  while (col < cols) {
    lines.push({ kind: 'add', text: newLines[col] ?? '' })
    col += 1
  }
  return lines
}

function fragmentPieces(before: string, after: string): DiffFragment[] {
  let head = 0
  const limit = Math.min(before.length, after.length)
  while (head < limit && before[head] === after[head]) head += 1
  let tail = 0
  while (
    tail < limit - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1
  }
  const removed = before.slice(head, before.length - tail)
  const added = after.slice(head, after.length - tail)
  if (removed === '' && added === '') return [{ kind: 'equal', text: before }]
  const pieces: DiffFragment[] = []
  if (head > 0) pieces.push({ kind: 'equal', text: '…' })
  if (removed !== '') pieces.push({ kind: 'remove', text: removed })
  if (added !== '') pieces.push({ kind: 'add', text: added })
  if (tail > 0) pieces.push({ kind: 'equal', text: '…' })
  return pieces
}
