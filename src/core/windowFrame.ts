/**
 * AI 侧栏打开时，窗口要怎么挪才能把侧栏留在屏幕里。
 *
 * 右边还有空位就加宽。已经贴着屏幕边缘，就把窗口收进工作区。
 */

export interface Frame {
  x: number
  y: number
  width: number
  height: number
}

export const AI_PANEL_WIDTH = 380

export function frameForAiPane(frame: Frame, work: Frame, panel: number, minWidth: number): Frame {
  const room = work.x + work.width - (frame.x + frame.width)
  if (room >= panel) {
    return { ...frame, width: frame.width + panel }
  }
  const width = Math.max(minWidth, Math.min(frame.width + panel, work.width))
  let x = frame.x
  const right = work.x + work.width
  if (x + width > right) x = right - width
  if (x < work.x) x = work.x
  return { ...frame, x, width }
}
