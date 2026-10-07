/**
 * 文字颜色和高亮按钮跟着当前选区变。
 * 同长度换色不会改选区偏移，也不会改字数，所以这里同时读 editor.rev。
 */

import { computed, inject, type CSSProperties } from 'vue'
import { chipForeground, inkAt, type InkSample } from '@/core/format'
import { EDITOR_HANDLE, useStore } from '@/store'

const EMPTY: InkSample = { color: null, background: null }

export function useSelectionInk() {
  const store = useStore()
  const handleRef = inject(EDITOR_HANDLE, null)
  let cached = EMPTY

  const ink = computed<InkSample>(() => {
    void store.editor.rev
    const handle = handleRef?.value
    const from = store.editor.selection.from
    const to = store.editor.selection.to
    const next = handle ? inkAt(handle.getDoc(), from, to) : EMPTY
    if (cached.color === next.color && cached.background === next.background) return cached
    cached = next
    return next
  })

  const textStyle = computed<CSSProperties | undefined>(() =>
    ink.value.color === null ? undefined : { color: ink.value.color },
  )

  const highlightStyle = computed<CSSProperties | undefined>(() => {
    const background = ink.value.background
    if (background === null) return undefined
    return { background, color: chipForeground(background) }
  })

  return { ink, textStyle, highlightStyle }
}

export function sameHex(current: string | null, swatch: string): boolean {
  return current !== null && current.toLowerCase() === swatch.toLowerCase()
}
