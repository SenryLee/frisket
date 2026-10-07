/**
 * ai.ts —— AI 面板的 UI 状态
 *
 * 在整体中的位置：AI 推理由「AI」子智能体的组件负责，
 * 本文件只描述面板的可见性与流式进度。
 *
 * ★ 边界说明 ★
 * 这里刻意不放 prompt、不放 provider 调用、不放消息历史。
 * 那是 ai/AIPanel 的职责。若把消息数组放进 store，
 * 流式 delta 每来一次就会触发一次深度响应式遍历，
 * 长回答下足以让面板卡住 —— 流式内容必须留在组件本地。
 * store 里只放「面板开不开」「流到哪一步」这类低频状态。
 */

import { reactive } from 'vue'
import type { AiAction, AiErrorCode } from '@/core/interfaces'
import { beginDocumentSession, decideAutoOpen } from '@/core/aiSession'

const state = reactive<{
  /** 面板是否展开 */
  open: boolean
  /** 是否正在流式接收。用于显示停止按钮与进度条 */
  streaming: boolean
  /** 已接收的字符数。低频更新（每 200ms 批量一次），不做逐 delta 响应 */
  receivedChars: number
  /** 当前正在执行的动作，未开始时为 null */
  pendingAction: AiAction | null
  /** 上一次的错误。null 表示无错误 */
  error: { message: string; code: AiErrorCode } | null
  /** 尚未划选正文时给出引导，而非让面板空着 */
  awaitingSelection: boolean
  /** 这份文档本次打开已经自动展开过 */
  autoOpened: boolean
  /** 用户这次手动关上过。关上之后不再自动打开。 */
  dismissed: boolean
  docKey: string | null
}>({
  open: false,
  streaming: false,
  receivedChars: 0,
  pendingAction: null,
  error: null,
  awaitingSelection: false,
  autoOpened: false,
  dismissed: false,
  docKey: null,
})

export const ai = {
  get open(): boolean {
    return state.open
  },

  get streaming(): boolean {
    return state.streaming
  },

  get receivedChars(): number {
    return state.receivedChars
  },

  get pendingAction(): AiAction | null {
    return state.pendingAction
  },

  get error(): { message: string; code: AiErrorCode } | null {
    return state.error
  },

  get awaitingSelection(): boolean {
    return state.awaitingSelection
  },

  /** 无错误时可安全展示主操作按钮 */
  get canAct(): boolean {
    return !state.streaming && state.error === null
  },

  /** 用户要求打开。手动打开后，这次不再当成「还没自动打开过」。 */
  show(): void {
    state.open = true
    state.dismissed = false
    state.autoOpened = true
  },

  /**
   * 这份文档第一次划选时打开。
   * 已经开着，或用户这次手动关过，就什么也不做。
   */
  requestAutoOpen(): void {
    const next = decideAutoOpen(state)
    if (next === null) return
    state.open = next.open
    state.dismissed = next.dismissed
    state.autoOpened = next.autoOpened
  },

  /** 换了一份文档。关着的侧栏可以再自动打开一次。 */
  beginDocument(key: string): void {
    if (state.docKey === key) return
    state.docKey = key
    const next = beginDocumentSession(state.open)
    state.dismissed = next.dismissed
    state.autoOpened = next.autoOpened
  },

  /**
   * 切换面板。
   *
   * 关闭时顺手清掉错误：否则下次打开会看到上一次的报错，
   * 而那个错误对应的上下文已经不存在了。
   */
  toggle(): void {
    if (state.open) {
      this.close()
      return
    }
    this.show()
  },

  close(): void {
    state.open = false
    state.dismissed = true
    state.error = null
    state.awaitingSelection = false
  },

  /** 流式开始。action 为 null 表示自由对话 */
  startStream(action: AiAction | null): void {
    state.streaming = true
    state.pendingAction = action
    state.receivedChars = 0
    state.error = null
  },

  /**
   * 累加流式字符数。
   *
   * 由调用方按 200ms 节流后调用，不逐delta 调用 —— 见文件头说明。
   */
  addReceivedChars(count: number): void {
    state.receivedChars += count
  },

  endStream(): void {
    state.streaming = false
    state.pendingAction = null
  },

  /**
   * 记录错误。
   *
   * 保留 code 而不只留 message：不同错误码对应完全不同的用户动作
   * （no_key 要引导去配置，rate_limited 要提示等待，
   * leak_detected 要提示重新划选），界面需要据此分支。
   */
  setError(message: string, code: AiErrorCode): void {
    state.error = { message, code }
    state.streaming = false
    state.pendingAction = null
  },

  clearError(): void {
    state.error = null
  },

  setAwaitingSelection(awaiting: boolean): void {
    state.awaitingSelection = awaiting
  },
}