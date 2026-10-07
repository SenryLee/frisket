/**
 * 文档状态缓存 —— 记住每个文档的完整EditorState
 *
 * 在整体中的位置：core/editor.ts 切文档时调swapDocument()。
 *
 * 为什么缓存 State 而不是缓存正文：
 * 正文重新 parse 一遍就行，但 State 里还有撤销栈、选区、折叠状态、
 * 以及三层装饰字段的值。丢掉它们意味着切走再切回来时用户会回到文档开头，
 * 撤销历史清零 —— 这是「编辑器忘记我在哪」的最伤体验的一类问题。
 *
 * 内存是唯一顾虑。State 与正文的比值大致 3~5倍，
 * 5万字文档约 1MB。策略：只保留最近 N 个文档（LRU），
 * 且不缓存空文档（新建未保存的文档不值得占位）。
 *
 * 注意：State 是不可变值，多个 view 共享同一个 State 是安全的，
 * 不需要 clone。这也正是缓存可行的根本原因。
 */

import type { EditorState } from '@codemirror/state'

/** 缓存上限。超出后按最久未用淘汰。 */
const MAX_CACHED_DOCS = 8

/**
 * Map 而非 WeakMap：key是字符串（文档 id），WeakMap 的弱引用语义用不上。
 *
 * 每次读写都顺手刷新插入顺序 —— Map 保持插入序，
 * 于是「最久未用的」就是迭代顺序里的第一个，淘汰逻辑不需要额外的计数器。
 */
const stateCache = new Map<string, EditorState>()

export function getCachedState(docId: string): EditorState | undefined {
  const state = stateCache.get(docId)
  if (state === undefined) return undefined
  // 命中即提到队尾，实现 LRU
  stateCache.delete(docId)
  stateCache.set(docId, state)
  return state
}

export function setCachedState(docId: string, state: EditorState): void {
  if (docId === '') return
  stateCache.delete(docId)
  stateCache.set(docId, state)
  evictIfNeeded()
}

function evictIfNeeded(): void {
  while (stateCache.size > MAX_CACHED_DOCS) {
    const oldest = stateCache.keys().next()
    if (oldest.done === true) return
    stateCache.delete(oldest.value)
  }
}

/** 关闭文档时清缓存。文档被删除或移到别处时必须调用，否则脏State 会留在内存里。 */
export function dropCachedState(docId: string): void {
  stateCache.delete(docId)
}

/** 全部清空。退出登录 / 切换工作区等边界场景使用。 */
export function clearDocCache(): void {
  stateCache.clear()
}

/** 缓存中的文档数。供设置面板展示内存占用。 */
export function cachedDocCount(): number {
  return stateCache.size
}