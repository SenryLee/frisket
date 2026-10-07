/**
 * 编辑器工厂 —— 实现 EditorHandle 的全部方法
 *
 * 在整体中的位置：整个内核对外的唯一门面。UI 层（工具栏、状态栏、
 * AI 面板）只认 EditorHandle，不接触 CodeMirror —— 这是换掉底层编辑内核的成本边界。
 *
 * 设计要点：
 * 1. 语言包异步加载，但 createEditor 必须同步返回（调用方要立刻拿view 挂载）。
 *    先建无语言的 State，语言到位后用 Compartment 原地换入。
 * 2. 所有写操作走同一个 dispatchChange()，统一挂 origin 注解。
 *    撤销分组与「AI 写回」识别全靠这个注解，漏挂一处会让用户 ⌘Z 撤不回 AI 改动。
 * 3. 切文档用 docCache 保住 State，见 docCache.ts 的说明。
 *
 * 为什么单文件不拆：这些方法互相之间没有独立演化的理由，
 * 它们是同一个契约（EditorHandle）的实现。拆开只会让读代码要跳七个文件。
 * 表格 / 链接的文本构造逻辑复杂，单独提到 markdown-insert.ts。
 */

import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import type { TransactionSpec } from '@codemirror/state'
import type { ChangeOrigin, EditorHandle, EditorPrefs, EditorStats, TextRange } from '@/core/interfaces'
import { baseExtensions, languageCompartment, prefsCompartment, prefExtensions } from './editor.config'
import { dropCachedState, getCachedState, setCachedState } from './docCache'
import { refreshEffect } from '@/editor/effects'
import { loadMarkdownSupport } from '@/editor/markdown.config'
import { collectStats } from '@/editor/live/field.stats'
import { DEFAULT_PREFS } from './prefs'
import { originAnnotation } from './origin'
import { buildLinkInsertion, buildTableInsertion } from './markdown-insert'
import type { EditorChangeCallbacks } from './editor.config'

export interface CreateEditorOptions extends EditorChangeCallbacks {
  readonly parent: HTMLElement
  /** 文档稳定标识，用于状态缓存。不传则不参与缓存。 */
  readonly docId?: string
  readonly initialDoc?: string
  readonly prefs?: EditorPrefs
}

export interface SlateEditor extends EditorHandle {
  readonly view: EditorView
  /** 重新应用设置。设置面板改动后调用，避免整页重建。 */
  applyPrefs(prefs: EditorPrefs): void
  /** 关闭编辑器并释放资源。 */
  destroy(): void
}

/**
 * 创建编辑器。
 *
 * 返回前就已挂载到 parent，可以立刻接受输入 ——
 * 语言包迟到不影响这一点，只是那几百毫秒内没有语法高亮。
 */
export function createEditor(options: CreateEditorOptions): SlateEditor {
  const prefs = options.prefs ?? DEFAULT_PREFS
  const docId = options.docId ?? ''
  const state = restoreOrCreateState(docId, options.initialDoc ?? '', prefs, options)
  const view = new EditorView({ parent: options.parent, state })

  void attachLanguage(view)

  return buildHandle(view, docId)
}

/**
 * 优先从缓存恢复，miss 时新建。
 *
 * 缓存里存的是完整 State（含撤销栈、选区、三层字段的值），
 * 重建这些代价高且会让用户「回到文档开头」，体验损失远大于内存开销。
 *
 * 命中缓存时**不重挂回调**：缓存的 State 里 updateListener 已固化，
 * 再挂一份会导致每次变化回调两次（自动保存写两次盘）。
 * 这是调用方切文档时必须新建实例、而非复用实例的原因。
 */
function restoreOrCreateState(
  docId: string,
  text: string,
  prefs: EditorPrefs,
  callbacks: EditorChangeCallbacks,
): EditorState {
  const cached = getCachedState(docId)
  if (cached !== undefined) return cached
  return EditorState.create({ doc: text, extensions: baseExtensions({ prefs, ...callbacks }) })
}

/**
 * 异步装入语言包。
 *
 * 用 Compartment 而不是新建 EditorView：重建会丢滚动位置与 DOM 焦点，
 * 用户会看到编辑器闪一下。失败时静默降级为纯文本 ——
 * 高亮缺失不影响编辑能力，抛错会让整个编辑器打不开。
 */
async function attachLanguage(view: EditorView): Promise<void> {
  const support = await loadMarkdownSupport()
  if (support === null) return
  // 视图可能已随文档关闭而销毁，此时 dispatch 会抛
  if (view.dom.isConnected === false) return
  view.dispatch({ effects: languageCompartment.reconfigure(support) })
}

/** 把变更收敛到一处，统一挂来源注解。 */
function dispatchChange(view: EditorView, spec: TransactionSpec, origin: ChangeOrigin): void {
  view.dispatch({ ...spec, annotations: originAnnotation.of(origin) })
}

function buildHandle(view: EditorView, docId: string): SlateEditor {
  return {
    view,
    focus: () => view.focus(),

    getDoc: () => view.state.doc.toString(),

    setDoc(text: string) {
      dispatchChange(
        view,
        { changes: { from: 0, to: view.state.doc.length, insert: text } },
        'ui',
      )
      setCachedState(docId, view.state)
    },

    getSelection: () => {
      const main = view.state.selection.main
      return { from: main.from, to: main.to }
    },

    setSelection(range: TextRange) {
      const max = view.state.doc.length
      const from = clamp(range.from, 0, max)
      const to = clamp(range.to, from, max)
      view.dispatch({ selection: { anchor: from, head: to } })
    },

    replaceRange(from: number, to: number, text: string, origin: ChangeOrigin = 'user') {
      const max = view.state.doc.length
      const start = clamp(from, 0, max)
      const end = clamp(to, start, max)
      dispatchChange(view, { changes: { from: start, to: end, insert: text } }, origin)
      setCachedState(docId, view.state)
    },

    insertAtCursor(text: string, cursorOffset?: number) {
      const { from, to } = view.state.selection.main
      const offset = cursorOffset ?? text.length
      dispatchChange(
        view,
        {
          changes: { from, to, insert: text },
          selection: { anchor: from + offset },
        },
        'ui',
      )
    },

    wrapSelection(before: string, after: string, placeholder = ''): void {
      const { from, to } = view.state.selection.main
      const selected = view.state.doc.sliceString(from, to)
      const inner = selected === '' ? placeholder : selected
      const insert = before + inner + after

      dispatchChange(
        view,
        {
          changes: { from, to, insert },
          selection:
            selected === ''
              ? { anchor: from + before.length + inner.length }
              : { anchor: from + before.length, head: from + before.length + inner.length },
        },
        'format',
      )
    },

    scrollToLine(line: number) {
      const target = clamp(Math.trunc(line), 0, view.state.doc.lines - 1)
      view.dispatch({
        effects: EditorView.scrollIntoView(view.state.doc.line(target + 1).from, { y: 'start' }),
      })
    },

    insertTable(rows: number, cols: number) {
      dispatchChange(view, buildTableInsertion(view.state, rows, cols), 'ui')
    },

    insertLink(text: string, url: string) {
      dispatchChange(view, buildLinkInsertion(view.state, text, url, false), 'ui')
    },

    insertImage(path: string, alt = '') {
      const label = alt === '' ? path : alt
      dispatchChange(view, buildLinkInsertion(view.state, label, path, true), 'ui')
    },

    refresh() {
      view.dispatch({ effects: refreshEffect.of(null) })
    },

    getStats(): EditorStats {
      return collectStats(view)
    },

    applyPrefs(next: EditorPrefs) {
      view.dispatch({ effects: prefsCompartment.reconfigure(prefExtensions(next)) })
    },

    destroy() {
      // 只释放视图，不缓存 State：销毁意味着调用方明确不要这份状态了
      // （例如文档被删除）。若要保留编辑进度，调用方应在销毁前
      // 自行调 setDoc 落盘，或不调 destroy 而保留实例。
      dropCachedState(docId)
      view.destroy()
    },
  }
}

function clamp(value: number, low: number, high: number): number {
  if (Number.isNaN(value)) return low
  return Math.min(Math.max(value, low), high)
}