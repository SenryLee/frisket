/**
 * appearance.ts —— 主题与玻璃状态的唯一入口
 *
 * 在整体中的位置：store/appearance 持有 AppearancePrefs，
 * 并负责把状态「翻译」成 <html> 上的 data-* 属性。
 * 组件只读状态、调这里的函数，绝不自己写 dataset。
 *
 * ★ 零 dispatch 切换的实现要点 ★
 * 主题切换只写一个属性：document.documentElement.dataset.theme。
 * 没有 emit、没有 provide、没有 Compartment 重配 CodeMirror。
 * 因此：
 *   1. 不触发任何 Vue 组件重渲染（切换瞬间不可能出现旧色残留）
 *   2. 不重建编辑器视图，光标与滚动位置天然保持
 *   3. 成本是一次样式重算，1MB 文档下也在毫秒量级
 * CodeMirror 侧的主题与 HighlightStyle 全部写成 var() 引用，
 * 由同一次样式重算一起生效，两侧不会错位。
 */

import { reactive } from 'vue'
import type {
  AppearancePrefs,
  EditorPrefs,
  GlassConfig,
  GlassMode,
  Theme,
} from '@/core/interfaces'

/**
 * 内置主题清单。
 *
 * id 同时是 themes.css 里的选择器后缀（data-theme="neon-glass"），
 * 改这里必须同步改 CSS，否则该主题会静默失效。
 */
export const BUILT_IN_THEMES: readonly Theme[] = Object.freeze([
  { id: 'ink', name: '墨纸', dark: false },
  { id: 'graphite', name: '石墨', dark: true },
  { id: 'sepia', name: '暖米', dark: false },
  { id: 'neon-glass', name: '霓虹玻璃', dark: true },
])

/**
 * 默认玻璃参数。
 *
 * 默认 none 而非 liquid：前端不知道运行在什么系统上，
 * 猜错的后果是「在半透明但无模糊的窗口里写作」——
 * 比明确的不透明糟糕得多。由原生侧探测后下发真实值。
 */
const DEFAULT_GLASS: GlassConfig = Object.freeze({
  mode: 'none',
  radius: 12,
  blur: 20,
  saturate: 180,
  opacity: 0.62,
})

const state = reactive<{ prefs: AppearancePrefs }>({
  prefs: {
    theme: 'ink',
    glass: { ...DEFAULT_GLASS },
    forceOpaque: false,
    motionScale: 1,
    density: 'normal',
  },
})

/**
 * 判断当前是否运行在 Tauri 里。
 *
 * 为什么要单独判：浏览器里没有原生 vibrancy，
 * backdrop-filter 只能模糊同一文档内的元素，后面是白色底色，
 * 结果是「半透明但没模糊」，看起来比不透明更糟。
 * 浏览器下标记 data-runtime="browser"，由 glass.css 走不透明路径。
 *
 * 放在这里而不是 docs.ts：store 里所有需要判断运行时的模块
 * 都从这里导入一份，避免各处各写一次、判定标准出现偏差。
 */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function detectRuntime(): 'tauri' | 'browser' {
  return isTauriRuntime() ? 'tauri' : 'browser'
}

/**
 * 把 prefs 写入 <html> 的 data-* 属性。
 *
 * 单独拆成函数而不是内联在各 setter 里：初值应用与后续切换
 * 必须走完全相同的代码路径，否则「启动时的样子」和
 * 「用户点一次之后的样子」会不一致 —— 这类 bug 极难排查。
 */
function applyToDocument(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const { prefs } = state

  // ★ 主题切换的全部动作就是这一行 ★
  root.dataset.theme = prefs.theme

  // 以下几项供 glass.css / tokens.css 的选择器分支使用
  root.dataset.glass = prefs.glass.mode
  root.dataset.forceOpaque = String(prefs.forceOpaque)
  root.dataset.density = prefs.density
  root.dataset.motion = prefs.motionScale === 0 ? 'off' : 'on'
  root.dataset.runtime = detectRuntime()
}

/**
 * 把编辑区排版偏好写进 CSS 变量。
 *
 * 为什么不放进 reactive 里让编辑器读：字号变化会改变换行位置，
 * 若编辑器以 JS 订阅方式响应，容易在渲染时序上与 CodeMirror 的
 * 测量产生偏差。写成 CSS 变量后由浏览器在下一帧统一重排，
 * 时序上不可能打架。内核的 CodeMirror 主题只引用这些变量，不定义。
 */
function applyTypography(editor: EditorPrefs): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty('--font-editor-family', editor.fontFamily)
  root.style.setProperty('--font-editor-size', `${editor.fontSize}px`)
  root.style.setProperty('--line-height-editor', String(editor.lineHeight))
  root.style.setProperty(
    '--measure-editor',
    editor.maxWidth > 0 ? `${editor.maxWidth}ch` : 'var(--measure-editor-unlimited)',
  )
}

/**
 * 外观相关的对外接口。
 *
 * 用显式函数而不是直接暴露 reactive 对象：dataset 写入是副作用，
 * 混在赋值语句里会让人漏掉。包一层函数后，
 * 「改了状态但忘了应用」这类 bug 在结构上就不可能发生。
 */
export const appearance = {
  get prefs(): AppearancePrefs {
    return state.prefs
  },

  get themes(): readonly Theme[] {
    return BUILT_IN_THEMES
  },

  /** 当前主题对象，未知 id 回落到首个主题 —— 界面不允许出现无名主题 */
  get currentTheme(): Theme {
    return (
      BUILT_IN_THEMES.find((theme) => theme.id === state.prefs.theme) ?? BUILT_IN_THEMES[0]!
    )
  },

  get isDark(): boolean {
    return this.currentTheme.dark
  },

  /**
   * 切换主题。
   *
   * 不做持久化 —— 落盘由原生侧在收到 settings_set 后处理。
   * 前端这里只管让界面立刻变。
   */
  setTheme(themeId: string): void {
    if (!BUILT_IN_THEMES.some((theme) => theme.id === themeId)) {
      // 未知 id 直接忽略：宁可保持当前主题，也不要掉进无主题状态
      return
    }
    state.prefs.theme = themeId
    applyToDocument()
  },

  /** 循环到下一个主题，供标题栏的一键切换按钮使用 */
  cycleTheme(): void {
    const index = BUILT_IN_THEMES.findIndex((theme) => theme.id === state.prefs.theme)
    const next = BUILT_IN_THEMES[(index + 1) % BUILT_IN_THEMES.length]
    if (next) this.setTheme(next.id)
  },

  /**
   * 设置玻璃模式。
   *
   * 传 none 时同时把 forceOpaque 打开：用户明确要求不透明时，
   * 再单独关掉 forceOpaque 只会让状态自相矛盾。
   */
  setGlassMode(mode: GlassMode): void {
    state.prefs.glass.mode = mode
    if (mode === 'none') {
      state.prefs.forceOpaque = true
    }
    applyToDocument()
  },

  setGlassConfig(config: Partial<GlassConfig>): void {
    Object.assign(state.prefs.glass, config)
    applyToDocument()
  },

  /**
   * 强制不透明逃生通道。
   *
   * 玻璃一出问题（边缘错位、颜色发灰），用户必须能一键恢复，
   * 不需要重启应用、不需要命令行。
   */
  setForceOpaque(value: boolean): void {
    state.prefs.forceOpaque = value
    applyToDocument()
  },

  setDensity(density: AppearancePrefs['density']): void {
    state.prefs.density = density
    applyToDocument()
  },

  /**
   * 动画时长倍率，0 表示全禁用。
   *
   * 系统「减弱动态效果」走的是 CSS 媒体查询（tokens.css 内），
   * 与这个倍率是两套机制：系统开关不可被应用覆盖，
   * 应用内的倍率则给用户一个额外的自主控制口。
   */
  setMotionScale(scale: number): void {
    state.prefs.motionScale = Math.max(0, scale)
    applyToDocument()
  },

  /**
   * 编辑区排版：字号、行高、正文宽度。
   *
   * 放在 appearance 而非 editor：这三项决定的是「整套视觉」，
   * 与编辑逻辑无关。内核读 CSS 变量，不读这里。
   */
  applyEditorTypography(editor: EditorPrefs): void {
    applyTypography(editor)
  },

  /**
   * 从原生侧下发的完整设置恢复状态。
   *
   * 一次性应用而非逐字段 setter：避免恢复过程中出现中间态，
   * 用户会看到主题闪一下再变回去。
   */
  hydrate(prefs: AppearancePrefs): void {
    Object.assign(state.prefs, prefs)
    applyToDocument()
  },

  /** 启动时调用。必须在第一个组件挂载前完成，否则会闪一下默认色 */
  init(): void {
    applyToDocument()
  },
}