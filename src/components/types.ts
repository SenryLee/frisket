/**
 * 组件间共享的 UI 类型。
 *
 * 快捷栏只表达意图。带参数的操作（标题级别、颜色、表格尺寸）
 * 把参数放在动作里，避免工具栏直接改文档。
 */

import type { AlignMode } from '@/core/format'

export type ToolbarAction =
  | { id: 'undo' }
  | { id: 'redo' }
  | { id: 'bold' }
  | { id: 'italic' }
  | { id: 'strike' }
  | { id: 'code' }
  | { id: 'highlight' }
  | { id: 'heading'; level: number }
  | { id: 'quote' }
  | { id: 'bullet' }
  | { id: 'ordered' }
  | { id: 'task' }
  | { id: 'indent' }
  | { id: 'outdent' }
  | { id: 'hr' }
  | { id: 'hardBreak' }
  | { id: 'link'; text: string; url: string }
  | { id: 'image'; alt: string; src: string }
  | { id: 'table'; rows: number; cols: number }
  | { id: 'align'; align: AlignMode }
  | { id: 'color'; kind: 'text' | 'background'; color: string }
  | { id: 'clear' }
  | { id: 'painter' }

export const TEXT_COLORS = ['#1a1a1a', '#c0392b', '#a8542a', '#2f6feb', '#2f7a4d', '#7c3aed'] as const
export const BACKGROUND_COLORS = ['#f3e2a2', '#f8d0d0', '#d9f2e3', '#d6e6ff', '#f3d9ff', '#ffe3c4'] as const
