/**
 * 编辑器装配 —— 建视图、接事件、挂门禁通道
 *
 * 在整体中的位置：视觉层（App.vue / gate.html）与 core/editor.ts 之间。
 * core/editor.ts 只管「造一个可用的编辑器」，本文件管「造完之后怎么让别人知道」。
 *
 * 为什么要这层间接：core/editor.ts 是纯 TS 模块，不该知道 window 事件的存在。
 * 把事件知识集中在这里，内核其他部分就完全不需要 import protocol.ts，
 * 依赖方向保持单向（视觉层 → 内核）。
 *
 * ── 时序契约（详见 protocol.ts 文件头）──────────────────────────
 * 消费方必须先 addEventListener 全部事件，再派发 hostReady。
 * 本文件内部严格遵守：收到 hostReady → 建视图 → 立刻发 ready → 再发初始快照。
 */

import type { SlateEditor } from './editor'
import { createEditor } from './editor'
import type { CreateEditorOptions } from './editor'
import { SLATE_EVENT, emitSlateEvent } from './protocol'
import type { EditorDevControls, EditorReadyDetail } from './protocol'
import { scheduleRebuildAfterComposition } from '@/editor/live/ime'
import { collectStats } from '@/editor/live/field.stats'

/** 已挂载的编辑器。dispose 用于热重载与组件卸载。 */
export interface MountedEditor {
  readonly editor: SlateEditor
  dispose(): void
}

/** 挂载选项。挂载点由 hostReady 事件提供，不要求调用方事先传入。 */
export type MountOptions = Omit<CreateEditorOptions, 'parent'>

/**
 * 挂载编辑器并接通事件广播。
 *
 * 幂等保护在listenForHost 里（重复 hostReady 直接忽略）；
 * 直接调 mountEditor 则是「每次调用新建一个」，符合直觉。
 */
let markClean: (() => void) | null = null

/** 保存成功后清掉脏标记。下一次按键会重新标成未保存。 */
export function markEditorClean(): void {
  markClean?.()
}

export function mountEditor(options: MountOptions & { parent: HTMLElement }): MountedEditor {
  let dirty = false
  const markThisClean = (): void => {
    if (!dirty) return
    dirty = false
    emitSlateEvent(SLATE_EVENT.dirty, false)
  }
  markClean = markThisClean

  // 统计与选区在「值确实变了」时才广播：它们是高频信号，
  // 每次事务都发会让状态栏做无意义重渲染。去重键放在闭包里。
  let lastStats = ''
  let lastSelection = ''

  const editor = createEditor({
    ...options,
    onChange: (text, origin) => {
      options.onChange?.(text, origin)
      // 打开或新建文档会整篇替换。那不是用户改动，不能把文档标成未保存。
      if (origin === 'load') {
        dirty = false
        emitSlateEvent(SLATE_EVENT.dirty, false)
        return
      }
      // 每次改动都报一次。自动保存靠这个重置等待，不能只在第一次变脏时响。
      dirty = true
      emitSlateEvent(SLATE_EVENT.dirty, true)
    },
    onStats: (stats) => {
      const key = JSON.stringify(stats)
      if (key === lastStats) return
      lastStats = key
      emitSlateEvent(SLATE_EVENT.stats, stats)
    },
    onSelection: (range) => {
      const key = `${range.from}:${range.to}`
      if (key === lastSelection) return
      lastSelection = key
      emitSlateEvent(SLATE_EVENT.selection, range)
    },
    onFocus: (focused) => emitSlateEvent(SLATE_EVENT.focus, focused),
  })

  const cancelComposition = attachCompositionEnd(editor)

  // 初始快照：消费方订阅 ready 后需要立刻拿到当前统计与选区，
  // 否则状态栏要等到用户第一次按键才有内容
  const initialStats = collectStats(editor.view)
  lastStats = JSON.stringify(initialStats)
  emitSlateEvent(SLATE_EVENT.stats, initialStats)

  const initialSelection = editor.getSelection()
  lastSelection = `${initialSelection.from}:${initialSelection.to}`
  emitSlateEvent(SLATE_EVENT.selection, initialSelection)
  emitSlateEvent(SLATE_EVENT.focus, editor.view.hasFocus)

  return {
    editor,
    dispose: () => {
      if (markClean === markThisClean) markClean = null
      cancelComposition()
      editor.destroy()
    },
  }
}

/**
 * IME 措施 C 的挂载点：组合结束后在下一帧重算装饰集。
 *
 * 监听 DOM 的 compositionend 而不是用 CodeMirror 的视图状态：
 * view.composing 在部分平台的组合刚结束时就会翻 false，
 * 但 DOM 此时可能还没提交 —— 那时重算会拿到过期状态。
 */
function attachCompositionEnd(editor: SlateEditor): () => void {
  const dom = editor.view.contentDOM
  const onEnd = (): void => {
    scheduleRebuildAfterComposition(editor.view)
  }
  dom.addEventListener('compositionend', onEnd)
  return () => dom.removeEventListener('compositionend', onEnd)
}

/**
 * 监听 hostReady 并在收到后挂载编辑器 —— 消费方的一站式入口。
 *
 * 只需 import 后调用一次，剩余装配顺序由本函数按协议保证。
 * 重复的 hostReady 会被忽略（幂等），避免热重载时叠加多个编辑器。
 *
 * 返回取消函数。组件重挂载时必须调用，否则监听器与视图都会累积，
 * 表现为「编辑器出现多个」且内存持续增长。
 */
export function listenForHost(options: MountOptions): () => void {
  let mounted: MountedEditor | null = null

  const listener = (event: Event): void => {
    if (mounted !== null) return
    const host = (event as CustomEvent<HTMLElement>).detail
    mounted = mountEditor({ ...options, parent: host })

    // dev 构建才带 devControls。消费方必须容错它的缺失，
    // 所以用可选字段而不是「dev 下一定有」的断言。
    const detail: EditorReadyDetail = { handle: mounted.editor }
    if (import.meta.env.DEV) {
      detail.devControls = createDevControls(mounted.editor)
    }
    emitSlateEvent(SLATE_EVENT.ready, detail)
  }

  window.addEventListener(SLATE_EVENT.hostReady, listener)
  return () => {
    window.removeEventListener(SLATE_EVENT.hostReady, listener)
    mounted?.dispose()
    mounted = null
  }
}

/**
 * 构造 dev 构建的控制对象（qa 的 E2E 桥依赖它）。
 *
 * isComposing 反映 view.composing 的真实值，而不是自己维护标志位 ——
 * 后者会在程序化设值时与实际状态脱节，门禁拿到的是假数据。
 *
 * toggleTheme / toggleAiPanel 故意不实现：它们属于视觉层职责，
 * 内核实现会破坏依赖方向。它们是可选方法，消费方需容错缺失。
 */
export function createDevControls(editor: SlateEditor): EditorDevControls {
  return {
    setDoc: (text: string) => editor.setDoc(text),
    getDoc: () => editor.getDoc(),
    setSelection: (from: number, to?: number) => editor.setSelection({ from, to: to ?? from }),
    setCursor: (offset: number) => editor.setSelection({ from: offset, to: offset }),
    focus: () => editor.focus(),
    isComposing: () => editor.view.composing,
  }
}

/**
 * 挂载并把 handle 挂到 window.__slate —— 仅门禁入口用。
 *
 * 生产应用不该走这条：视觉层用 listenForHost 走协议，
 * 只有 gate.html 这种「只挂内核不挂 UI」的页面才需要全局桥。
 * devControls 随 devControls 一并挂出，qa 通过它精确驱动编辑器。
 */
export function mountForGate(options: MountOptions & { parent: HTMLElement }): MountedEditor {
  const mounted = mountEditor(options)
  if (import.meta.env.DEV) {
    const scope = window as unknown as { __slate?: unknown }
    scope.__slate = { ready: () => true, ...createDevControls(mounted.editor) }
  }
  return mounted
}
