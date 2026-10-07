/**
 * 新建文档时问一次保存位置。最近五次文件夹可以直接点。
 */

import { reactive } from 'vue'
import { normalizeFolder, rememberFolder } from '@/core/recentFolders'

const STORAGE_KEY = 'slate.recentFolders'

const state = reactive<{
  open: boolean
  recent: string[]
}>({
  open: false,
  recent: [],
})

let resolver: ((folder: string | null) => void) | null = null

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const folders: string[] = []
    for (const folder of parsed) {
      if (typeof folder !== 'string') continue
      const next = normalizeFolder(folder)
      if (next === null || folders.includes(next)) continue
      folders.push(next)
    }
    return folders.slice(0, 5)
  } catch {
    return []
  }
}

function persist(list: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // 记不住最近文件夹时，这一次选择仍然有效。
  }
}

export const folders = {
  get open(): boolean {
    return state.open
  },

  get recent(): readonly string[] {
    return state.recent
  },

  load(): void {
    state.recent = loadRecent()
  },

  /** 弹出选择。用户取消时返回 null。 */
  ask(): Promise<string | null> {
    if (resolver !== null) resolver(null)
    state.recent = loadRecent()
    state.open = true
    return new Promise((resolve) => {
      resolver = resolve
    })
  },

  choose(folder: string | null): void {
    const resolve = resolver
    resolver = null
    state.open = false
    const next = folder === null ? null : normalizeFolder(folder)
    if (next !== null) {
      state.recent = rememberFolder(state.recent, next)
      persist(state.recent)
    }
    resolve?.(next)
  },
}
