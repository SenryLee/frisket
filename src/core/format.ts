/**
 * 格式命令 —— 把快捷栏意图变成一次纯文本替换
 *
 * 在整体中的位置：工具栏、快捷键都只描述「要做什么」，
 * 真正改文档的字符串算法在这里。editor.ts 负责 dispatch，
 * 本文件不认识 CodeMirror，因此单测不需要启动编辑器。
 *
 * 约定：一次命令只产出一段替换。多行操作先把涉及的行拼成一块，
 * 再整块换回去，这样撤销栈里是一步，而不是每行一步。
 */

export type AlignMode = 'left' | 'center' | 'right' | 'justify'

export type FormatRequest =
  | { id: 'wrap'; before: string; after: string }
  | { id: 'heading'; level: number }
  | { id: 'quote' }
  | { id: 'bullet' }
  | { id: 'ordered' }
  | { id: 'task' }
  | { id: 'indent' }
  | { id: 'outdent' }
  | { id: 'hr' }
  | { id: 'hardBreak' }
  | { id: 'align'; align: AlignMode }
  | { id: 'color'; kind: 'text' | 'background'; color: string }
  | { id: 'clear' }

/** 一次替换。anchor/head 是替换完成后的选区。 */
export interface TextEdit {
  from: number
  to: number
  insert: string
  anchor: number
  head: number
}

interface LineSpan {
  from: number
  to: number
  text: string
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/** 计算一次格式命令。无法作用时返回 null（例如颜色值不合法）。 */
export function editFor(
  doc: string,
  from: number,
  to: number,
  request: FormatRequest,
): TextEdit | null {
  const start = clamp(Math.min(from, to), 0, doc.length)
  const end = clamp(Math.max(from, to), 0, doc.length)

  switch (request.id) {
    case 'wrap':
      return toggleWrap(doc, start, end, request.before, request.after)
    case 'heading':
      return mapLines(doc, start, end, (text) => setHeading(text, request.level))
    case 'quote':
      return togglePrefix(doc, start, end, quoteLine)
    case 'bullet':
      return togglePrefix(doc, start, end, bulletLine)
    case 'ordered':
      return toggleOrdered(doc, start, end)
    case 'task':
      return togglePrefix(doc, start, end, taskLine)
    case 'indent':
      return mapLines(doc, start, end, (text) => `  ${text}`)
    case 'outdent':
      return mapLines(doc, start, end, outdentLine)
    case 'hr':
      return insertRule(doc, start)
    case 'hardBreak':
      return insertAt(start, end, '  \n')
    case 'align':
      return toggleAlign(doc, start, end, request.align)
    case 'color':
      return toggleColor(doc, start, end, request.kind, request.color)
    case 'clear':
      return clearFormat(doc, start, end)
    default:
      return null
  }
}

/**
 * 从选区向外剥格式，供格式刷记住「这一段长什么样」。
 *
 * 只认工具栏自己会写的标记。认不出的语法原样留下，
 * 避免格式刷把用户手写的 HTML 误剥掉。
 */
export interface PainterStyle {
  wraps: ReadonlyArray<{ before: string; after: string }>
  heading: number | null
  color: string | null
  background: string | null
}

const PAINTER_WRAPS: ReadonlyArray<{ before: string; after: string }> = [
  { before: '**', after: '**' },
  { before: '~~', after: '~~' },
  { before: '==', after: '==' },
  { before: '`', after: '`' },
  { before: '*', after: '*' },
]

export function captureStyle(doc: string, from: number, to: number): PainterStyle {
  const start = clamp(Math.min(from, to), 0, doc.length)
  const end = clamp(Math.max(from, to), 0, doc.length)
  const line = lineAt(doc, start)
  if (start === end) {
    return { wraps: [], heading: headingLevel(line.text), color: null, background: null }
  }

  // 屏幕上选中的是字，星号和颜色标签在选区外面。
  // 先记下选区自己包住的标记，再从原始边界向外找，避免同一层被记两次。
  const wraps: Array<{ before: string; after: string }> = []
  let contentFrom = start
  let contentTo = end
  let peeled = peelInside(doc, contentFrom, contentTo)
  while (peeled) {
    wraps.push(peeled.pair)
    contentFrom = peeled.from
    contentTo = peeled.to
    peeled = peelInside(doc, contentFrom, contentTo)
  }

  let edgeFrom = start
  let edgeTo = end
  let color = readColor(doc, contentFrom, contentTo, 'text')
  let background = readColor(doc, contentFrom, contentTo, 'background')
  let changed = true
  while (changed) {
    changed = false
    const outside = peelOutside(doc, edgeFrom, edgeTo)
    if (outside) {
      wraps.push(outside.pair)
      edgeFrom = outside.from
      edgeTo = outside.to
      changed = true
      continue
    }
    const textEdge = absorbColor(doc, edgeFrom, edgeTo, 'text', color)
    if (textEdge) {
      color = textEdge.color
      edgeFrom = textEdge.from
      edgeTo = textEdge.to
      changed = textEdge.grew
      if (changed) continue
    }
    const backgroundEdge = absorbColor(doc, edgeFrom, edgeTo, 'background', background)
    if (backgroundEdge) {
      background = backgroundEdge.color
      edgeFrom = backgroundEdge.from
      edgeTo = backgroundEdge.to
      changed = backgroundEdge.grew
    }
  }

  return {
    wraps,
    heading: headingLevel(line.text),
    color,
    background,
  }
}

/** 按钮上要显示的字色和高亮。折叠光标也算，格式刷仍然不抄颜色。 */
export interface InkSample {
  color: string | null
  background: string | null
}

export function inkAt(doc: string, from: number, to: number): InkSample {
  const start = clamp(Math.min(from, to), 0, doc.length)
  const end = clamp(Math.max(from, to), 0, doc.length)
  if (start !== end) {
    const style = captureStyle(doc, start, end)
    return { color: style.color, background: style.background }
  }
  return {
    color: spanContaining(doc, start, 'text')?.color ?? null,
    background: spanContaining(doc, start, 'background')?.color ?? null,
  }
}

/** 深色底上用浅色字，浅色底上用深色字。 */
export function chipForeground(hex: string): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!match?.[1]) return '#1a1a1a'
  const value = match[1]
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  const luma = 0.299 * red + 0.587 * green + 0.114 * blue
  return luma >= 160 ? '#1a1a1a' : '#f7f4ee'
}

function peelInside(
  doc: string,
  from: number,
  to: number,
): { pair: { before: string; after: string }; from: number; to: number } | null {
  for (const pair of PAINTER_WRAPS) {
    if (
      doc.slice(from, from + pair.before.length) === pair.before &&
      doc.slice(to - pair.after.length, to) === pair.after &&
      to - from > pair.before.length + pair.after.length
    ) {
      return { pair, from: from + pair.before.length, to: to - pair.after.length }
    }
  }
  return null
}

function peelOutside(
  doc: string,
  from: number,
  to: number,
): { pair: { before: string; after: string }; from: number; to: number } | null {
  for (const pair of PAINTER_WRAPS) {
    if (
      from >= pair.before.length &&
      doc.slice(from - pair.before.length, from) === pair.before &&
      doc.slice(to, to + pair.after.length) === pair.after
    ) {
      return { pair, from: from - pair.before.length, to: to + pair.after.length }
    }
  }
  return null
}

function absorbColor(
  doc: string,
  from: number,
  to: number,
  kind: 'text' | 'background',
  already: string | null,
): { color: string; from: number; to: number; grew: boolean } | null {
  const hit = spanContaining(doc, from, kind)
  const covers = hit !== null && from >= hit.innerFrom && to <= hit.innerTo
  // 颜色已经从内文读到时，仍要把边界扩到标签外面，外面的 ** 才找得到。
  const direct = already ?? readColor(doc, from, to, kind)
  if (!covers && direct === null) return null
  const color = direct ?? hit?.color
  if (!color) return null
  if (!covers || hit === null) return { color, from, to, grew: false }
  const grew = from > hit.from || to < hit.to
  return { color, from: hit.from, to: hit.to, grew }
}

/** 把格式刷记下的样式套到新选区上。多次改写合并成一次替换。 */
export function applyPainter(doc: string, from: number, to: number, style: PainterStyle): TextEdit | null {
  const start = clamp(Math.min(from, to), 0, doc.length)
  const end = clamp(Math.max(from, to), 0, doc.length)
  const hasMark = style.wraps.length > 0 || style.color !== null || style.background !== null
  if (start === end && !hasMark && style.heading === null) return null

  let current = doc
  let selFrom = start
  let selTo = end

  const commit = (next: TextEdit | null): void => {
    if (next === null) return
    current = current.slice(0, next.from) + next.insert + current.slice(next.to)
    selFrom = next.anchor
    selTo = next.head
  }

  if (style.heading !== null) {
    commit(mapLines(current, selFrom, selTo, (text) => setHeading(text, style.heading ?? 1, false)))
  }
  for (const pair of [...style.wraps].reverse()) {
    commit(toggleWrap(current, selFrom, selTo, pair.before, pair.after, false))
  }
  if (style.background) commit(toggleColor(current, selFrom, selTo, 'background', style.background, false))
  if (style.color) commit(toggleColor(current, selFrom, selTo, 'text', style.color, false))

  return singleSpan(doc, current, selFrom, selTo)
}

function toggleWrap(
  doc: string,
  from: number,
  to: number,
  before: string,
  after: string,
  allowUnwrap = true,
): TextEdit {
  const selected = doc.slice(from, to)
  const wrappedInside =
    selected.startsWith(before) &&
    selected.endsWith(after) &&
    selected.length >= before.length + after.length
  const wrappedOutside =
    from >= before.length &&
    doc.slice(from - before.length, from) === before &&
    doc.slice(to, to + after.length) === after

  if (allowUnwrap && wrappedInside && selected.length > before.length + after.length) {
    const inner = selected.slice(before.length, selected.length - after.length)
    return {
      from,
      to,
      insert: inner,
      anchor: from,
      head: from + inner.length,
    }
  }

  if (allowUnwrap && wrappedOutside) {
    const insert = selected
    return {
      from: from - before.length,
      to: to + after.length,
      insert,
      anchor: from - before.length,
      head: from - before.length + insert.length,
    }
  }

  const insert = before + selected + after
  const anchor = from + before.length
  const head = anchor + selected.length
  return { from, to, insert, anchor, head }
}

function mapLines(
  doc: string,
  from: number,
  to: number,
  mapLine: (text: string, index: number) => string,
): TextEdit {
  const lines = linesOverlapping(doc, from, to)
  const blockFrom = lines[0]?.from ?? from
  const last = lines[lines.length - 1]
  const blockTo = last?.to ?? to
  const next = lines.map((line, index) => mapLine(line.text, index))
  const insert = next.join('\n')
  const caret = mapCaret(lines, next, from)
  return { from: blockFrom, to: blockTo, insert, anchor: blockFrom + caret, head: blockFrom + caret }
}

function togglePrefix(
  doc: string,
  from: number,
  to: number,
  transform: (text: string, remove: boolean) => string,
): TextEdit {
  const lines = linesOverlapping(doc, from, to)
  const populated = lines.filter((line) => line.text.trim() !== '')
  const remove = populated.length > 0 && populated.every((line) => isPrefixed(line.text, transform))
  return mapLines(doc, from, to, (text) => (text.trim() === '' ? text : transform(text, remove)))
}

function isPrefixed(text: string, transform: (text: string, remove: boolean) => string): boolean {
  return transform(text, true) !== text
}

function toggleOrdered(doc: string, from: number, to: number): TextEdit {
  const lines = linesOverlapping(doc, from, to)
  const populated = lines.filter((line) => line.text.trim() !== '')
  const remove = populated.length > 0 && populated.every((line) => /^\s*\d+[.)]\s+/.test(line.text))
  let index = 1
  return mapLines(doc, from, to, (text) => {
    if (text.trim() === '') return text
    if (remove) return text.replace(/^(\s*)\d+[.)]\s+/, '$1')
    const indent = /^(\s*)/.exec(text)?.[1] ?? ''
    const body = text.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/^\s+/, '')
    const rendered = `${indent}${index}. ${body}`
    index += 1
    return rendered
  })
}

function insertRule(doc: string, at: number): TextEdit {
  const line = lineAt(doc, at)
  if (line.text.trim() === '') {
    return { from: line.from, to: line.to, insert: '---', anchor: line.from + 3, head: line.from + 3 }
  }
  const insert = '\n---'
  return { from: line.to, to: line.to, insert, anchor: at, head: at }
}

function insertAt(from: number, to: number, text: string): TextEdit {
  return { from, to, insert: text, anchor: from + text.length, head: from + text.length }
}

function toggleAlign(doc: string, from: number, to: number, align: AlignMode): TextEdit {
  const open = `<p align="${align}">`
  const lines = linesOverlapping(doc, from, to)
  const first = lines[0]
  const last = lines[lines.length - 1]
  if (!first || !last) return insertAt(from, to, '')

  const prev = lineBefore(doc, first.from)
  const next = lineAfter(doc, last.to)
  if (prev?.text === open && next?.text === '</p>') {
    return {
      from: prev.from,
      to: next.to,
      insert: lines.map((line) => line.text).join('\n'),
      anchor: prev.from,
      head: prev.from + lines.map((line) => line.text).join('\n').length,
    }
  }

  const inner = doc.slice(first.from, last.to)
  const insert = `${open}\n${inner}\n</p>`
  return {
    from: first.from,
    to: last.to,
    insert,
    anchor: first.from + open.length + 1,
    head: first.from + open.length + 1 + inner.length,
  }
}

/**
 * 颜色标签不能跨行。
 *
 * 渲染按行匹配 `<span>` / `<mark>`。一次选中两行若包成一个标签，
 * 换行会把结束标签推到下一行，标记就无法折叠，用户看到的是原始 HTML。
 * 所以每一行各自包一层，换行留在标签外面。
 * 选区落在已有颜色里面时改这一整段的颜色，而不是再套一层。
 */
function toggleColor(
  doc: string,
  from: number,
  to: number,
  kind: 'text' | 'background',
  color: string,
  allowUnwrap = true,
): TextEdit | null {
  if (!HEX_COLOR.test(color)) return null

  if (from === to) {
    const hit = spanContaining(doc, from, kind)
    if (hit) return rewriteSpan(doc, hit, kind, color, allowUnwrap)
    const open = colorOpen(kind, color)
    const close = colorClose(kind)
    return { from, to, insert: open + close, anchor: from + open.length, head: from + open.length }
  }

  const lines = splitLines(doc).filter((line) => line.from < to && line.to > from)
  if (lines.length === 0) return null

  const parts = lines.map((line) => {
    const sliceFrom = Math.max(line.from, from)
    const sliceTo = Math.min(line.to, to)
    const other = kind === 'text' ? 'background' : 'text'
    const touched = spansOnLine(line, kind).filter(
      (span) => span.from < sliceTo && span.to > sliceFrom,
    )
    // 选区落在另一种颜色里面时，改整个标签，合成一个 span。
    // 套两层标签后，渲染用的「标签内不能再有 <」就匹配不到外层。
    const hosts = spansOnLine(line, other).filter(
      (span) => sliceFrom >= span.innerFrom && sliceTo <= span.innerTo,
    )
    const covered = [...touched, ...hosts]
    const partFrom = covered.reduce((min, span) => Math.min(min, span.from), sliceFrom)
    const partTo = covered.reduce((max, span) => Math.max(max, span.to), sliceTo)
    return { from: partFrom, to: partTo }
  })

  const editFrom = parts[0]?.from ?? from
  const editTo = parts[parts.length - 1]?.to ?? to
  let insert = ''
  let cursor = editFrom
  for (const part of parts) {
    if (cursor < part.from) insert += doc.slice(cursor, part.from)
    const raw = doc.slice(part.from, part.to)
    insert += raw === '' ? '' : recolorPiece(raw, kind, color, allowUnwrap)
    cursor = part.to
  }
  if (cursor < editTo) insert += doc.slice(cursor, editTo)
  if (insert === doc.slice(editFrom, editTo)) return null

  const open = colorOpen(kind, color)
  const close = colorClose(kind)
  const coversTag = insert.startsWith(open) && insert.endsWith(close)
  return {
    from: editFrom,
    to: editTo,
    insert,
    anchor: coversTag ? editFrom + open.length : editFrom,
    head: coversTag ? editFrom + insert.length - close.length : editFrom + insert.length,
  }
}

function recolorPiece(
  raw: string,
  kind: 'text' | 'background',
  color: string,
  allowUnwrap: boolean,
): string {
  const ink = readInk(raw)
  if (ink) return writeInk(retint(ink, kind, color, allowUnwrap))
  const stripped = stripKind(raw, kind)
  if (stripped === '') return ''
  return colorOpen(kind, color) + stripped + colorClose(kind)
}

function rewriteSpan(
  doc: string,
  span: ColorHit,
  kind: 'text' | 'background',
  color: string,
  allowUnwrap: boolean,
): TextEdit | null {
  const raw = doc.slice(span.from, span.to)
  const ink = readInk(raw) ?? {
    color: kind === 'text' ? span.color : null,
    background: kind === 'background' ? span.color : null,
    inner: doc.slice(span.innerFrom, span.innerTo),
  }
  const next = retint(ink, kind, color, allowUnwrap)
  const insert = writeInk(next)
  if (insert === raw) return null
  const close = next.color || next.background ? (next.background && !next.color ? '</mark>'.length : '</span>'.length) : 0
  const openLength = insert.length - next.inner.length - close
  return {
    from: span.from,
    to: span.to,
    insert,
    anchor: span.from + openLength,
    head: span.from + openLength + next.inner.length,
  }
}

interface Ink {
  color: string | null
  background: string | null
  inner: string
}

/** 同色再点一次时只去掉这一种。另一种颜色留在标签上。 */
function retint(ink: Ink, kind: 'text' | 'background', color: string, allowUnwrap: boolean): Ink {
  const next: Ink = { color: ink.color, background: ink.background, inner: ink.inner }
  const current = kind === 'text' ? ink.color : ink.background
  if (allowUnwrap && current !== null && current.toLowerCase() === color.toLowerCase()) {
    if (kind === 'text') next.color = null
    else next.background = null
    return next
  }
  if (kind === 'text') next.color = color
  else next.background = color
  return next
}

function readInk(raw: string): Ink | null {
  const both =
    /^<span style="color:(#[0-9a-fA-F]{6});background-color:(#[0-9a-fA-F]{6})">([\s\S]*)<\/span>$/.exec(raw)
  if (both?.[1] && both[2] && both[3] !== undefined) {
    return { color: both[1], background: both[2], inner: both[3] }
  }
  const text = /^<span style="color:(#[0-9a-fA-F]{6})">([\s\S]*)<\/span>$/.exec(raw)
  if (text?.[1] && text[2] !== undefined) return { color: text[1], background: null, inner: text[2] }
  const mark = /^<mark style="background-color:(#[0-9a-fA-F]{6})">([\s\S]*)<\/mark>$/.exec(raw)
  if (mark?.[1] && mark[2] !== undefined) return { color: null, background: mark[1], inner: mark[2] }
  return null
}

function writeInk(ink: Ink): string {
  if (ink.color && ink.background) {
    return `<span style="color:${ink.color};background-color:${ink.background}">${ink.inner}</span>`
  }
  if (ink.color) return `<span style="color:${ink.color}">${ink.inner}</span>`
  if (ink.background) return `<mark style="background-color:${ink.background}">${ink.inner}</mark>`
  return ink.inner
}

/** 把两份全文的差异收成一段替换。光标位置沿用改写后的坐标。 */
function singleSpan(before: string, after: string, anchor: number, head: number): TextEdit | null {
  if (before === after) return null
  let from = 0
  const max = Math.min(before.length, after.length)
  while (from < max && before.charCodeAt(from) === after.charCodeAt(from)) from += 1
  let beforeEnd = before.length
  let afterEnd = after.length
  while (beforeEnd > from && afterEnd > from && before.charCodeAt(beforeEnd - 1) === after.charCodeAt(afterEnd - 1)) {
    beforeEnd -= 1
    afterEnd -= 1
  }
  return { from, to: beforeEnd, insert: after.slice(from, afterEnd), anchor, head }
}

function clearFormat(doc: string, from: number, to: number): TextEdit {
  return mapLines(doc, from, to, (text) => {
    let next = text
    next = next.replace(/^(#{1,6})\s+/, '')
    next = next.replace(/^>\s?/, '')
    next = next.replace(/^(\s*)([-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '$1')
    next = stripInline(next)
    return next
  })
}

function stripInline(text: string): string {
  let next = text
  const pairs = [
    ['**', '**'],
    ['~~', '~~'],
    ['==', '=='],
    ['`', '`'],
    ['*', '*'],
  ] as const
  for (const [before, after] of pairs) {
    const pattern = new RegExp(`${escapeRegExp(before)}([^\\n]+?)${escapeRegExp(after)}`, 'g')
    next = next.replace(pattern, '$1')
  }
  next = next.replace(
    /<span style="color:#[0-9a-fA-F]{6};background-color:#[0-9a-fA-F]{6}">([^<]*)<\/span>/g,
    '$1',
  )
  next = next.replace(/<span style="color:#[0-9a-fA-F]{6}">([^<]*)<\/span>/g, '$1')
  next = next.replace(/<mark style="background-color:#[0-9a-fA-F]{6}">([^<]*)<\/mark>/g, '$1')
  next = next.replace(/<p align="(?:left|center|right|justify)">/g, '')
  next = next.replace(/<\/p>/g, '')
  return next
}

function setHeading(text: string, level: number, toggle = true): string {
  const safe = clamp(Math.trunc(level), 1, 6)
  const body = text.replace(/^(#{1,6})(?:\s+|$)/, '').trimStart()
  const current = headingLevel(text)
  if (toggle && current === safe) return body
  if (body === '') return `${'#'.repeat(safe)} `
  return `${'#'.repeat(safe)} ${body}`
}

function headingLevel(text: string): number | null {
  const match = /^(#{1,6})(?:\s+|$)/.exec(text)
  return match?.[1] ? match[1].length : null
}

function quoteLine(text: string, remove: boolean): string {
  if (remove) return text.replace(/^>\s?/, '')
  if (/^>\s?/.test(text)) return text
  return `> ${text}`
}

function bulletLine(text: string, remove: boolean): string {
  if (remove) return text.replace(/^(\s*)[-*+]\s+/, '$1')
  if (/^\s*[-*+]\s+/.test(text)) return text
  const indent = /^(\s*)/.exec(text)?.[1] ?? ''
  const body = text.replace(/^\s*(?:\d+[.)]\s+)?/, '')
  return `${indent}- ${body}`
}

function taskLine(text: string, remove: boolean): string {
  const checked = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]\s+/
  const match = checked.exec(text)
  if (match) {
    if (remove) return text.replace(checked, '$1')
    const mark = match[2]?.toLowerCase() === 'x' ? ' ' : 'x'
    return text.replace(checked, `$1[${mark}] `)
  }
  if (remove) return text
  if (/^\s*[-*+]\s+/.test(text)) return text.replace(/^(\s*[-*+]\s+)/, '$1[ ] ')
  const indent = /^(\s*)/.exec(text)?.[1] ?? ''
  return `${indent}- [ ] ${text.trimStart()}`
}

function outdentLine(text: string): string {
  if (text.startsWith('  ')) return text.slice(2)
  if (text.startsWith('\t')) return text.slice(1)
  if (text.startsWith(' ')) return text.slice(1)
  return text
}

function linesOverlapping(doc: string, from: number, to: number): LineSpan[] {
  const all = splitLines(doc)
  const end = from === to ? from : Math.max(from, to - 1)
  const picked = all.filter((line) => line.to >= from && line.from <= end)
  return picked.length > 0 ? picked : [lineAt(doc, from)]
}

function splitLines(doc: string): LineSpan[] {
  const lines: LineSpan[] = []
  let from = 0
  const parts = doc.split('\n')
  for (const text of parts) {
    lines.push({ from, to: from + text.length, text })
    from += text.length + 1
  }
  return lines
}

function lineAt(doc: string, index: number): LineSpan {
  const lines = splitLines(doc)
  return lines.find((line) => index >= line.from && index <= line.to) ?? lines[lines.length - 1] ?? {
    from: 0,
    to: 0,
    text: '',
  }
}

function lineBefore(doc: string, from: number): LineSpan | null {
  if (from <= 0) return null
  return lineAt(doc, from - 1)
}

function lineAfter(doc: string, to: number): LineSpan | null {
  if (to >= doc.length) return null
  const nextIndex = doc[to] === '\n' ? to + 1 : to
  if (nextIndex > doc.length) return null
  const line = lineAt(doc, nextIndex)
  return line.from === to || line.from === to + 1 ? line : null
}

function mapCaret(before: readonly LineSpan[], after: readonly string[], caret: number): number {
  let offset = 0
  for (let index = 0; index < before.length; index += 1) {
    const line = before[index]
    if (!line) continue
    const next = after[index] ?? ''
    if (caret < line.from) return offset
    if (caret <= line.to) {
      const column = Math.min(caret - line.from, next.length)
      return offset + column
    }
    offset += next.length + 1
  }
  return Math.max(0, offset - 1)
}

function colorOpen(kind: 'text' | 'background', color: string): string {
  return kind === 'text'
    ? `<span style="color:${color}">`
    : `<mark style="background-color:${color}">`
}

function colorClose(kind: 'text' | 'background'): string {
  return kind === 'text' ? '</span>' : '</mark>'
}

function readColor(doc: string, from: number, to: number, kind: 'text' | 'background'): string | null {
  const wrapped = readWrappedColor(doc.slice(from, to), kind)
  if (wrapped) return wrapped.color
  const hit = spanContaining(doc, from, kind)
  if (hit && from >= hit.innerFrom && to <= hit.innerTo) return hit.color
  return null
}

interface ColorHit {
  from: number
  to: number
  innerFrom: number
  innerTo: number
  color: string
}

function spanContaining(doc: string, pos: number, kind: 'text' | 'background'): ColorHit | null {
  const line = lineAt(doc, pos)
  return spansOnLine(line, kind).find((span) => pos >= span.from && pos < span.to) ?? null
}

function spansOnLine(line: LineSpan, kind: 'text' | 'background'): ColorHit[] {
  const hits: ColorHit[] = []
  const both =
    /<span style="color:(#[0-9a-fA-F]{6});background-color:(#[0-9a-fA-F]{6})">([^<\n]*)<\/span>/g
  if (kind === 'text') {
    collectSpans(line, /<span style="color:(#[0-9a-fA-F]{6})">([^<\n]*)<\/span>/g, '</span>', 1, 2, hits)
    collectSpans(line, both, '</span>', 1, 3, hits)
  } else {
    collectSpans(
      line,
      /<mark style="background-color:(#[0-9a-fA-F]{6})">([^<\n]*)<\/mark>/g,
      '</mark>',
      1,
      2,
      hits,
    )
    collectSpans(line, both, '</span>', 2, 3, hits)
  }
  return hits
}

function collectSpans(
  line: LineSpan,
  pattern: RegExp,
  close: string,
  colorGroup: number,
  innerGroup: number,
  hits: ColorHit[],
): void {
  for (const match of line.text.matchAll(pattern)) {
    const color = match[colorGroup]
    if (match.index === undefined || !color) continue
    const from = line.from + match.index
    const innerLength = match[innerGroup]?.length ?? 0
    const innerFrom = from + match[0].length - innerLength - close.length
    hits.push({
      from,
      to: from + match[0].length,
      innerFrom,
      innerTo: innerFrom + innerLength,
      color,
    })
  }
}

function stripKind(text: string, kind: 'text' | 'background'): string {
  const pattern =
    kind === 'text'
      ? /<span style="color:#[0-9a-fA-F]{6}">([^<\n]*)<\/span>/g
      : /<mark style="background-color:#[0-9a-fA-F]{6}">([^<\n]*)<\/mark>/g
  return text.replace(pattern, '$1')
}

function readWrappedColor(
  selected: string,
  kind: 'text' | 'background',
): { color: string; inner: string } | null {
  const ink = readInk(selected)
  if (!ink) return null
  const color = kind === 'text' ? ink.color : ink.background
  if (color === null) return null
  return { color, inner: ink.inner }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}
