/**
 * 划选改写的六道锁里，能在写回前判定的四道：
 * 长度护栏、位置锁、围栏净化、上下文泄漏。
 * 提示词分栏在 Rust 里组装，写回只走 replaceRange。
 */

export interface RewriteSnapshot {
  from: number
  to: number
  target: string
  /** 选区前 400 字与后 400 字，只作参考 */
  context: string
}

export type GuardFailure = 'empty' | 'too_long' | 'leak_detected' | 'stale'

export type GuardResult =
  | { ok: true; text: string; before: number; after: number }
  | { ok: false; code: GuardFailure; message: string }

const RADIUS = 400
const LEAK_RUN = 20

export function captureSelection(doc: string, from: number, to: number): RewriteSnapshot | null {
  if (from < 0 || to > doc.length || from >= to) return null
  const target = doc.slice(from, to)
  if (target.trim() === '') return null
  const before = doc.slice(Math.max(0, from - RADIUS), from)
  const after = doc.slice(to, Math.min(doc.length, to + RADIUS))
  return { from, to, target, context: `${before}${after}` }
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

/**
 * 新文本里如果出现上下文中连续 20 字、且原文目标里没有的片段，视为把上下文吐了回来。
 */
export function containsContextLeak(text: string, context: string, target: string): boolean {
  const source = context.replace(/\s+/g, ' ').trim()
  if (Array.from(source).length < LEAK_RUN) return false
  const chars = Array.from(source)
  for (let index = 0; index <= chars.length - LEAK_RUN; index += 1) {
    const slice = chars.slice(index, index + LEAK_RUN).join('')
    if (slice.trim().length < LEAK_RUN) continue
    if (target.includes(slice)) continue
    if (text.includes(slice)) return true
  }
  return false
}

export function prepareReplacement(snapshot: RewriteSnapshot, raw: string, docNow: string): GuardResult {
  if (docNow.slice(snapshot.from, snapshot.to) !== snapshot.target) {
    return { ok: false, code: 'stale', message: '文档已变更，请重新划选' }
  }
  const text = stripModelFences(raw)
  if (text.trim() === '') {
    return { ok: false, code: 'empty', message: '模型没有返回可替换的正文' }
  }
  const before = countChars(snapshot.target)
  const after = countChars(text)
  const limit = before * 3 + 200
  if (after > limit) {
    return {
      ok: false,
      code: 'too_long',
      message: `结果有 ${after} 字，超过原文的三倍加 200，已拒绝写回`,
    }
  }
  if (containsContextLeak(text, snapshot.context, snapshot.target)) {
    return { ok: false, code: 'leak_detected', message: '结果复述了选区之外的上下文，已拒绝写回' }
  }
  return { ok: true, text, before, after }
}
