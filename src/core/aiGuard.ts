/**
 * 划选改写的写回锁：长度、位置、围栏净化、上下文泄漏，再加上结构。
 * 长度仍是原文三倍加 200，不放进设置。泄漏前后文分开查。
 * 续写是插入，不套用替换的长度锁和泄漏锁。
 * 提示词分栏在 Rust 里组装。
 */

export interface RewriteSnapshot {
  from: number
  to: number
  target: string
  /** 选区前 400 字。泄漏检查单独用，不和后文粘在一起。 */
  before: string
  /** 选区后 400 字。 */
  after: string
  /** 选区前 400 字与后 400 字，只作参考，仍按原样送给模型。 */
  context: string
}

export type GuardFailure = 'empty' | 'too_long' | 'leak_detected' | 'stale' | 'repeat' | 'structure'

export type GuardResult =
  | { ok: true; text: string; before: number; after: number }
  | {
      ok: false
      code: GuardFailure
      message: string
      /** 超长、泄漏、结构被改可以强行写回。空结果和位置变了不行。 */
      force: boolean
      text: string
      before: number
      after: number
    }

const RADIUS = 400
const LEAK_HAN = 40
const LEAK_PLAIN = 20
const HAN = /[\u3400-\u9fff\uf900-\ufaff]/

/** 续写的插入点，以及光标前最多 400 字。后文不送。 */
export interface ContinuationSnapshot {
  at: number
  prefix: string
}

export function captureSelection(doc: string, from: number, to: number): RewriteSnapshot | null {
  if (from < 0 || to > doc.length || from >= to) return null
  const target = doc.slice(from, to)
  if (target.trim() === '') return null
  const before = doc.slice(Math.max(0, from - RADIUS), from)
  const after = doc.slice(to, Math.min(doc.length, to + RADIUS))
  return { from, to, target, before, after, context: `${before}${after}` }
}

/** 没有选区时 at 是光标；有选区时调用方传入选区末尾。 */
export function captureContinuation(doc: string, at: number): ContinuationSnapshot | null {
  if (at < 0 || at > doc.length) return null
  return { at, prefix: doc.slice(Math.max(0, at - RADIUS), at) }
}

/** 结果若以前文开头，剥掉与光标前这段字重合的前缀。先看整段，再往短里收。 */
export function stripRepeatedPrefix(text: string, prefix: string): string {
  if (prefix.length === 0 || text.length === 0) return text
  const max = Math.min(prefix.length, text.length)
  for (let size = max; size > 0; size -= 1) {
    if (text.startsWith(prefix.slice(prefix.length - size))) return text.slice(size)
  }
  return text
}

/** 剥掉包住全文的 markdown 围栏，以及首尾空行。 */
export function stripModelFences(raw: string): string {
  let text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const fenced = text.match(/^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n?```\s*$/i)
  if (fenced?.[1] !== undefined) text = fenced[1]
  return text.replace(/^\n+/, '').replace(/\n+$/, '')
}

export function countChars(text: string): number {
  return Array.from(text.replace(/\s+/g, '')).length
}

export function prepareReplacement(
  snapshot: RewriteSnapshot,
  raw: string,
  docNow: string,
  action: string,
): GuardResult {
  const before = countChars(snapshot.target)
  if (docNow.slice(snapshot.from, snapshot.to) !== snapshot.target) {
    return refuse('stale', '文档已变更，请重新划选', false, '', before, 0)
  }
  const text = stripModelFences(raw)
  const after = countChars(text)
  if (text.trim() === '') {
    return refuse('empty', '模型没有返回可替换的正文', false, '', before, after)
  }
  const limit = before * 3 + 200
  if (after > limit) {
    return refuse(
      'too_long',
      `结果有 ${after} 字，超过原文的三倍加 200，已拒绝写回`,
      true,
      text,
      before,
      after,
    )
  }
  const structure = structureIssue(snapshot.target, text, action)
  if (structure !== null) {
    return refuse('structure', structure, true, text, before, after)
  }
  const leak = findContextLeak(text, snapshot.before, snapshot.after, snapshot.target)
  if (leak !== null) {
    const where = leak.side === 'before' ? '选区前' : '选区后'
    return refuse('leak_detected', `结果复述了${where}的原文：「${leak.slice}」`, true, text, before, after)
  }
  return { ok: true, text, before, after }
}

/** 续写写回前的检查。不套用替换的长度锁和泄漏锁。 */
export function prepareContinuation(snapshot: ContinuationSnapshot, raw: string, docNow: string): GuardResult {
  const start = Math.max(0, snapshot.at - snapshot.prefix.length)
  if (snapshot.at > docNow.length || docNow.slice(start, snapshot.at) !== snapshot.prefix) {
    return refuse('stale', '文档已变更，请重新续写', false, '', 0, 0)
  }
  const cleaned = stripModelFences(raw)
  if (cleaned.trim() === '') {
    return refuse('empty', '模型没有返回要补上的文字', false, '', 0, 0)
  }
  const text = stripRepeatedPrefix(cleaned, snapshot.prefix)
  if (text.trim() === '') {
    return refuse('repeat', '结果只是在重复前文', false, '', 0, 0)
  }
  const open = unclosedFence(text)
  if (open !== null) {
    return refuse('structure', `插入的内容有未闭合的围栏：${open}`, true, text, 0, countChars(text))
  }
  return { ok: true, text, before: 0, after: countChars(text) }
}

function refuse(
  code: GuardFailure,
  message: string,
  force: boolean,
  text: string,
  before: number,
  after: number,
): GuardResult {
  return { ok: false, code, message, force, text, before, after }
}

interface LeakHit {
  side: 'before' | 'after'
  slice: string
}

/** 前后文分开查。汉字过半的一侧用连续 40 字，否则用连续 20 个非空白字符。 */
export function findContextLeak(
  text: string,
  before: string,
  after: string,
  target: string,
): LeakHit | null {
  return hitIn(text, before, target, 'before') ?? hitIn(text, after, target, 'after')
}

function hitIn(text: string, side: string, target: string, which: 'before' | 'after'): LeakHit | null {
  for (const slice of leakWindows(side)) {
    if (slice.trim() === '') continue
    if (target.includes(slice)) continue
    if (text.includes(slice)) return { side: which, slice }
  }
  return null
}

function leakWindows(side: string): string[] {
  if (hanMajority(side)) return charWindows(side, LEAK_HAN)
  return nonSpaceWindows(side, LEAK_PLAIN)
}

function hanMajority(text: string): boolean {
  const chars = Array.from(text).filter((ch) => !/\s/u.test(ch))
  if (chars.length === 0) return false
  let han = 0
  for (const ch of chars) {
    if (HAN.test(ch)) han += 1
  }
  return han * 2 > chars.length
}

function charWindows(text: string, size: number): string[] {
  const chars = Array.from(text)
  const windows: string[] = []
  for (let index = 0; index <= chars.length - size; index += 1) {
    windows.push(chars.slice(index, index + size).join(''))
  }
  return windows
}

function nonSpaceWindows(text: string, size: number): string[] {
  const chars = Array.from(text)
  const marks: number[] = []
  chars.forEach((ch, index) => {
    if (!/\s/u.test(ch)) marks.push(index)
  })
  const windows: string[] = []
  for (let index = 0; index <= marks.length - size; index += 1) {
    const start = marks[index] ?? 0
    const end = marks[index + size - 1] ?? start
    windows.push(chars.slice(start, end + 1).join(''))
  }
  return windows
}

interface FenceBlock {
  lang: string
  body: string
  open: string
}

interface FenceSplit {
  outside: string[]
  fences: FenceBlock[]
  unclosed: string | null
}

function splitFences(text: string): FenceSplit {
  const lines = text.split('\n')
  const outside: string[] = []
  const fences: FenceBlock[] = []
  let open: { char: string; len: number; lang: string; marker: string; body: string[] } | null = null
  for (const line of lines) {
    const matched = /^(?: {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
    const marker = matched?.[1]
    const info = matched?.[2] ?? ''
    if (open === null) {
      if (marker !== undefined && (marker[0] !== '`' || !info.includes('`'))) {
        open = {
          char: marker[0] ?? '`',
          len: marker.length,
          lang: info.trim(),
          marker: `${marker}${info.trim()}`,
          body: [],
        }
        continue
      }
      outside.push(line)
      continue
    }
    if (marker !== undefined && marker[0] === open.char && marker.length >= open.len && info.trim() === '') {
      fences.push({ lang: open.lang, body: open.body.join('\n'), open: open.marker })
      open = null
      continue
    }
    open.body.push(line)
  }
  return { outside, fences, unclosed: open === null ? null : open.marker }
}

function unclosedFence(text: string): string | null {
  return splitFences(text).unclosed
}

interface Heading {
  level: number
  title: string
}

type ListKind = 'ul' | 'ol' | 'task'

function structureIssue(original: string, next: string, action: string): string | null {
  const left = splitFences(original)
  const right = splitFences(next)
  if (right.unclosed !== null) return `围栏没有闭合：${right.unclosed}`
  if (left.fences.length > right.fences.length) {
    return `围栏被拆掉了：${left.fences[right.fences.length]?.open ?? left.fences[0]?.open ?? '```'}`
  }
  if (right.fences.length > left.fences.length) {
    return `把围栏外的字包进了围栏：${right.fences[left.fences.length]?.open ?? '```'}`
  }
  for (let index = 0; index < left.fences.length; index += 1) {
    const from = left.fences[index]
    const to = right.fences[index]
    if (from === undefined || to === undefined) continue
    if (from.lang !== to.lang) {
      return `围栏语言标记从 ${from.lang || '无'} 变成了 ${to.lang || '无'}：${from.open}`
    }
    if (action !== 'fixGrammar' && from.body !== to.body) return `围栏被改动了：${from.open}`
  }
  if (action === 'fixGrammar') {
    const wrapped = outsideLineMovedIntoFence(left.outside, right)
    if (wrapped !== null) return `把围栏外的字包进了围栏：${wrapped}`
  }
  const headings = compareHeadings(readHeadings(left.outside), readHeadings(right.outside))
  if (headings !== null) return headings
  if (action !== 'toList' && action !== 'toTable') {
    const lists = compareLists(readLists(left.outside), readLists(right.outside))
    if (lists !== null) return lists
  }
  return compareUrls(left.outside.join('\n'), right.outside.join('\n'))
}

function outsideLineMovedIntoFence(outside: string[], next: FenceSplit): string | null {
  const kept = next.outside.join('\n')
  const inside = next.fences.map((fence) => fence.body).join('\n')
  for (const line of outside) {
    const trimmed = line.trim()
    if (trimmed.length < 4) continue
    if (!kept.includes(trimmed) && inside.includes(trimmed)) return trimmed
  }
  return null
}

function readHeadings(lines: string[]): Heading[] {
  const found: Heading[] = []
  for (const line of lines) {
    const matched = /^(#{1,6})(?:[ \t]+(.*))?$/.exec(line.trimEnd())
    const marks = matched?.[1]
    if (marks === undefined) continue
    found.push({ level: marks.length, title: (matched?.[2] ?? '').trim() })
  }
  return found
}

const LEVEL = ['', '一', '二', '三', '四', '五', '六']

function levelName(level: number): string {
  return `${LEVEL[level] ?? String(level)}级`
}

function compareHeadings(left: Heading[], right: Heading[]): string | null {
  const count = Math.max(left.length, right.length)
  for (let index = 0; index < count; index += 1) {
    const from = left[index]
    const to = right[index]
    if (from !== undefined && to === undefined) {
      return `少了${levelName(from.level)}标题：${from.title || '空标题'}`
    }
    if (from === undefined && to !== undefined) {
      return `新加了${levelName(to.level)}标题：${to.title || '空标题'}`
    }
    if (from !== undefined && to !== undefined && from.level !== to.level) {
      return `${levelName(from.level)}标题被改成了${levelName(to.level)}：${from.title || to.title || '空标题'}`
    }
  }
  return null
}

function readLists(lines: string[]): ListKind[] {
  const kinds: ListKind[] = []
  for (const line of lines) {
    const kind = listKind(line)
    if (kind !== null) kinds.push(kind)
  }
  return kinds
}

function listKind(line: string): ListKind | null {
  const rest = /^(?: {0,3})(.*)$/.exec(line)?.[1] ?? ''
  if (/^[-*+][ \t]+\[[ xX]\][ \t]+/.test(rest)) return 'task'
  if (/^\d{1,9}[.)][ \t]+/.test(rest)) return 'ol'
  if (/^[-*+][ \t]+/.test(rest)) return 'ul'
  return null
}

const LIST_NAME: Record<ListKind, string> = { ul: '无序', ol: '有序', task: '任务' }

function compareLists(left: ListKind[], right: ListKind[]): string | null {
  const count = Math.max(left.length, right.length)
  for (let index = 0; index < count; index += 1) {
    const from = left[index]
    const to = right[index]
    if (from !== undefined && to !== undefined && from !== to) {
      return `${LIST_NAME[from]}列表被改成了${LIST_NAME[to]}列表`
    }
    if (from !== undefined && to === undefined) return `少了一处${LIST_NAME[from]}列表`
    if (from === undefined && to !== undefined) return `新加了${LIST_NAME[to]}列表`
  }
  return null
}

function compareUrls(original: string, next: string): string | null {
  const wanted = readUrls(original)
  const have = readUrls(next)
  for (const item of wanted) {
    const index = have.findIndex((candidate) => candidate.kind === item.kind && candidate.url === item.url)
    if (index === -1) {
      return item.kind === 'image' ? `丢掉了图片地址：${item.url}` : `丢掉了链接地址：${item.url}`
    }
    have.splice(index, 1)
  }
  return null
}

function readUrls(text: string): { kind: 'link' | 'image'; url: string }[] {
  const found: { kind: 'link' | 'image'; url: string }[] = []
  const pattern = /(!?)\[([^\]]*)\]\(([^)\s]+)/g
  for (const matched of text.matchAll(pattern)) {
    const url = matched[3]
    if (url === undefined) continue
    found.push({ kind: matched[1] === '!' ? 'image' : 'link', url })
  }
  return found
}
