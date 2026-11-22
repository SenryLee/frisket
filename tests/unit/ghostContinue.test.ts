import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { editorKeyBindings } from '../../src/editor/keys'
import {
  acceptGhostContinue,
  ghostContinueExtensions,
  ghostIn,
  ghostKeyAllowed,
  planGhostWrite,
  requestGhostContinue,
  setGhostBeforeWrite,
  withGhost,
} from '../../src/editor/ghostContinue'
import type { ToolbarAction } from '../../src/components/types'

function stateWith(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: ghostContinueExtensions(),
    selection: { anchor: doc.length },
  })
}

describe('灰色续写', () => {
  it('组字时不响应快捷键，也不请求', () => {
    expect(ghostKeyAllowed(true)).toBe(false)
    expect(requestGhostContinue({ composing: true } as EditorView)).toBe(false)
    expect(acceptGhostContinue({ composing: true } as EditorView)).toBe(false)
  })

  it('快捷键是 ⌥⌘J，Tab 先交给灰色字，⌘J 不在这层', () => {
    expect(editorKeyBindings.some((binding) => binding.key === 'Alt-Mod-j' && binding.run === requestGhostContinue)).toBe(true)
    expect(editorKeyBindings.some((binding) => binding.key === 'Mod-j')).toBe(false)
    const tabs = editorKeyBindings.filter((binding) => binding.key === 'Tab')
    expect(tabs[0]?.run).toBe(acceptGhostContinue)
    expect(tabs).toHaveLength(2)
  })

  it('灰色字不写进文档，打字或移动光标就消失', () => {
    const base = stateWith('已经写好。')
    const shown = withGhost(base, base.doc.length, '下一句')
    expect(shown.doc.toString()).toBe('已经写好。')
    expect(ghostIn(shown)).toBe('下一句')
    const at = shown.doc.length
    const typed = shown.update({
      changes: { from: at, to: at, insert: '啊' },
      selection: { anchor: at + 1 },
    }).state
    expect(ghostIn(typed)).toBeNull()
    expect(typed.doc.toString()).toBe('已经写好。啊')
    const moved = shown.update({ selection: { anchor: 0 } }).state
    expect(moved.doc.toString()).toBe('已经写好。')
    expect(ghostIn(moved)).toBeNull()
  })

  it('没有灰色字时 Tab 不拦截，快照失败就不写入', async () => {
    const plain = stateWith('正文')
    expect(acceptGhostContinue({ composing: false, state: plain } as EditorView)).toBe(false)

    const seen: string[] = []
    setGhostBeforeWrite(async (doc) => {
      seen.push(doc)
      return false
    })
    const blocked = await planGhostWrite({
      doc: '已经写好。',
      ghost: { at: 5, text: '下一句' },
      live: () => ({ doc: '已经写好。', head: 5, text: '下一句' }),
    })
    expect(blocked).toBeNull()
    expect(seen).toEqual(['已经写好。'])

    setGhostBeforeWrite(async (doc) => {
      seen.push(doc)
      return true
    })
    const planned = await planGhostWrite({
      doc: '已经写好。',
      ghost: { at: 5, text: '下一句' },
      live: () => ({ doc: '已经写好。', head: 5, text: '下一句' }),
    })
    expect(planned).toEqual({ at: 5, insert: '下一句' })
    setGhostBeforeWrite(null)
  })

  it('没有按快捷键时不会自己出现灰色字', () => {
    const state = stateWith('已经写好。')
    expect(ghostIn(state)).toBeNull()
    expect(requestGhostContinue({ composing: false, state } as EditorView)).toBe(true)
    expect(state.doc.toString()).toBe('已经写好。')
    expect(ghostIn(state)).toBeNull()
  })
})

describe('格式条不把写作动作塞进格式类型', () => {
  it('润色和纠错不是格式动作', () => {
    type WritingIds = Extract<ToolbarAction['id'], 'rewrite' | 'fixGrammar'>
    const writingIsAbsent: WritingIds extends never ? true : false = true
    expect(writingIsAbsent).toBe(true)
  })
})
