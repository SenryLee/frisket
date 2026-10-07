/**
 * devBridge.ts —— 门禁测试桥（window.__slate）的装配
 *
 * 在整体中的位置：只在 dev 构建生效。App.vue 在收到内核的
 * slate:editor-ready 事件后调用 installDevBridge()，把一个满足
 * src/test-utils/bridge.ts 里 SlateTestBridge 形状的对象挂到 window。
 *
 * ── 为什么内核不提供 toggleTheme / toggleAiPanel，而这里提供 ──────
 * 内核只有 CM 的 EditorView，拿不到主题与面板状态。若让内核接收
 * 视觉层回调再转发，就形成「内核依赖视觉层」，依赖方向反转。
 * 因此这两个方法由本模块实现：它 import 视觉层自己的 store，
 * 方向是「视觉层 → 内核能力」，不产生反向依赖。
 *
 * ── 为什么生产构建完全不含这段代码 ──────────────────────────────
 * 整份实现被 import.meta.env.DEV 静态剔除：Vite 在构建时把该常量
 * 折叠成 false，tree-shaking 随即丢掉整个函数体与它引用的 store，
 * 生产包里不会有任何测试通道。
 *
 * 文件所有权：src/store/** 属于 ui-shell（视觉）。
 */

import type { DocumentMeta } from '@/core/interfaces'
import type { EditorDevControls, EditorReadyDetail } from '@/core/protocol'
import { appearance } from './appearance'
import { ai } from './ai'
import { docs } from './docs'

/**
 * window.__slate 的最终形状。
 *
 * 与 src/test-utils/bridge.ts 的 SlateTestBridge 对应，但**方法全部同步**：
 * 那份接口是跨 Playwright 进程的远程代理，所以是 Promise；
 * 页面内这一层是同步的，跨进程那层负责 await。
 */
export interface DevBridge {
  ready(): boolean
  setDoc(text: string): void
  getDoc(): string
  setSelection(from: number, to?: number): void
  setCursor(offset: number): void
  focus(): void
  isComposing(): boolean
  toggleTheme(themeId?: string): void
  toggleAiPanel(): void
  /** 只在 dev 里给侧栏塞历史，方便看移除交互。生产构建不会挂上。 */
  seedHistory(items: DocumentMeta[]): void
}

/** 全局名的类型声明。挂在 window 上必须有声明，否则 TS 报错 */
declare global {
  interface Window {
    __slate?: DevBridge
  }
}

/**
 * 内核是否已就绪。
 *
 * 单独一个布尔量而不是「看 devControls 有没有」：
 * 内核可能已创建好视图但没提供 devControls（生产构建就是如此），
 * 那时 ready() 仍应如实返回 true。
 */
let editorReady = false

/** 保存内核给的原始控制对象。其方法在 setDoc 时会触发事务与重排 */
let coreControls: EditorDevControls | null = null

/**
 * 装配 window.__slate。
 *
 * 在收到 ready 事件时调用。不做重复挂载检查 —— 每次 ready 都覆盖，
 * 因为切文档时内核可能重建 EditorHandle，旧引用会指向已销毁的视图。
 */
export function installDevBridge(detail: EditorReadyDetail): void {
  coreControls = detail.devControls ?? null
  editorReady = true

  const bridge: DevBridge = {
    ready: () => editorReady,

    // 内核没给 devControls 时这几个方法无处可去。
    // 抛错而不是静默返回空串：门禁会因此明确失败，
    // 而静默返回会让「读取到空文档」看起来像真实的丢字 bug。
    setDoc: (text) => {
      requireControls().setDoc(text)
    },
    getDoc: () => requireControls().getDoc(),
    setSelection: (from, to) => {
      requireControls().setSelection(from, to)
    },
    setCursor: (offset) => {
      requireControls().setCursor(offset)
    },
    focus: () => {
      requireControls().focus()
    },
    isComposing: () => requireControls().isComposing(),

    // ── 以下两个由视觉层实现，是内核不便关心的部分 ──
    // 不传 themeId 就循环到下一个主题，与标题栏一键切换行为一致。
    toggleTheme: (themeId) => {
      if (themeId === undefined || themeId === '') {
        appearance.cycleTheme()
        return
      }
      appearance.setTheme(themeId)
    },
    toggleAiPanel: () => {
      ai.toggle()
    },
    seedHistory: (items) => {
      for (const item of items) docs.upsert(item)
    },
  }

  window.__slate = bridge
}

function requireControls(): EditorDevControls {
  if (coreControls === null) {
    throw new Error(
      'window.__slate 已挂载，但内核未提供 devControls。\n' +
        '门禁需要 setDoc / getDoc / setSelection / focus / isComposing，' +
        '请确认 dev 构建已开启，且 core/protocol.ts 的 ready 事件携带了 devControls。',
    )
  }
  return coreControls
}

/**
 * 拆除测试桥。
 *
 * 组件卸载时调用。不删干净的话，热更新后残留的旧桥会指向已销毁的
 * EditorView，门禁会读到错乱的数据且极难定位。
 */
export function removeDevBridge(): void {
  delete window.__slate
  coreControls = null
  editorReady = false
}
