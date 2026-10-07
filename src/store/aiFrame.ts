/**
 * AI 侧栏打开时，把窗口向右加宽；贴边时收进屏幕工作区。
 * 关上时回到打开前的位置和大小。
 */

import { AI_PANEL_WIDTH, frameForAiPane } from '@/core/windowFrame'
import type { Frame } from '@/core/windowFrame'
import { isTauriRuntime } from './appearance'

let baseline: Frame | null = null
let token = 0

export async function syncAiWindow(open: boolean): Promise<void> {
  if (!isTauriRuntime()) return
  const mine = ++token
  const { getCurrentWindow, currentMonitor, PhysicalPosition, PhysicalSize } = await import(
    '@tauri-apps/api/window'
  )
  const win = getCurrentWindow()
  if (await win.isMaximized()) return
  if (mine !== token) return

  if (!open) {
    const previous = baseline
    baseline = null
    if (previous === null) return
    await win.setPosition(new PhysicalPosition(previous.x, previous.y))
    if (mine !== token) return
    await win.setSize(new PhysicalSize(previous.width, previous.height))
    return
  }

  if (baseline !== null) return
  const [size, pos, scale, monitor] = await Promise.all([
    win.outerSize(),
    win.outerPosition(),
    win.scaleFactor(),
    currentMonitor(),
  ])
  if (mine !== token || monitor === null) return
  const current: Frame = { x: pos.x, y: pos.y, width: size.width, height: size.height }
  baseline = current
  const work: Frame = {
    x: monitor.workArea.position.x,
    y: monitor.workArea.position.y,
    width: monitor.workArea.size.width,
    height: monitor.workArea.size.height,
  }
  const next = frameForAiPane(
    current,
    work,
    Math.round(AI_PANEL_WIDTH * scale),
    Math.round(720 * scale),
  )
  await win.setPosition(new PhysicalPosition(next.x, next.y))
  if (mine !== token) return
  await win.setSize(new PhysicalSize(next.width, next.height))
}
