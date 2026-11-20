/**
 * 每篇文档一条短对话。
 * 有路径的写进 localStorage；没路径的只留在这次进程的内存里。
 * 不放进响应式 store，避免长回答拖住面板。
 */

import { outlineHeadings } from '@/core/outline'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export type ThreadKey = { kind: 'path'; path: string } | { kind: 'session'; sessionKey: string }

export interface ContextChoice {
  outline: boolean
  nearby: boolean
  whole: boolean
}

const MAX_MESSAGES = 20
const NEARBY = 400
const DOC_CAP = 8000
const STORAGE_PREFIX = 'frisket.aiThread.'

const memory = new Map<string, ChatMessage[]>()

export function clearThreadMemory(): void {
  memory.clear()
}

export function rememberThread(key: ThreadKey, messages: readonly ChatMessage[], storage: Storage | null): string | null {
  const trimmed = messages.slice(-MAX_MESSAGES).map((message) => ({ ...message }))
  memory.set(memoryId(key), trimmed)
  if (key.kind === 'session') return null
  if (storage === null) return null
  try {
    storage.setItem(storageId(key.path), JSON.stringify(trimmed))
    return null
  } catch {
    return '这次没能记下'
  }
}

export function recallThread(key: ThreadKey, storage: Storage | null): ChatMessage[] {
  const cached = memory.get(memoryId(key))
  if (cached !== undefined) return cached.map((message) => ({ ...message }))
  if (key.kind === 'session' || storage === null) return []
  try {
    const raw = storage.getItem(storageId(key.path))
    if (raw === null || raw === '') return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const messages = parsed.filter(isChatMessage).slice(-MAX_MESSAGES)
    memory.set(memoryId(key), messages.map((message) => ({ ...message })))
    return messages.map((message) => ({ ...message }))
  } catch {
    return []
  }
}

/** 没勾选时原样返回。勾了的上下文只附在最后一条用户消息上，不改原来的数组。 */
export function attachContext(messages: readonly ChatMessage[], context: string): ChatMessage[] {
  const next = messages.map((message) => ({ ...message }))
  if (context.trim() === '') return next
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const message = next[index]
    if (message !== undefined && message.role === 'user') {
      next[index] = { role: 'user', content: `${message.content}\n\n${context}` }
      break
    }
  }
  return next
}

export function buildChatContext(doc: string, cursor: number, choice: ContextChoice): string {
  const parts: string[] = []
  if (choice.outline) {
    const lines = outlineHeadings(doc).map((heading) => `${'#'.repeat(heading.level)} ${heading.text}`)
    if (lines.length > 0) parts.push(`标题大纲：\n${lines.join('\n')}`)
  }
  if (choice.nearby) {
    const at = clamp(cursor, 0, doc.length)
    const nearby = doc.slice(Math.max(0, at - NEARBY), Math.min(doc.length, at + NEARBY))
    parts.push(`光标附近：\n${nearby}`)
  }
  if (choice.whole) {
    const clipped = clipAround(doc, cursor, DOC_CAP)
    const note = clipped.truncated ? '（正文已截断，只保留光标附近）\n' : ''
    parts.push(`整篇：\n${note}${clipped.text}`)
  }
  return parts.join('\n\n')
}

export function replacePayload(card: {
  action: string
  instruction: string
  snapshot: { from: number; to: number; target: string; context: string }
  followUp: { source: string; instruction: string } | null
}): { action: string; target: string; context: string; instruction: string; from: number; to: number } {
  return {
    action: card.action,
    target: card.followUp?.source ?? card.snapshot.target,
    context: card.snapshot.context,
    instruction: card.followUp?.instruction ?? card.instruction,
    from: card.snapshot.from,
    to: card.snapshot.to,
  }
}

function clipAround(doc: string, cursor: number, limit: number): { text: string; truncated: boolean } {
  if (doc.length <= limit) return { text: doc, truncated: false }
  const at = clamp(cursor, 0, doc.length)
  const half = Math.floor(limit / 2)
  let start = Math.max(0, at - half)
  let end = Math.min(doc.length, start + limit)
  start = Math.max(0, end - limit)
  return { text: doc.slice(start, end), truncated: true }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function memoryId(key: ThreadKey): string {
  return key.kind === 'path' ? `path:${key.path.normalize('NFC')}` : `session:${key.sessionKey}`
}

function storageId(path: string): string {
  return `${STORAGE_PREFIX}${path.normalize('NFC')}`
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as { role?: unknown; content?: unknown }
  return (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string'
}
