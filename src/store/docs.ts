/**
 * docs.ts —— 文档列表与当前文档
 *
 * 在整体中的位置：store/docs 持有「有哪些文档、当前打开哪个」。
 * 只存DocumentMeta（不含正文）—— 正文由内核的 docCache 按 docId 取。
 *
 * ★ 为什么这里不存正文 ★
 * DocumentMeta 里没有正文不是偷懒：1MB 文档放进 reactive 代理后，
 * 每次按键都会触发 Vue 的依赖遍历，编辑器会肉眼可见地卡。
 * 正文留在非响应式的 docCache 里，需要时按id 现取。
 */

import { reactive } from 'vue'
import { CMD } from '@/ipc/commands'
import type { DocumentMeta } from '@/core/interfaces'
import { fileStem } from '@/core/filename'
import { isTauriRuntime } from './appearance'

const state = reactive<{
  /** 按最近打开时间倒序 —— 侧栏直接渲染，无需再排 */
  items: DocumentMeta[]
  currentId: string | null
  /** 历史记录读取中。用于区分「还没加载」与「确实没有历史」两种空态 */
  historyLoading: boolean
  /** 历史记录读取失败的原因，null 表示无错误 */
  historyError: string | null
  /** 当前文档的磁盘路径。还没选文件夹时为 null。 */
  activePath: string | null
  /** 还没落盘时，标题栏上显示的文件名，不含 .md。 */
  pendingName: string
  /** 最近一次保存失败的原因。成功后清空。 */
  saveError: string | null
  /** 本次打开的文档。重命名不换这个值。 */
  sessionKey: string
}>({
  items: [],
  currentId: null,
  historyLoading: false,
  historyError: null,
  activePath: null,
  pendingName: '未命名',
  saveError: null,
  sessionKey: 'draft',
})

let sessionSerial = 0

export const docs = {
  get list(): readonly DocumentMeta[] {
    return state.items
  },

  get currentId(): string | null {
    return state.currentId
  },

  /** 当前文档元信息。未打开任何文档时为 null，界面需自行处理空态 */
  get current(): DocumentMeta | null {
    if (state.currentId === null) return null
    return state.items.find((item) => item.id === state.currentId) ?? null
  },

  get isHistoryLoading(): boolean {
    return state.historyLoading
  },

  get historyError(): string | null {
    return state.historyError
  },

  /** 区分「还没加载」与「没有文档」：两者要显示不同的空态文案 */
  get isEmpty(): boolean {
    return state.items.length === 0
  },

  /**
   * 当前文档标题。
   *
   * 未打开文档时返回空串而非 null —— 标题栏要做 truncate，
   * 传 null 会让三元的两个分支类型不一致。
   */
  get currentTitle(): string {
    return this.current?.title ?? ''
  },

  get activePath(): string | null {
    return state.activePath
  },

  /** 标题栏上的文件名。有路径用磁盘名，否则用还没保存的名字。 */
  get fileLabel(): string {
    if (state.activePath !== null) return fileStem(state.activePath)
    return state.pendingName || '未命名'
  },

  get pendingName(): string {
    return state.pendingName
  },

  get saveError(): string | null {
    return state.saveError
  },

  setActivePath(path: string | null): void {
    state.activePath = path
  },

  setPendingName(name: string): void {
    state.pendingName = name
  },

  setSaveError(message: string | null): void {
    state.saveError = message
  },

  get sessionKey(): string {
    return state.sessionKey
  },

  /** 打开或新建另一份文档时调用。重命名不要调用。 */
  nextSession(): void {
    sessionSerial += 1
    state.sessionKey = String(sessionSerial)
  },

  /** 切换当前文档。内核会在此回调里做「先写回上一个再切换」 */
  setCurrent(id: string | null): void {
    state.currentId = id
  },

  /**
   * 插入或更新一条文档元信息。
   *
   * 用于打开文档后回填真实的 title / wordCount —— 后台扫描文件才能拿到。
   */
  upsert(meta: DocumentMeta): void {
    const index = state.items.findIndex((item) => item.id === meta.id)
    if (index === -1) {
      state.items = [meta, ...state.items]
      return
    }
    const next = [...state.items]
    next[index] = meta
    state.items = next
  },

  /** 移除一条（元信息失效，如文件被删除）。只动列表，不碰当前文档 */
  remove(id: string): void {
    state.items = state.items.filter((item) => item.id !== id)
  },

  clear(): void {
    state.items = []
    state.currentId = null
  },

  /**
   * 拉取历史记录。
   *
   * 为什么放在 store 而不在组件里：拉取失败要写 error 状态，
   * 若逻辑留在 Sidebar，第二个调用方就得把同样的判断再抄一遍。
   *
   * 为什么不静态import @tauri-apps/api：纯浏览器里没有
   * window.__TAURI_INTERNALS__，invoke 会在运行时炸成一串英文异常。
   * 先判运行时再决定要不要加载，浏览器下就完全不会碰到它。
   */
  async loadHistory(): Promise<void> {
    // 浏览器里没有原生层，历史记录必然读不到。
    // 提前返回并给出中文说明，而不是让英文异常冒到界面上 ——
    // 用户看到「Cannot read properties of undefined」无从判断该怎么办。
    if (!isTauriRuntime()) {
      state.historyLoading = false
      state.historyError = null
      state.items = []
      return
    }

    state.historyLoading = true
    state.historyError = null

    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const items = await invoke<DocumentMeta[]>(CMD.docHistory)
      state.items = [...items].sort((left, right) =>
        right.openedAt.localeCompare(left.openedAt),
      )
      state.historyLoading = false
    } catch (error: unknown) {
      // 只取 message 里冒号之前的部分：Rust 侧的 Err(String)
      // 往往带着内部细节，整句透出会泄露实现信息。
      state.historyError = toUserMessage(error)
      state.historyLoading = false
    }
  },
}

/**
 * 把异常转成能给人看的中文文案。
 *
 * 不直接透传 error.message：那可能是「Cannot read properties of undefined」，
 * 也可能带上前端内部路径。用户既看不懂也不知道该做什么。
 */
function toUserMessage(error: unknown): string {
  if (!(error instanceof Error)) return '读取历史记录失败'

  const raw = error.message
  // 英文 JS 异常的典型特征：无空格且含驼峰，或以常见引擎前缀开头
  const looksLikeInternal = /^[A-Za-z]*Error|Cannot read|undefined|null/i.test(raw)
  if (looksLikeInternal) return '读取历史记录失败，请重试'

  const beforeColon = raw.split('：')[0] ?? raw
  return beforeColon.length > 40 ? '读取历史记录失败，请重试' : beforeColon
}

/** 供组件直接调用，避免每个调用方都写一遍 void 前缀 */
export function loadHistory(): Promise<void> {
  return docs.loadHistory()
}