import { describe, expect, it } from 'vitest'
import { applyPainter, captureStyle, chipForeground, editFor, inkAt } from '../../src/core/format'

describe('格式命令', () => {
  it('无选区时把加粗光标放进标记中间', () => {
    const edit = editFor('你好', 2, 2, { id: 'wrap', before: '**', after: '**' })
    expect(edit).toEqual({ from: 2, to: 2, insert: '****', anchor: 4, head: 4 })
  })

  it('再次加粗会取消已有标记', () => {
    const edit = editFor('**重点**', 2, 4, { id: 'wrap', before: '**', after: '**' })
    expect(edit?.insert).toBe('重点')
  })

  it('同一级标题再点一次会取消', () => {
    const edit = editFor('## 标题', 0, 0, { id: 'heading', level: 2 })
    expect(edit?.insert).toBe('标题')
  })

  it('空行标题留下一个空格，方便接着打字', () => {
    const edit = editFor('', 0, 0, { id: 'heading', level: 1 })
    expect(edit?.insert).toBe('# ')
  })

  it('引用可以整段加上再整段去掉', () => {
    const added = editFor('甲\n乙', 0, 3, { id: 'quote' })
    expect(added?.insert).toBe('> 甲\n> 乙')
    const removed = editFor('> 甲\n> 乙', 0, 6, { id: 'quote' })
    expect(removed?.insert).toBe('甲\n乙')
  })

  it('有序列表按行编号', () => {
    const edit = editFor('甲\n乙', 0, 3, { id: 'ordered' })
    expect(edit?.insert).toBe('1. 甲\n2. 乙')
  })

  it('分割线插在当前行之后，光标留在原位', () => {
    const edit = editFor('正文', 1, 1, { id: 'hr' })
    expect(edit).toMatchObject({ from: 2, to: 2, insert: '\n---', anchor: 1, head: 1 })
  })

  it('文字颜色包一层 span，再点同色则去掉', () => {
    const wrapped = editFor('字', 0, 1, { id: 'color', kind: 'text', color: '#c0392b' })
    expect(wrapped?.insert).toBe('<span style="color:#c0392b">字</span>')
    const unwrapped = editFor(wrapped?.insert ?? '', 0, wrapped?.insert.length ?? 0, {
      id: 'color',
      kind: 'text',
      color: '#c0392b',
    })
    expect(unwrapped?.insert).toBe('字')
  })

  it('光标还在上色文字里面时，再点同色会去掉，点别的颜色会换色', () => {
    const doc = '<span style="color:#c0392b">字</span>'
    const open = '<span style="color:#c0392b">'.length
    const removed = editFor(doc, open, open + 1, { id: 'color', kind: 'text', color: '#c0392b' })
    expect(removed?.insert).toBe('字')
    const changed = editFor(doc, open, open + 1, { id: 'color', kind: 'text', color: '#2f6feb' })
    expect(changed?.insert).toBe('<span style="color:#2f6feb">字</span>')
  })

  it('跨行上色时每一行各自包一层，换行留在标签外面', () => {
    const edit = editFor('第一行\n第二行', 0, '第一行\n第二行'.length, {
      id: 'color',
      kind: 'text',
      color: '#c0392b',
    })
    expect(edit?.insert).toBe(
      '<span style="color:#c0392b">第一行</span>\n<span style="color:#c0392b">第二行</span>',
    )
  })

  it('背景色同样按行包，不把两行收进一个 mark', () => {
    const edit = editFor('甲\n乙', 0, 3, { id: 'color', kind: 'background', color: '#f3e2a2' })
    expect(edit?.insert).toBe(
      '<mark style="background-color:#f3e2a2">甲</mark>\n<mark style="background-color:#f3e2a2">乙</mark>',
    )
  })

  it('非法颜色不会改文档', () => {
    expect(editFor('字', 0, 1, { id: 'color', kind: 'text', color: 'red' })).toBeNull()
  })

  it('格式刷把加粗套到另一段上', () => {
    const style = captureStyle('**重点**', 0, 6)
    const edit = applyPainter('下一段', 0, 3, style)
    expect(edit?.insert).toBe('**下一段**')
  })

  it('格式刷能抄到选区外面的加粗和字色', () => {
    const source = '**<span style="color:#c0392b">重点</span>**'
    const inner = source.indexOf('重')
    const style = captureStyle(source, inner, inner + 2)
    expect(style.wraps).toEqual([{ before: '**', after: '**' }])
    expect(style.color).toBe('#c0392b')
    const edit = applyPainter('下一段', 0, 3, style)
    expect(edit?.insert).toBe('**<span style="color:#c0392b">下一段</span>**')
  })

  it('格式刷抄高亮色，不把同一层标记记两次', () => {
    const source = '<mark style="background-color:#f3e2a2">甲</mark>'
    const inner = source.indexOf('甲')
    const style = captureStyle(source, inner, inner + 1)
    expect(style.background).toBe('#f3e2a2')
    expect(style.wraps).toEqual([])
    const whole = captureStyle('**重点**', 0, 6)
    expect(whole.wraps).toEqual([{ before: '**', after: '**' }])
  })

  it('高亮加在已有字色上时合成一个标签', () => {
    const colored = '<span style="color:#c0392b">字</span>'
    const open = '<span style="color:#c0392b">'.length
    const edit = editFor(colored, open, open + 1, { id: 'color', kind: 'background', color: '#f3e2a2' })
    expect(edit?.insert).toBe('<span style="color:#c0392b;background-color:#f3e2a2">字</span>')
    const both = edit?.insert ?? ''
    const again = editFor(both, both.indexOf('字'), both.indexOf('字') + 1, {
      id: 'color',
      kind: 'background',
      color: '#f3e2a2',
    })
    expect(again?.insert).toBe('<span style="color:#c0392b">字</span>')
  })

  it('光标落在颜色里时能读出字色和高亮', () => {
    const both = '<span style="color:#c0392b;background-color:#d6e6ff">字</span>'
    const at = both.indexOf('字')
    expect(inkAt(both, at, at)).toEqual({ color: '#c0392b', background: '#d6e6ff' })
    expect(inkAt(both, at, at + 1)).toEqual({ color: '#c0392b', background: '#d6e6ff' })
    expect(inkAt(both, at + 1, at + 1).color).toBe('#c0392b')
    expect(inkAt(both, both.length, both.length)).toEqual({ color: null, background: null })
    expect(inkAt('普通文字', 0, 2)).toEqual({ color: null, background: null })
    const mark = '<mark style="background-color:#f3e2a2">甲</mark>'
    expect(inkAt(mark, mark.indexOf('甲'), mark.indexOf('甲'))).toEqual({
      color: null,
      background: '#f3e2a2',
    })
  })

  it('选区跨两种字色时按钮不假装只有一种', () => {
    const doc = '<span style="color:#c0392b">甲</span><span style="color:#2f6feb">乙</span>'
    expect(inkAt(doc, doc.indexOf('甲'), doc.indexOf('乙') + 1)).toEqual({
      color: null,
      background: null,
    })
  })

  it('折叠光标的格式刷仍然不抄颜色', () => {
    const doc = '<span style="color:#2f6feb">字</span>'
    const at = doc.indexOf('字')
    expect(captureStyle(doc, at, at).color).toBeNull()
    expect(inkAt(doc, at, at).color).toBe('#2f6feb')
  })

  it('深色高亮用浅色字', () => {
    expect(chipForeground('#f3e2a2')).toBe('#1a1a1a')
    expect(chipForeground('#1a1a1a')).toBe('#f7f4ee')
    expect(chipForeground('#ffffff')).toBe('#1a1a1a')
    expect(chipForeground('red')).toBe('#1a1a1a')
  })
})
