/**
 * 格式快捷键。和工具栏走同一套 editFor，避免两套标记规则。
 */

import { keymap } from '@codemirror/view'
import type { Command, EditorView } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { editFor } from '@/core/format'
import type { FormatRequest } from '@/core/format'

function run(request: FormatRequest | ((view: EditorView) => FormatRequest)): Command {
  return (view) => {
    const selection = view.state.selection.main
    const spec = typeof request === 'function' ? request(view) : request
    const edit = editFor(view.state.doc.toString(), selection.from, selection.to, spec)
    if (edit === null) return false
    view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: { anchor: edit.anchor, head: edit.head },
    })
    return true
  }
}

const heading = (level: number): Command => run({ id: 'heading', level })

/** 压过默认键位，但低于 Markdown 语义键（回车退出空列表）。 */
export const formatKeymap: Extension = Prec.high(
  keymap.of([
    { key: 'Mod-b', run: run({ id: 'wrap', before: '**', after: '**' }) },
    { key: 'Mod-i', run: run({ id: 'wrap', before: '*', after: '*' }) },
    { key: 'Mod-e', run: run({ id: 'wrap', before: '`', after: '`' }) },
    { key: 'Mod-Shift-x', run: run({ id: 'wrap', before: '~~', after: '~~' }) },
    { key: 'Mod-Alt-1', run: heading(1) },
    { key: 'Mod-Alt-2', run: heading(2) },
    { key: 'Mod-Alt-3', run: heading(3) },
    { key: 'Mod-Alt-4', run: heading(4) },
    { key: 'Mod-Alt-5', run: heading(5) },
    { key: 'Mod-Alt-6', run: heading(6) },
    { key: 'Mod-Shift-8', run: run({ id: 'bullet' }) },
    { key: 'Mod-Shift-7', run: run({ id: 'ordered' }) },
    { key: 'Mod-Shift-9', run: run({ id: 'quote' }) },
  ]),
)
