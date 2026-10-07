/**
 * 打开、保存、新建、重命名。正文只进编辑器，历史里只留元信息。
 *
 * 有路径的文档按键后稍后写入磁盘。新建时先问文件夹。
 */

import { CMD } from '@/ipc/commands'
import type { DocumentMeta, EditorHandle } from '@/core/interfaces'
import { fileNameFromInput, fileStem } from '@/core/filename'
import { directoryOf, setImageBaseDir } from '@/editor/live/image-src'
import { markEditorClean } from '@/core/mount'
import { docs } from './docs'
import { editor } from './editor'
import { isTauriRuntime } from './appearance'
import { folders } from './folders'
import { library } from './library'

/** 侧栏提示。文件夹打开失败不写进保存错误。 */
export const SIDEBAR_NOTICE = 'slate:sidebar-notice'

const AUTOSAVE_MS = 450

let saveTimer = 0
let saveChain: Promise<void> = Promise.resolve()
let suspendAutosave = false
let askedUntitled = false

function notifySidebar(text: string): void {
  window.dispatchEvent(new CustomEvent(SIDEBAR_NOTICE, { detail: text }))
}

/**
 * 侧栏「打开」和 ⌘O 走同一条路。
 * 历史只打开 Markdown。文件夹只选一个目录钉进来。
 */
export async function openFromChrome(handle: EditorHandle | null): Promise<void> {
  if (library.pane === 'folders') {
    const error = await library.pickFolder()
    if (error) notifySidebar(error)
    return
  }
  await openMarkdown(handle)
}

export async function openMarkdown(handle: EditorHandle | null): Promise<void> {
  if (handle === null || !isTauriRuntime()) return
  if (docs.activePath === null && editor.dirty && !confirmDiscard()) return
  if (!(await settleCurrent(handle))) return
  const { invoke } = await import('@tauri-apps/api/core')
  const picked = await invoke<string | null>(CMD.docPickOpen)
  if (picked === null || picked === '') return
  try {
    await loadPath(handle, picked)
  } catch (error: unknown) {
    docs.setSaveError(errorText(error, '无法打开文件'))
  }
}

export async function saveMarkdown(handle: EditorHandle | null): Promise<void> {
  if (handle === null || !isTauriRuntime()) return
  clearSaveTimer()
  if (docs.activePath === null) {
    await bindUntitled(handle)
    return
  }
  await flushAutosave(handle)
}

export async function newMarkdown(handle: EditorHandle | null): Promise<void> {
  if (handle === null) return
  if (docs.activePath === null && editor.dirty && !confirmDiscard()) return
  if (!(await settleCurrent(handle))) return
  if (!isTauriRuntime()) {
    clearUntitled(handle)
    return
  }
  const folder = await folders.ask()
  if (folder === null) return
  clearUntitled(handle)
  await createFile(handle, folder, '未命名')
}

/**
 * 从常用文件夹或历史打开。
 * 已经是当前文档时只聚焦，避免整篇重载冲掉未保存的修改。
 * 返回给界面看的失败原因；成功或用户取消时是 null。
 */
export async function openMarkdownAt(handle: EditorHandle | null, path: string): Promise<string | null> {
  if (path === '') return null
  if (handle === null) return '编辑器还没准备好'
  return openAt(handle, path)
}

export async function openFromHistory(handle: EditorHandle | null, id: string): Promise<string | null> {
  if (handle === null) return '编辑器还没准备好'
  const item = docs.list.find((entry) => entry.id === id)
  if (!item) {
    docs.setCurrent(id)
    return null
  }
  if (!isTauriRuntime()) {
    docs.setCurrent(id)
    return null
  }
  return openAt(handle, item.path)
}

/** 正文变脏。有路径就排队保存；还没有路径就问一次文件夹。 */
export function noteDocumentEdited(handle: EditorHandle | null): void {
  if (suspendAutosave) return
  if (handle === null || !isTauriRuntime()) return
  if (docs.activePath === null) {
    if (askedUntitled) return
    askedUntitled = true
    void bindUntitled(handle)
    return
  }
  scheduleAutosave(handle)
}

/**
 * 改文件名。
 * 还没选文件夹时只改标题栏上的名字，选文件夹时用这个名字建文件。
 */
export async function renameDocument(
  handle: EditorHandle | null,
  path: string | null,
  rawName: string,
): Promise<boolean> {
  const fileName = fileNameFromInput(rawName)
  if (fileName === null) {
    docs.setSaveError('请换一个文件名')
    return false
  }
  const stem = fileStem(fileName)
  if (path === null) {
    if (docs.activePath !== null) return false
    docs.setPendingName(stem)
    docs.setSaveError(null)
    return true
  }
  if (!isTauriRuntime()) return false
  if (fileStem(path) === stem) return true
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const nextPath = await invoke<string>(CMD.docRename, { from: path, name: stem })
    const current = path === docs.activePath
    const text = current && handle !== null ? handle.getDoc() : null
    const previous = docs.list.find((item) => item.id === path || item.path === path)
    const meta =
      text !== null
        ? describe(nextPath, text)
        : retitle(previous, path, nextPath, stem)
    const hidden = docs.isHistoryOmitted(path)
    docs.remove(path)
    if (hidden) {
      docs.allowHistory(path)
      docs.holdFromHistory(nextPath)
    }
    docs.upsert(meta)
    if (docs.currentId === path || current) docs.setCurrent(meta.id)
    if (current) {
      docs.setActivePath(nextPath)
      handle?.refresh()
    }
    docs.setSaveError(null)
    return true
  } catch (error: unknown) {
    docs.setSaveError(error instanceof Error ? error.message : '无法重命名')
    return false
  }
}

export async function flushAutosave(handle: EditorHandle | null): Promise<void> {
  clearSaveTimer()
  const run = saveChain.then(() => writeSnapshot(handle))
  saveChain = run.then(
    () => undefined,
    () => undefined,
  )
  await run
}

function scheduleAutosave(handle: EditorHandle): void {
  clearSaveTimer()
  saveTimer = window.setTimeout(() => {
    void flushAutosave(handle)
  }, AUTOSAVE_MS)
}

/**
 * 先把当前文件写完，再允许换成另一篇。
 * 没路径的新文档由调用方在第一次等待之前询问，避免确认框被系统吞掉。
 */
async function settleCurrent(handle: EditorHandle): Promise<boolean> {
  clearSaveTimer()
  if (docs.activePath !== null && isTauriRuntime()) {
    await flushAutosave(handle)
    if (!editor.dirty) return true
    return confirmDiscard()
  }
  return true
}

async function openAt(handle: EditorHandle, path: string): Promise<string | null> {
  if (samePath(docs.activePath, path)) {
    handle.focus()
    return null
  }
  if (!isTauriRuntime()) return '要在安装版里才能打开'
  if (docs.activePath === null && editor.dirty && !confirmDiscard()) return null
  if (!(await settleCurrent(handle))) {
    return docs.saveError ?? '没有切换，当前文档还有未保存的修改'
  }
  try {
    await loadPath(handle, path)
    return null
  } catch (error: unknown) {
    const message = errorText(error, '无法打开文件')
    docs.setSaveError(message)
    return message
  }
}

async function bindUntitled(handle: EditorHandle): Promise<void> {
  if (!isTauriRuntime() || docs.activePath !== null) return
  const folder = await folders.ask()
  if (folder === null || docs.activePath !== null) return
  await createFile(handle, folder, docs.pendingName)
}

async function createFile(handle: EditorHandle, folder: string, name: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const path = await invoke<string>(CMD.docCreate, { folder, name })
    const text = handle.getDoc()
    await writeFile(path, text)
    const meta = describe(path, text)
    await touchHistory(meta)
    docs.upsert(meta)
    docs.setCurrent(meta.id)
    docs.setActivePath(path)
    handle.refresh()
    docs.setPendingName('未命名')
    askedUntitled = false
    editor.setDirty(false)
    markEditorClean()
    docs.setSaveError(null)
    handle.focus()
  } catch (error: unknown) {
    docs.setSaveError(error instanceof Error ? error.message : '无法创建文件')
  }
}

function clearUntitled(handle: EditorHandle): void {
  clearSaveTimer()
  suspendAutosave = true
  try {
    handle.setDoc('')
    docs.setCurrent(null)
    docs.setActivePath(null)
    docs.setPendingName('未命名')
    docs.nextSession()
    askedUntitled = false
    editor.setDirty(false)
    handle.focus()
  } finally {
    suspendAutosave = false
  }
}

async function loadPath(handle: EditorHandle, path: string): Promise<void> {
  clearSaveTimer()
  suspendAutosave = true
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const text = await invoke<string>(CMD.docRead, { path })
    clearSaveTimer()
    docs.allowHistory(path)
    setImageBaseDir(directoryOf(path))
    handle.setDoc(text)
    docs.setActivePath(path)
    const meta = describe(path, text)
    docs.upsert(meta)
    docs.setCurrent(meta.id)
    docs.setPendingName(fileStem(path))
    docs.nextSession()
    askedUntitled = false
    editor.setDirty(false)
    markEditorClean()
    docs.setSaveError(null)
    handle.focus()
    try {
      await touchHistory(meta)
    } catch (error: unknown) {
      docs.setSaveError(errorText(error, '文档已打开，但没能记入历史'))
    }
  } finally {
    suspendAutosave = false
    clearSaveTimer()
  }
}

/** 把当前路径上的正文写盘。正文若在写入期间又变了，再写一次。 */
async function writeSnapshot(handle: EditorHandle | null, attempt = 0): Promise<void> {
  if (handle === null || suspendAutosave) return
  const path = docs.activePath
  if (path === null || !isTauriRuntime()) return
  const text = handle.getDoc()
  try {
    await writeFile(path, text)
    if (suspendAutosave) return
    if (handle.getDoc() !== text || docs.activePath !== path) {
      if (attempt < 4) await writeSnapshot(handle, attempt + 1)
      return
    }
    const meta = describe(path, text)
    docs.upsert(meta)
    docs.setCurrent(meta.id)
    editor.setDirty(false)
    markEditorClean()
    docs.setSaveError(null)
    void touchHistory(meta)
  } catch (error: unknown) {
    docs.setSaveError(errorText(error, '无法保存'))
  }
}

function clearSaveTimer(): void {
  window.clearTimeout(saveTimer)
  saveTimer = 0
}

function samePath(left: string | null, right: string): boolean {
  if (left === null || right === '') return false
  return left.normalize('NFC') === right.normalize('NFC')
}

function errorText(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim() !== '') return error
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return fallback
}

async function writeFile(path: string, text: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke(CMD.docWrite, { path, text })
}

async function touchHistory(meta: DocumentMeta): Promise<void> {
  if (docs.isHistoryOmitted(meta.id) || docs.isHistoryOmitted(meta.path)) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke(CMD.docHistoryTouch, { meta })
}

function confirmDiscard(): boolean {
  if (!editor.dirty) return true
  return window.confirm('当前文档还有未保存的修改。继续会丢掉这些修改。')
}

function retitle(
  previous: DocumentMeta | undefined,
  oldPath: string,
  nextPath: string,
  stem: string,
): DocumentMeta {
  const now = new Date().toISOString()
  if (previous === undefined) {
    return {
      id: nextPath,
      path: nextPath,
      title: stem,
      preview: '',
      wordCount: 0,
      createdAt: now,
      openedAt: now,
    }
  }
  const title = previous.title === fileStem(oldPath) ? stem : previous.title
  return { ...previous, id: nextPath, path: nextPath, title, openedAt: now }
}

function describe(path: string, text: string): DocumentMeta {
  const name = path.split('/').pop() ?? '未命名'
  const heading = text.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim()
  const title = heading && heading !== '' ? heading : name.replace(/\.md$/i, '')
  const preview = text
    .replace(/[#>*_`~\-[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  const now = new Date().toISOString()
  return {
    id: path,
    path,
    title,
    preview,
    wordCount: text.replace(/\s/g, '').length,
    createdAt: now,
    openedAt: now,
  }
}
