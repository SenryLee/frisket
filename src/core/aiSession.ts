/**
 * 一份文档本次打开期间，AI 侧栏要不要自己展开。
 *
 * 首次划选才自动打开。已经开着，或用户这次手动关上过，就不再自动打开。
 */

export interface AiOpenState {
  open: boolean
  dismissed: boolean
  autoOpened: boolean
}

/** 可以自动打开时返回下一状态，否则返回 null。 */
export function decideAutoOpen(state: AiOpenState): AiOpenState | null {
  if (state.open || state.dismissed || state.autoOpened) return null
  return { open: true, dismissed: false, autoOpened: true }
}

/** 换了一份文档。侧栏如果还开着，这次就不要再自动扩一次。 */
export function beginDocumentSession(open: boolean): Pick<AiOpenState, 'dismissed' | 'autoOpened'> {
  return { dismissed: false, autoOpened: open }
}
