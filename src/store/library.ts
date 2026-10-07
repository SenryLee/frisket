/**
 * 侧栏常用文件夹。只记绝对路径，文件列表向安装版要。
 * 最近五次保存位置仍走 folders.ts，两份名单互不影响。
 */

import { reactive } from 'vue'
import { CMD } from '@/ipc/commands'
import {
  folderContainsPath,
  markdownLabel,
  MAX_LIBRARY_FOLDERS,
  pinFolder,
  pruneExpanded,
  readExpanded,
  readLibraryPane,
  toggleKey,
  unpinFolder,
  type LibraryPane,
} from '@/core/libraryFolders'
import { normalizeFolder } from '@/core/recentFolders'
import { isTauriRuntime } from './appearance'

const STORAGE_KEY = 'slate.libraryFolders'
const PANE_KEY = 'slate.libraryPane'
const EXPANDED_KEY = 'slate.libraryExpanded'

export interface LibraryFile {
  path: string
  name: string
}

interface FolderView {
  files: LibraryFile[]
  error: string | null
  loading: boolean
}

const state = reactive<{
  folders: string[]
  views: Record<string, FolderView>
  pane: LibraryPane
  expanded: string[]
}>({
  folders: [],
  views: {},
  pane: 'history',
  expanded: [],
})

const tokens = new Map<string, number>()
let serial = 0
let pickingFolder = false

function loadStored(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const folders: string[] = []
    for (const item of parsed) {
      if (typeof item !== 'string') continue
      const next = normalizeFolder(item)
      if (next === null || folders.includes(next)) continue
      folders.push(next)
    }
    return folders.slice(0, MAX_LIBRARY_FOLDERS)
  } catch {
    return []
  }
}

function persist(list: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // 记不住名单时，这一次添加仍然留在当前界面上。
  }
}

function persistExpanded(keys: readonly string[]): void {
  state.expanded = pruneExpanded(keys, state.folders)
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(state.expanded))
  } catch {
    // 展开状态记不住时，这一次点击仍然生效。
  }
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function readError(error: unknown): string {
  if (typeof error === 'string' && error.trim() !== '') return error
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return '无法读取文件夹'
}

function asFiles(value: unknown): LibraryFile[] {
  if (!Array.isArray(value)) return []
  const files: LibraryFile[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const path = 'path' in item ? item.path : null
    const name = 'name' in item ? item.name : null
    if (typeof path !== 'string' || typeof name !== 'string' || path === '') continue
    files.push({ path, name })
  }
  return files.sort((left, right) =>
    markdownLabel(left.name).localeCompare(markdownLabel(right.name), 'zh'),
  )
}

async function refreshOne(folder: string): Promise<void> {
  const token = serial + 1
  serial = token
  tokens.set(folder, token)
  const previous = state.views[folder]?.files ?? []
  state.views[folder] = { files: previous, error: null, loading: true }
  if (!isTauriRuntime()) {
    if (tokens.get(folder) !== token || !state.folders.includes(folder)) return
    state.views[folder] = { files: [], error: '要在安装版里才能读取', loading: false }
    return
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const listed = await invoke<unknown>(CMD.docListMarkdown, { folder })
    if (tokens.get(folder) !== token || !state.folders.includes(folder)) return
    state.views[folder] = { files: asFiles(listed), error: null, loading: false }
  } catch (error: unknown) {
    if (tokens.get(folder) !== token || !state.folders.includes(folder)) return
    state.views[folder] = { files: [], error: readError(error), loading: false }
  }
}

export const library = {
  get folders(): readonly string[] {
    return state.folders
  },

  files(folder: string): readonly LibraryFile[] {
    return state.views[folder]?.files ?? []
  },

  error(folder: string): string | null {
    return state.views[folder]?.error ?? null
  },

  loading(folder: string): boolean {
    return state.views[folder]?.loading ?? false
  },

  get pane(): LibraryPane {
    return state.pane
  },

  get expandedKeys(): readonly string[] {
    return state.expanded
  },

  isOpen(key: string): boolean {
    return state.expanded.includes(key)
  },

  load(): void {
    state.folders = loadStored()
    state.pane = readLibraryPane(readJson(PANE_KEY))
    state.expanded = pruneExpanded(readExpanded(readJson(EXPANDED_KEY)), state.folders)
    void this.refreshAll()
  },

  setPane(pane: LibraryPane): void {
    state.pane = pane
    try {
      localStorage.setItem(PANE_KEY, JSON.stringify(pane))
    } catch {
      // 记不住当前分页时，这次切换仍然留在界面上。
    }
  },

  toggleOpen(key: string): void {
    persistExpanded(toggleKey(state.expanded, key))
  },

  expandAll(keys: readonly string[]): void {
    persistExpanded(keys)
  },

  collapseAll(): void {
    persistExpanded([])
  },

  pin(folder: string): void {
    const next = pinFolder(state.folders, folder)
    const dropped = state.folders.filter((item) => !next.includes(item))
    state.folders = next
    persist(next)
    persistExpanded(state.expanded)
    for (const item of dropped) delete state.views[item]
    const added = normalizeFolder(folder)
    if (added !== null && next.includes(added)) void refreshOne(added)
  },

  /**
   * 文件夹分页的「打开」。选出的目录钉进名单，本来是收起的就展开。
   * 已经展开的不再折上。取消时名单不动。失败原因交给侧栏提示，不走保存失败。
   */
  async pickFolder(): Promise<string | null> {
    if (pickingFolder) return null
    if (!isTauriRuntime()) return '要在安装版里才能打开文件夹'
    pickingFolder = true
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const picked = await invoke<string | null>(CMD.docPickFolder, { title: '打开文件夹' })
      if (picked === null || picked === '') return null
      const added = normalizeFolder(picked)
      if (added === null) return '这个路径不能打开'
      const wasOpen = this.isOpen(added)
      this.pin(added)
      if (!wasOpen && state.folders.includes(added)) this.toggleOpen(added)
      return null
    } catch (error: unknown) {
      if (typeof error === 'string' && error.trim() !== '') return error
      if (error instanceof Error && error.message.trim() !== '') return error.message
      return '无法打开文件夹'
    } finally {
      pickingFolder = false
    }
  },

  unpin(folder: string): void {
    const next = unpinFolder(state.folders, folder)
    state.folders = next
    persist(next)
    persistExpanded(state.expanded)
    const target = normalizeFolder(folder) ?? folder
    delete state.views[target]
  },

  refresh(folder: string): Promise<void> {
    return refreshOne(folder)
  },

  refreshAll(): Promise<void> {
    return Promise.all(state.folders.map((folder) => refreshOne(folder))).then(() => undefined)
  },

  /** 新建或重命名落到某个已钉文件夹里时，重读那一栏。 */
  refreshContaining(filePath: string): void {
    for (const folder of state.folders) {
      if (folderContainsPath(folder, filePath)) void refreshOne(folder)
    }
  },
}
