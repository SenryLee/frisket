/**
 * 窗口内壁纸。只记本机路径和压暗程度，不把图片嵌进文档。
 */

import { reactive } from 'vue'
import { isTauriRuntime } from './appearance'

const STORAGE_KEY = 'slate.wallpaper.v1'

interface WallpaperFile {
  path: string | null
  dim: number
}

const state = reactive({
  path: null as string | null,
  /** 0 到 0.65，盖在图片上的暗色，避免玻璃太透时字读不清 */
  dim: 0.28,
  src: null as string | null,
})

export const wallpaper = {
  get path(): string | null {
    return state.path
  },
  get dim(): number {
    return state.dim
  },
  get src(): string | null {
    return state.src
  },
  get active(): boolean {
    return state.src !== null
  },

  init(): void {
    const saved = load()
    state.path = saved.path
    state.dim = saved.dim
    void refreshSrc()
  },

  async pick(): Promise<void> {
    if (!isTauriRuntime()) return
    const { invoke } = await import('@tauri-apps/api/core')
    const path = await invoke<string | null>('wallpaper_pick')
    if (path === null || path === '') return
    state.path = path
    persist()
    await refreshSrc()
  },

  clear(): void {
    state.path = null
    state.src = null
    persist()
  },

  setDim(dim: number): void {
    state.dim = clampDim(dim)
    persist()
  },
}

function load(): WallpaperFile {
  if (typeof localStorage === 'undefined') return { path: null, dim: 0.28 }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { path: null, dim: 0.28 }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { path: null, dim: 0.28 }
    const record = parsed as Record<string, unknown>
    const path = typeof record.path === 'string' && record.path.length > 0 ? record.path : null
    const dim = typeof record.dim === 'number' ? clampDim(record.dim) : 0.28
    return { path, dim }
  } catch {
    return { path: null, dim: 0.28 }
  }
}

function persist(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ path: state.path, dim: state.dim }))
}

async function refreshSrc(): Promise<void> {
  if (state.path === null || !isTauriRuntime()) {
    state.src = null
    return
  }
  const { convertFileSrc } = await import('@tauri-apps/api/core')
  state.src = convertFileSrc(state.path)
}

function clampDim(value: number): number {
  if (!Number.isFinite(value)) return 0.28
  return Math.min(0.65, Math.max(0, value))
}
