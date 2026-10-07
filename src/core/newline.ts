/**
 * 回车离开行内标记。
 *
 * 格式命令会把选区留在标记内侧（`**文字|**`）。
 * 这时按回车，默认行为会把换行插进标记里，看起来像标记被切换。
 * 这里只在光标贴着标记边界时，把换行放到整段标记外面。
 * 光标在文字中间时返回 null，交给普通换行。
 */

export interface NewlineEdit {
  from: number
  to: number
  insert: string
  cursor: number
}

const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['**', '**'],
  ['__', '__'],
  ['~~', '~~'],
  ['==', '=='],
  ['`', '`'],
  ['*', '*'],
  ['_', '_'],
]

/** 光标或选区贴着行内标记时，返回一次「在标记外换行」的替换。否则返回 null。 */
export function newlineOutsideMarker(doc: string, from: number, to: number): NewlineEdit | null {
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  if (start < 0 || end > doc.length) return null

  for (const [open, close] of PAIRS) {
    const edit = pairExit(doc, start, end, open, close)
    if (edit !== null) return edit
  }
  return colorExit(doc, start, end)
}

function pairExit(doc: string, start: number, end: number, open: string, close: string): NewlineEdit | null {
  if (sliceAt(doc, start - open.length, open) && sliceAt(doc, end, close) && !extendsRun(doc, start - open.length, open)) {
    return at(end + close.length)
  }
  if (start !== end) return null

  const closing = closingRun(doc, start, close)
  if (closing !== null && findOpener(doc, closing.start, open) !== null) {
    return at(closing.start + close.length)
  }
  return atInnerStart(doc, start, open, close)
}

function atInnerStart(doc: string, pos: number, open: string, close: string): NewlineEdit | null {
  if (!sliceAt(doc, pos - open.length, open)) return null
  if (extendsRun(doc, pos - open.length, open)) return null
  const lineEnd = doc.indexOf('\n', pos)
  const stop = lineEnd === -1 ? doc.length : lineEnd
  const relative = indexOfMarker(doc.slice(pos, stop), close)
  if (relative < 0) return null
  return at(pos - open.length)
}

function colorExit(doc: string, start: number, end: number): NewlineEdit | null {
  const open =
    /<(span style="color:#[0-9a-fA-F]{6}(?:;background-color:#[0-9a-fA-F]{6})?"|mark style="background-color:#[0-9a-fA-F]{6}")>$/.exec(
      doc.slice(0, start),
    )
  if (open?.[1] !== undefined && open[0] !== undefined) {
    const close = open[1].startsWith('mark') ? '</mark>' : '</span>'
    if (sliceAt(doc, end, close)) return at(end + close.length)
    if (start === end && doc.slice(end).includes(close)) return at(start - open[0].length)
  }
  if (start !== end) return null

  for (const close of ['</span>', '</mark>'] as const) {
    const overlap = tagOverlap(doc, start, close)
    if (overlap === null) continue
    const pattern =
      close === '</span>'
        ? /<span style="color:#[0-9a-fA-F]{6}(?:;background-color:#[0-9a-fA-F]{6})?">/g
        : /<mark style="background-color:#[0-9a-fA-F]{6}">/g
    const before = doc.slice(0, overlap)
    let found = -1
    for (const match of before.matchAll(pattern)) {
      if (match.index !== undefined) found = match.index
    }
    if (found >= 0) return at(overlap + close.length)
  }
  return null
}

function closingRun(doc: string, pos: number, marker: string): { start: number } | null {
  if (!uniform(marker)) return null
  const ch = marker[0]
  if (ch === undefined) return null
  const probe = pos < doc.length && doc[pos] === ch ? pos : pos - 1
  if (probe < 0 || doc[probe] !== ch) return null
  let left = probe
  while (left > 0 && doc[left - 1] === ch) left -= 1
  let right = probe + 1
  while (right < doc.length && doc[right] === ch) right += 1
  if (right - left < marker.length) return null
  if (marker.length === 1 && right - left > 1) return null
  if (pos < left || pos >= right) return null
  const closeStart = right - marker.length
  if (pos < closeStart) return null
  return { start: closeStart }
}

function findOpener(doc: string, closeStart: number, marker: string): number | null {
  const lineStart = doc.lastIndexOf('\n', Math.max(0, closeStart - 1)) + 1
  const segment = doc.slice(lineStart, closeStart)
  const idx = segment.lastIndexOf(marker)
  if (idx < 0) return null
  let abs = lineStart + idx
  if (uniform(marker)) {
    const ch = marker[0]
    while (abs > lineStart && doc[abs - 1] === ch) abs -= 1
  }
  if (abs + marker.length > closeStart) return null
  return abs
}

function indexOfMarker(text: string, marker: string): number {
  const idx = text.indexOf(marker)
  if (idx < 0) return -1
  if (uniform(marker) && text[idx + marker.length] === marker[0]) return -1
  return idx
}

/** 单字符标记紧挨着同样的字符时，它其实是更长的标记，不能拆开。 */
function extendsRun(doc: string, atPos: number, marker: string): boolean {
  if (!uniform(marker) || marker.length !== 1 || atPos < 0) return false
  return doc[atPos - 1] === marker[0] || doc[atPos + marker.length] === marker[0]
}

function tagOverlap(doc: string, pos: number, tag: string): number | null {
  for (let start = Math.max(0, pos - tag.length + 1); start <= pos; start += 1) {
    if (!sliceAt(doc, start, tag)) continue
    if (pos >= start && pos < start + tag.length) return start
  }
  return null
}

function uniform(marker: string): boolean {
  return marker.length > 0 && marker.split('').every((char) => char === marker[0])
}

function sliceAt(doc: string, index: number, text: string): boolean {
  if (index < 0) return false
  return doc.slice(index, index + text.length) === text
}

function at(index: number): NewlineEdit {
  return { from: index, to: index, insert: '\n', cursor: index + 1 }
}
