/**
 * 自定义皮肤。盖在当前主题之上，写进 html 的内联变量。
 * 内联变量优先级高于主题样式表，所以换主题后自定义仍然保留。
 * 重置会删掉这些内联变量，主题本身不受影响。
 */

const STORAGE_KEY = 'slate.skin.v1'

export interface SkinDraft {
  accent: string | null
  background: string | null
  foreground: string | null
  radius: number | null
  fontFamily: string | null
  glassBlur: number | null
  glassOpacity: number | null
}

export const EMPTY_SKIN: SkinDraft = {
  accent: null,
  background: null,
  foreground: null,
  radius: null,
  fontFamily: null,
  glassBlur: null,
  glassOpacity: null,
}

const FONT_CHOICES = [
  { id: '', label: '跟随主题' },
  { id: '-apple-system, "PingFang SC", sans-serif', label: '苹方 / 系统黑体' },
  { id: '"Songti SC", "STSong", serif', label: '宋体' },
  { id: '"Kaiti SC", "STKaiti", serif', label: '楷体' },
  { id: 'Georgia, "Songti SC", serif', label: 'Georgia' },
  { id: '"SF Mono", Menlo, monospace', label: '等宽' },
] as const

export function fontChoices(): readonly { id: string; label: string }[] {
  return FONT_CHOICES
}

export function loadSkin(): SkinDraft {
  if (typeof localStorage === 'undefined') return { ...EMPTY_SKIN }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { ...EMPTY_SKIN }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY_SKIN }
    return { ...EMPTY_SKIN, ...pickSkin(parsed as Record<string, unknown>) }
  } catch {
    return { ...EMPTY_SKIN }
  }
}

export function saveSkin(draft: SkinDraft): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
  applySkin(draft)
}

export function clearSkin(): SkinDraft {
  const empty = { ...EMPTY_SKIN }
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  applySkin(empty)
  return empty
}

export function applySkin(draft: SkinDraft): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  setColor(root, '--c-accent', draft.accent)
  setColor(root, '--c-accent-hover', draft.accent === null ? null : shade(draft.accent, -18))
  setColor(root, '--accent', draft.accent)
  setColor(root, '--accent-hover', draft.accent === null ? null : shade(draft.accent, -18))
  setColor(root, '--c-bg-base', draft.background)
  setColor(root, '--bg-base', draft.background)
  const channels = draft.background === null ? null : hexChannels(draft.background)
  setRaw(root, '--c-bg-rgb', channels)
  setColor(root, '--c-text-primary', draft.foreground)
  setColor(root, '--text-primary', draft.foreground)
  setRaw(root, '--radius-lg', draft.radius === null ? null : `${draft.radius}px`)
  setRaw(root, '--radius-md', draft.radius === null ? null : `${Math.max(4, draft.radius - 4)}px`)
  setRaw(root, '--font-editor-family', draft.fontFamily)
  setRaw(root, '--glass-l1-blur', draft.glassBlur === null ? null : `${draft.glassBlur}px`)
  setRaw(root, '--glass-l3-blur', draft.glassBlur === null ? null : `${Math.round(draft.glassBlur * 1.4)}px`)
  setRaw(root, '--glass-l1-alpha', draft.glassOpacity === null ? null : String(draft.glassOpacity))
  // 编辑区只跟着轻微变透，避免正文直接透出壁纸。
  // 标题栏单独封底，不能跟着滑到全透，否则红绿灯那一条会点穿。
  setRaw(root, '--glass-l2-alpha', draft.glassOpacity === null ? null : editorAlpha(draft.glassOpacity))
  setRaw(root, '--glass-l3-alpha', draft.glassOpacity === null ? null : panelAlpha(draft.glassOpacity))
  setRaw(root, '--titlebar-alpha', draft.glassOpacity === null ? null : titlebarAlpha(draft.glassOpacity))
}

function editorAlpha(opacity: number): string {
  return String(Math.min(0.96, Math.max(0.84, 0.7 + opacity * 0.26)))
}

function panelAlpha(opacity: number): string {
  return String(Math.max(0.86, Math.min(0.94, opacity + 0.2)))
}

function titlebarAlpha(opacity: number): string {
  return String(Math.max(0.9, opacity))
}

export function exportSkin(draft: SkinDraft, theme: string): string {
  return JSON.stringify({ version: 1, theme, skin: draft }, null, 2)
}

export function importSkin(raw: string): { theme: string | null; skin: SkinDraft } | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Record<string, unknown>
    const skinSource =
      typeof record.skin === 'object' && record.skin !== null
        ? (record.skin as Record<string, unknown>)
        : record
    const theme = typeof record.theme === 'string' ? record.theme : null
    return { theme, skin: { ...EMPTY_SKIN, ...pickSkin(skinSource) } }
  } catch {
    return null
  }
}

function pickSkin(record: Record<string, unknown>): Partial<SkinDraft> {
  return {
    accent: asHex(record.accent),
    background: asHex(record.background),
    foreground: asHex(record.foreground),
    radius: asNumber(record.radius, 4, 28),
    fontFamily: typeof record.fontFamily === 'string' ? record.fontFamily : null,
    glassBlur: asNumber(record.glassBlur, 0, 48),
    glassOpacity: asNumber(record.glassOpacity, 0.35, 1),
  }
}

function asHex(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null
}

function asNumber(value: unknown, low: number, high: number): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null
  return Math.min(high, Math.max(low, value))
}

function setColor(root: HTMLElement, name: string, value: string | null): void {
  setRaw(root, name, value)
}

function setRaw(root: HTMLElement, name: string, value: string | null): void {
  if (value === null || value === '') root.style.removeProperty(name)
  else root.style.setProperty(name, value)
}

function hexChannels(hex: string): string | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!match?.[1]) return null
  const value = Number.parseInt(match[1], 16)
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`
}

function shade(hex: string, amount: number): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!match?.[1]) return hex
  const value = Number.parseInt(match[1], 16)
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const next = Math.min(255, Math.max(0, channel + amount))
    return next.toString(16).padStart(2, '0')
  })
  return `#${channels.join('')}`
}
