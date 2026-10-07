/**
 * 快捷栏动作 → 编辑器写操作。
 *
 * 顶栏和跟随栏都走这里，保证同一种格式只有一种写法。
 * 格式刷的状态放在模块里：两个栏共用一把刷子。
 */

import { ref } from 'vue'
import type { EditorHandle } from '@/core/interfaces'
import { applyPainter, captureStyle, editFor } from '@/core/format'
import type { FormatRequest, PainterStyle } from '@/core/format'
import type { ToolbarAction } from './types'

export const painterArmed = ref(false)
let remembered: PainterStyle | null = null

export function cancelPainter(): void {
  painterArmed.value = false
  remembered = null
}

export function runToolbarAction(handle: EditorHandle | null, action: ToolbarAction): void {
  if (handle === null) return

  if (action.id === 'undo') {
    handle.undo()
    return
  }
  if (action.id === 'redo') {
    handle.redo()
    return
  }
  if (action.id === 'painter') {
    applyOrArmPainter(handle)
    return
  }
  if (action.id === 'link') {
    handle.insertLink(action.text, action.url)
    handle.focus()
    return
  }
  if (action.id === 'image') {
    handle.insertImage(action.src, action.alt)
    handle.focus()
    return
  }
  if (action.id === 'table') {
    handle.insertTable(action.rows, action.cols)
    handle.focus()
    return
  }

  const request = toRequest(action)
  if (request === null) return
  const selection = handle.getSelection()
  const edit = editFor(handle.getDoc(), selection.from, selection.to, request)
  if (edit) handle.applyEdit(edit)
}

function applyOrArmPainter(handle: EditorHandle): void {
  const selection = handle.getSelection()
  if (painterArmed.value && remembered) {
    const edit = applyPainter(handle.getDoc(), selection.from, selection.to, remembered)
    if (edit) handle.applyEdit(edit)
    cancelPainter()
    return
  }
  remembered = captureStyle(handle.getDoc(), selection.from, selection.to)
  painterArmed.value = true
  handle.focus()
}

function toRequest(action: ToolbarAction): FormatRequest | null {
  switch (action.id) {
    case 'bold':
      return { id: 'wrap', before: '**', after: '**' }
    case 'italic':
      return { id: 'wrap', before: '*', after: '*' }
    case 'strike':
      return { id: 'wrap', before: '~~', after: '~~' }
    case 'code':
      return { id: 'wrap', before: '`', after: '`' }
    case 'highlight':
      return { id: 'wrap', before: '==', after: '==' }
    case 'heading':
      return { id: 'heading', level: action.level }
    case 'quote':
      return { id: 'quote' }
    case 'bullet':
      return { id: 'bullet' }
    case 'ordered':
      return { id: 'ordered' }
    case 'task':
      return { id: 'task' }
    case 'indent':
      return { id: 'indent' }
    case 'outdent':
      return { id: 'outdent' }
    case 'hr':
      return { id: 'hr' }
    case 'hardBreak':
      return { id: 'hardBreak' }
    case 'align':
      return { id: 'align', align: action.align }
    case 'color':
      return { id: 'color', kind: action.kind, color: action.color }
    case 'clear':
      return { id: 'clear' }
    default:
      return null
  }
}
