/**
 * protocol.ts —— 视觉层与内核之间唯一的通信面（契约由生产方定义）
 *
 * 在整体中的位置：App.vue（视觉）、qa 的 E2E桥、门禁入口 gate.html
 * 都从这里 import。本文件是内核对外的第二个门面（第一个是 EditorHandle）。
 *
 * ── 为什么归内核所有 ──────────────────────────────────────────
 * 契约的**定义方**必须是实现方，否则就是「内核依赖自己尚未实现的文件」。
 * 早期版本放在 src/store/，视觉层编译成本为零，但内核与 qa 要 import
 * 一个不属于自己的文件 —— 集成前无法 typecheck，代价不对等。
 * 现在内核自包含，视觉层与 qa 单向依赖内核，依赖方向正确。
 *
 * ── 为什么用 window CustomEvent 而不是 Compartment / provide / 事件总线 ──
 * provide/inject 要求 provide 侧是 Vue 组件树的一部分，而内核是纯 TS 模块，
 * 会形成「内核依赖 Vue 运行时」的倒挂。第三方事件总线则让两个本可单向
 * 依赖的模块互相引入总线依赖，测试时难以隔离。
 * window 事件是浏览器原生能力，零依赖，且 Playwright 可直接驱动。
 *
 * ── 顺序契约（违反会静默丢事件）────────────────────────────────
 * 1. 视觉层必须先 addEventListener 全部事件
 * 2. 之后才 dispatchEvent(hostReady,挂载点元素)
 * 3. 内核收到 hostReady → 创建 CM → dispatchEvent(ready, detail)
 *
 * 若顺序反了，视觉层还没挂上监听器就收到 ready，EditorHandle 丢失且**不报错**。
 * 这是本协议唯一的时序陷阱，改动时务必保持。
 */

import type { EditorHandle, EditorStats, TextRange } from './interfaces'

/**
 * 事件名与 detail 形状的唯一映射。
 *
 * 用一个 interface 同时约束「名字」和「载荷」，比分开维护
 * `const SLATE_EVENT` + 一堆 `as` 强转更安全：
 * 新增事件时漏写载荷类型，emitSlateEvent 会在调用点立刻报错。
 */
export interface SlateEventMap {
  /** 视觉层 → 内核：编辑区挂载点就绪。detail = HTMLElement */
  'slate:editor-host-ready': HTMLElement
  /** 内核 → 视觉层：编辑器就绪。detail = EditorReadyDetail */
  'slate:editor-ready': EditorReadyDetail
  /** 内核 → 视觉层：统计变化。detail = EditorStats */
  'slate:editor-stats': EditorStats
  /** 内核 → 视觉层：选区变化。detail = TextRange */
  'slate:editor-selection': TextRange
  /** 内核 → 视觉层：焦点变化。detail = boolean */
  'slate:editor-focus': boolean
  /** 内核 → 视觉层：内容脏标记。detail = boolean */
  'slate:editor-dirty': boolean
}

export type SlateEventName = keyof SlateEventMap

/**
 * 事件名常量。
 *
 * 与 SlateEventMap 配对使用：`SLATE_EVENT.ready` 的类型就是 'slate:editor-ready'，
 * 因此拼错字符串在编译期就会报错，不必等到运行时才发现事件没被收到。
 * 不建议直接写字面量 —— 散落两端的字符串等于隐式约定。
 */
export const SLATE_EVENT = {
  hostReady: 'slate:editor-host-ready',
  ready: 'slate:editor-ready',
  stats: 'slate:editor-stats',
  selection: 'slate:editor-selection',
  focus: 'slate:editor-focus',
  dirty: 'slate:editor-dirty',
} as const satisfies Record<string, SlateEventName>

/**
 * 仅开发环境暴露的控制对象。
 *
 * 为什么需要：门禁测试要能精确设置文档、选区、焦点，并读取 IME 组合状态。
 * 若让内核为测试写专用分支，测试代码会侵入生产路径；
 * 若让 qa 直接 dispatch 内部事务，内核重构时测试会一起报废。
 *
 * 走已有的事件通路 + dev 构建挂载，是成本最低的一种做法：
 * 生产构建用 import.meta.env.DEV 静态剔除，tree-shaking 后不留痕迹。
 */
export interface EditorDevControls {
  /** 替换整个文档内容 */
  setDoc(text: string): void
  /** 读取当前全文 */
  getDoc(): string
  /** 设置选区。from === to 表示纯光标 */
  setSelection(from: number, to?: number): void
  /** 移动光标到指定字符偏移 */
  setCursor(offset: number): void
  focus(): void
  /** 当前是否处于 IME 组合输入中。IME 门禁的核心断言依据 */
  isComposing(): boolean
  /** 切换主题，供「组合输入期间切主题」场景使用 */
  toggleTheme?(themeId?: string): void
  /** 切换 AI 面板，供「组合输入期间点击面板」场景使用 */
  toggleAiPanel?(): void
}

/**
 * `slate:editor-ready` 事件的载荷。
 *
 * devControls 只在 dev 构建存在，消费方必须容错
 * （`detail.devControls ?? null`），不能假设一定有。
 */
export interface EditorReadyDetail {
  handle: EditorHandle
  devControls?: EditorDevControls
}

/**
 * 派发一个 Slate 事件。内核侧用，避免到处手写 CustomEvent 构造。
 *
 * detail 类型由事件名推导：`emitSlateEvent(SLATE_EVENT.stats, stats)`
 * 若 stats 少一个字段，在此就地报错。
 */
export function emitSlateEvent<K extends SlateEventName>(
  name: K,
  detail: SlateEventMap[K],
): void {
  window.dispatchEvent(new CustomEvent<SlateEventMap[K]>(name, { detail }))
}

/**
 * 订阅一个 Slate 事件，返回取消订阅函数。视觉层用。
 *
 * handler 的参数类型由事件名推导，订阅侧不需要写类型断言。
 */
export function onSlateEvent<K extends SlateEventName>(
  name: K,
  handler: (detail: SlateEventMap[K]) => void,
): () => void {
  const listener = (event: Event): void => {
    handler((event as CustomEvent<SlateEventMap[K]>).detail)
  }
  window.addEventListener(name, listener)
  return () => window.removeEventListener(name, listener)
}
