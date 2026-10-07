/**
 * 侧栏钉住的常用文件夹。和最近五次保存位置是两份名单。
 */

import { normalizeFolder } from './recentFolders'

export const MAX_LIBRARY_FOLDERS = 12

/** 新文件夹放到最前。相对路径和带 `..` 的路径丢掉，最多十二条。 */
export function pinFolder(list: readonly string[], folder: string): string[] {
  const kept = uniqueFolders(list)
  const next = normalizeFolder(folder)
  if (next === null) return kept.slice(0, MAX_LIBRARY_FOLDERS)
  return [next, ...kept.filter((item) => item !== next)].slice(0, MAX_LIBRARY_FOLDERS)
}

/** 只从名单里拿掉。不碰磁盘上的文件。 */
export function unpinFolder(list: readonly string[], folder: string): string[] {
  const target = normalizeFolder(folder)
  return uniqueFolders(list).filter((item) => item !== target)
}

export function markdownLabel(name: string): string {
  return name.replace(/\.(md|markdown)$/i, '')
}

export function folderLabel(path: string): string {
  const normalized = normalizeFolder(path) ?? path.replace(/\/+$/, '')
  const parts = normalized.split('/').filter((part) => part !== '')
  return parts[parts.length - 1] ?? normalized
}

/** 文件是否落在这个文件夹里面。文件夹本身和只是前缀碰巧相同的路径不算。 */
export function folderContainsPath(folder: string, filePath: string): boolean {
  const root = normalizeFolder(folder)
  if (root === null || filePath === '' || filePath.includes('\0')) return false
  if (filePath.split('/').includes('..')) return false
  if (root === '/') return filePath.startsWith('/') && filePath !== '/'
  return filePath.startsWith(`${root}/`)
}

function uniqueFolders(list: readonly string[]): string[] {
  const folders: string[] = []
  for (const item of list) {
    const next = normalizeFolder(item)
    if (next === null || folders.includes(next)) continue
    folders.push(next)
  }
  return folders
}

export type LibraryPane = 'history' | 'folders'

export interface LibraryRow {
  key: string
  label: string
  depth: number
  /** 文件行才有。目录行用来折叠，不打开文档。 */
  filePath: string | null
  open: boolean
}

interface LibraryBranch {
  label: string
  key: string
  filePath: string | null
  children: Map<string, LibraryBranch>
}

/** 侧栏当前看历史还是文件夹。认不出的值回到历史。 */
export function readLibraryPane(value: unknown): LibraryPane {
  return value === 'folders' ? 'folders' : 'history'
}

export function readExpanded(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const keys: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item === '' || keys.includes(item)) continue
    keys.push(item)
  }
  return keys
}

export function toggleKey(keys: readonly string[], key: string): string[] {
  if (key === '') return [...keys]
  return keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key]
}

/** 文件夹移出名单后，它下面记住的展开状态也丢掉。 */
export function pruneExpanded(keys: readonly string[], folders: readonly string[]): string[] {
  return keys.filter((key) =>
    folders.some((folder) => key === folder || (folder !== '/' && key.startsWith(`${folder}/`))),
  )
}

/**
 * 当前能看见的行。目录没展开时，里面的文件不出现。
 * 目录排在文件前面，避免一百多个文件把子目录顶到滚动区外面。
 */
export function visibleLibraryRows(
  files: readonly { path: string; name: string }[],
  expanded: ReadonlySet<string>,
  folder: string,
): LibraryRow[] {
  const rows: LibraryRow[] = []
  appendRows(buildTree(files, folder), 0, rows, expanded)
  return rows
}

/** 某个文件夹里所有可折叠目录。不含文件。 */
export function libraryDirectoryKeys(
  files: readonly { path: string; name: string }[],
  folder: string,
): string[] {
  const keys: string[] = []
  collectDirectories(buildTree(files, folder), keys)
  return keys
}

function buildTree(
  files: readonly { path: string; name: string }[],
  folder: string,
): Map<string, LibraryBranch> {
  const root = new Map<string, LibraryBranch>()
  for (const file of files) {
    if (file.path === '') continue
    const parts = file.name.split('/').filter((part) => part !== '' && part !== '.')
    if (parts.length === 0) continue
    let map = root
    let relative = ''
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? ''
      const isFile = index === parts.length - 1
      relative = relative === '' ? part : `${relative}/${part}`
      const key = isFile ? file.path : directoryKey(folder, relative)
      const existing = map.get(part)
      const node = existing ?? {
        label: isFile ? markdownLabel(part) : part,
        key,
        filePath: isFile ? file.path : null,
        children: new Map<string, LibraryBranch>(),
      }
      if (isFile) {
        node.label = markdownLabel(part)
        node.key = file.path
        node.filePath = file.path
      }
      if (existing === undefined) map.set(part, node)
      map = node.children
    }
  }
  return root
}

function directoryKey(folder: string, relative: string): string {
  if (folder === '/') return `/${relative}`
  return `${folder}/${relative}`
}

function appendRows(
  nodes: Map<string, LibraryBranch>,
  depth: number,
  rows: LibraryRow[],
  expanded: ReadonlySet<string>,
): void {
  const ordered = [...nodes.values()].sort(compareBranches)
  for (const node of ordered) {
    const open = node.filePath === null && expanded.has(node.key)
    rows.push({
      key: node.key,
      label: node.label,
      depth,
      filePath: node.filePath,
      open,
    })
    if (open) appendRows(node.children, depth + 1, rows, expanded)
  }
}

function collectDirectories(nodes: Map<string, LibraryBranch>, keys: string[]): void {
  for (const node of nodes.values()) {
    if (node.filePath !== null) continue
    keys.push(node.key)
    collectDirectories(node.children, keys)
  }
}

function compareBranches(left: LibraryBranch, right: LibraryBranch): number {
  const leftDir = left.filePath === null
  const rightDir = right.filePath === null
  if (leftDir !== rightDir) return leftDir ? -1 : 1
  return left.label.localeCompare(right.label, 'zh')
}
