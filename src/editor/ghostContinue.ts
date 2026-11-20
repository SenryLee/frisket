/**
 * 光标后的灰色续写。
 * 只有 ⌥⌘J 会请求一次。灰色字是装饰，不进文档。
 * Tab 在灰色字可见时才接管，并先等采纳前快照。
 */

import { EditorState, StateEffect, StateField } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import type { Command } from '@codemirror/view'
import { captureContinuation, prepareContinuation } from '@/core/aiGuard'
import { CMD, EVENT } from '@/ipc/commands'
import { originAnnotation } from '@/core/origin'
import { isTauriRuntime } from '@/store/appearance'

interface Ghost {
  at: number
  text: string
}

const setGhost = StateEffect.define<Ghost | null>()

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }

  override eq(other: WidgetType): boolean {
    return other instanceof GhostWidget && other.text === this.text
  }

  override ignoreEvent(): boolean {
    return true
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-ghost-continue'
    span.textContent = this.text
    return span
  }
}

const ghostField = StateField.define<Ghost | null>({
  create: () => null,
  update(value, transaction) {
    let next = value
    for (const effect of transaction.effects) {
      if (effect.is(setGhost)) next = effect.value
    }
    if (next === null) return null
    if (transaction.docChanged) return null
    if (transaction.newSelection.main.head !== next.at) return null
    return next
  },
  provide(field) {
    return EditorView.decorations.from(field, (ghost): DecorationSet => {
      if (ghost === null) return Decoration.none
      const at = Math.min(ghost.at, Number.MAX_SAFE_INTEGER)
      return Decoration.set([
        Decoration.widget({ widget: new GhostWidget(ghost.text), side: 1 }).range(at),
      ])
    })
  },
})

export function ghostContinueExtensions(): Extension[] {
  return [ghostField]
}

function readGhost(view: EditorView): Ghost | null {
  return view.state.field(ghostField, false) ?? null
}

export function ghostText(view: EditorView): string | null {
  return readGhost(view)?.text ?? null
}

/** 组字时不处理。快捷键层用这个判断，避免打断输入法。 */
export function ghostKeyAllowed(composing: boolean): boolean {
  return !composing
}

export function showGhost(view: EditorView, at: number, text: string): void {
  view.dispatch({ effects: setGhost.of({ at, text }) })
}

export function withGhost(state: EditorState, at: number, text: string): EditorState {
  return state.update({ effects: setGhost.of({ at, text }) }).state
}

export function ghostIn(state: EditorState): string | null {
  return state.field(ghostField, false)?.text ?? null
}

let beforeWrite: ((doc: string, insert: string) => Promise<boolean>) | null = null
let flight = 0

export function setGhostBeforeWrite(hook: ((doc: string, insert: string) => Promise<boolean>) | null): void {
  beforeWrite = hook
}

export const requestGhostContinue: Command = (view) => {
  if (!ghostKeyAllowed(view.composing)) return false
  const ticket = ++flight
  void loadGhost(view, ticket)
  return true
}

export const dismissGhostContinue: Command = (view) => {
  if (!ghostKeyAllowed(view.composing)) return false
  if (readGhost(view) === null) return false
  flight += 1
  view.dispatch({ effects: setGhost.of(null) })
  return true
}

export const acceptGhostContinue: Command = (view) => {
  if (!ghostKeyAllowed(view.composing)) return false
  const ghost = readGhost(view)
  if (ghost === null) return false
  const ticket = ++flight
  void commitGhost(view, ghost, ticket)
  return true
}

async function loadGhost(view: EditorView, ticket: number): Promise<void> {
  if (!isTauriRuntime()) return
  const at = view.state.selection.main.head
  const doc = view.state.doc.toString()
  const snapshot = captureContinuation(doc, at)
  if (snapshot === null) return
  const requestId = crypto.randomUUID()
  const pieces: string[] = []
  const { listen } = await import('@tauri-apps/api/event')
  const { invoke } = await import('@tauri-apps/api/core')
  const unDelta = await listen<{ requestId: string; text: string }>(EVENT.aiDelta, (event) => {
    if (event.payload.requestId !== requestId) return
    pieces.push(event.payload.text)
  })
  try {
    await invoke(CMD.aiChat, {
      requestId,
      messages: [],
      rewrite: {
        action: 'continue',
        target: snapshot.prefix,
        context: '',
        instruction: '',
      },
    })
  } catch {
    return
  } finally {
    unDelta()
  }
  if (ticket !== flight) return
  const checked = prepareContinuation(snapshot, pieces.join(''), view.state.doc.toString())
  if (!checked.ok) return
  if (view.state.selection.main.head !== at) return
  showGhost(view, at, checked.text)
}

export async function planGhostWrite(input: {
  doc: string
  ghost: Ghost
  live: () => { doc: string; head: number; text: string | null }
}): Promise<{ at: number; insert: string } | null> {
  const saved = (await beforeWrite?.(input.doc, input.ghost.text)) ?? true
  if (!saved) return null
  const live = input.live()
  if (live.text !== input.ghost.text) return null
  if (live.head !== input.ghost.at) return null
  if (live.doc !== input.doc) return null
  return { at: input.ghost.at, insert: input.ghost.text }
}

async function commitGhost(view: EditorView, ghost: Ghost, ticket: number): Promise<void> {
  const doc = view.state.doc.toString()
  const planned = await planGhostWrite({
    doc,
    ghost,
    live: () => ({
      doc: view.state.doc.toString(),
      head: view.state.selection.main.head,
      text: readGhost(view)?.text ?? null,
    }),
  })
  if (planned === null || ticket !== flight) return
  view.dispatch({
    changes: { from: planned.at, to: planned.at, insert: planned.insert },
    selection: { anchor: planned.at + planned.insert.length },
    annotations: originAnnotation.of('ai'),
    effects: setGhost.of(null),
  })
}
