/**
 * index.ts —— store 装配与useStore()
 *
 * 在整体中的位置：所有组件通过 useStore() 拿状态，
 * 组件与组件之间不互相import状态模块。
 *
 * ★ 为什么不用 Pinia ★
 * 1. 最大的状态本来就不在这里。EditorState 是不可变大对象且内部有环，
 *    必须放在非响应式的模块级 Map 里（core/docCache.ts），
 *    用 view.setState() 切换。既然主要状态被排除在 store 之外，
 *    Pinia 提供的抽象就只剩下「多写一层defineStore」的收益。
 * 2. 状态量很小：主题、玻璃、文档列表、当前文档、编辑区统计、
 *    AI 面板开关。一个 reactive 对象 + 一个 getter 就够。
 * 3. 依赖纪律：Plan 里明确「不擅自引入依赖」。
 *
 * 详见 docs/ARCHITECTURE.md「状态管理：为什么不用 Pinia」。
 */

import { reactive } from 'vue'
import type { InjectionKey, Ref } from 'vue'
import type { EditorHandle } from '@/core/interfaces'

import { ai } from './ai'
import { appearance } from './appearance'
import { docs, loadHistory } from './docs'
import { editor, setTypographyApplier } from './editor'
import { folders } from './folders'
import { library } from './library'
import { wallpaper } from './wallpaper'

/**
 * EditorHandle 的 provide / inject 键。
 *
 * 为什么不放在 core 里：core/ 属于内核子智能体的文件所有权范围，
 * 跨 agent 新建文件会在集成时撞车。而这个键是「UI 层如何拿到内核能力」
 * 的约定，本就属于 store 的职责。
 *
 * 为什么需要它：快捷栏、AI 面板、命令面板都要操作同一份文档状态。
 * 若各自 import 单例，三条调用路径会让撤销分组与 AI 写回识别失效。
 * 统一走 provide，调用路径永远只有一条。
 *
 * 类型必须是 Ref<EditorHandle | null> 而非 EditorHandle 本身：
 * provide 普通值时消费侧拿到的是快照，核心里途替换 EditorHandle
 * （切文档会重建视图）后 Toolbar 会永远握着旧实例。
 *
 * 消费侧必须写 inject(EDITOR_HANDLE, null)，带 null 默认值：
 * 内核尚未接入时不该抛「injection not found」。
 */
export const EDITOR_HANDLE: InjectionKey<Ref<EditorHandle | null>> = Symbol(
  'slate:editor-handle',
)

/**
 * store 的对外形状。
 *
 * 用显式接口而非 typeof reactive对象：写出来才能在改字段时
 * 让编译器检查所有调用点，而不是悄悄扩展出一个谁也不知道的字段。
 */
export interface Store {
  appearance: typeof appearance
  docs: typeof docs
  editor: typeof editor
  ai: typeof ai
  folders: typeof folders
  library: typeof library
  wallpaper: typeof wallpaper
  /** 侧栏是否折叠。不放appearance —— 它是布局状态不是外观设置 */
  sidebarCollapsed: boolean
  /** AI 面板当前的实际展开态，与 ai.open 同源，抽出来供布局层直接用 */
  isAiPanelOpen: boolean
}

const state = reactive({
  sidebarCollapsed: false,
})

/**
 * useStore() 返回的对象。
 *
 * ★ 必须是单例，不能每次调用都 new 一个 ★
 * 组件里写 `store.sidebarCollapsed = true` 时，
 * 若每次 useStore() 返回一个新对象，不同组件拿到的就是不同外壳，
 * 依赖收集会按对象身份建立，写入后可能不触发其它组件的更新。
 * 单例保证所有组件读写的是同一份引用。
 *
 * 外壳本身不用 reactive 包裹：那会让每个 getter 都多一层代理，
 * 而这些 getter 返回的已经是响应式对象。
 * 只把「本文件新增的两个字段」做成 reactive，其余直接透传，
 * 依赖关系保持最浅。
 */
const storeInstance: Store = {
  appearance,
  docs,
  editor,
  ai,
  folders,
  library,
  wallpaper,
  get sidebarCollapsed(): boolean {
    return state.sidebarCollapsed
  },
  set sidebarCollapsed(value: boolean) {
    state.sidebarCollapsed = value
  },
  get isAiPanelOpen(): boolean {
    return ai.open
  },
}

export function useStore(): Store {
  return storeInstance
}

/**
 * 应用启动时调用一次。
 *
 * 必须在第一个组件挂载前完成：否则首帧会按默认主题渲染，
 * 用户看到「白闪一下再变暗色」。这在暗色主题下尤其明显。
 *
 * 排版变量也在这里写：编辑器首次挂载时读的就是这些变量，
 * 晚一步设置会让编辑区用默认字号渲染一帧再跳变，属CLS 来源。
 */
export function initStore(): void {
  appearance.init()
  folders.load()
  library.load()
  wallpaper.init()
  // 装配排版写入器：editor.setPref 改字号时要能写CSS 变量，
  // 但 editor.ts 不能 import appearance（会形成循环依赖），
  // 因此由这里这个「知道全部模块」的地方接上。
  setTypographyApplier((prefs) => appearance.applyEditorTypography(prefs))
  appearance.applyEditorTypography(editor.getPrefsSnapshot())
}

export { ai, appearance, docs, editor, library, loadHistory }
export type { DocumentMeta } from '@/core/interfaces'