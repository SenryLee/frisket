import { describe, expect, it } from 'vitest'
import { computeRevealed } from '../src/editor/live/reveal'
import { isResolvableLink, shouldHideRange } from '../src/editor/live/text-syntax'
import { describeRender } from '../src/editor/live/field.inline'

interface Range { from: number; to: number; depth: number }
const NESTED_DOC = '**粗*斜*体**'
const OUTER: Range = { from: 0, to: 9, depth: 0 }
const INNER: Range = { from: 3, to: 6, depth: 1 }

describe('reveal', () => {
  it('段落外全折叠', () => {
    expect(computeRevealed(NESTED_DOC, 0, [OUTER, INNER]).size).toBe(0)
    expect(computeRevealed(NESTED_DOC, NESTED_DOC.length, [OUTER, INNER]).size).toBe(0)
  })
  it('光标在粗体内部展开粗体', () => {
    expect(computeRevealed(NESTED_DOC, 2, [OUTER, INNER]).has(0)).toBe(true)
  })
  it('紧贴起始星号不展开', () => {
    expect(computeRevealed(NESTED_DOC, 0, [OUTER, INNER]).has(0)).toBe(false)
  })
  it('嵌套时祖先一起展开', () => {
    const r = computeRevealed(NESTED_DOC, 4, [OUTER, INNER])
    expect(r.has(1)).toBe(true); expect(r.has(0)).toBe(true)
  })
  it('在粗体不在斜体时只展开粗体', () => {
    const r = computeRevealed(NESTED_DOC, 2, [OUTER, INNER])
    expect(r.has(0)).toBe(true); expect(r.has(1)).toBe(false)
  })
  it('三层嵌套祖先链完整', () => {
    const l1: Range = { from: 0, to: 7, depth: 0 }
    const l2: Range = { from: 0, to: 7, depth: 1 }
    const l3: Range = { from: 3, to: 4, depth: 2 }
    const r = computeRevealed('***深***', 3, [l1, l2, l3])
    expect(r.has(2)).toBe(true); expect(r.has(1)).toBe(true); expect(r.has(0)).toBe(true)
  })
  it('边界不抖动（最多 2 次变化）', () => {
    const transitions: string[] = []; let prev = ''
    for (let c = 0; c <= NESTED_DOC.length; c += 1) {
      const sig = [...computeRevealed(NESTED_DOC, c, [OUTER, INNER])].sort().join(',')
      if (sig !== prev) { transitions.push(`${c}:[${sig}]`); prev = sig }
    }
    console.log('  切换轨迹:', transitions.join(' → '))
    expect(transitions.length, `切换过于频繁：${transitions.join(' → ')}`).toBeLessThanOrEqual(2)
  })
  it('空范围列表不报错', () => {
    expect(computeRevealed('abc', 1, []).size).toBe(0)
  })
})

const resolvable = (d: string, f: number, t: number) => isResolvableLink(d, f, t)
describe('链接误渲染防御', () => {
  it('短引用无定义', () => {
    expect(resolvable('[foo]', 1, 4)).toBe(false)
    expect(resolvable('[bar]', 1, 4)).toBe(false)
    expect(resolvable('[foo]\n\n[foo]: /url\n', 1, 4)).toBe(true)
  })
  it('空 URL 括号', () => {
    expect(resolvable('[文字]()', 1, 3)).toBe(false)
    expect(resolvable('[a]()', 1, 2)).toBe(false)
  })
  it('普通文本方括号', () => {
    expect(resolvable('数组索引 a[0] 的用法', 6, 7)).toBe(false)
    expect(resolvable('这是 [ 单独方括号', 4, 5)).toBe(false)
    expect(resolvable('空括号对 []', 5, 5)).toBe(false)
    expect(resolvable('[文字][未定义]', 1, 3)).toBe(false)
  })
  it('行内代码内不生效', () => {
    expect(resolvable('`[a](b)`', 2, 3)).toBe(false)
    expect(resolvable('`[]`', 1, 1)).toBe(false)
  })
  it('围栏代码内不生效', () => {
    const doc = '```\n[a](b)\n```\n'
    const f = doc.indexOf('[a]') + 1
    expect(resolvable(doc, f, f + 1)).toBe(false)
  })
})

const hidden = (d: string, f: number, t: number) => shouldHideRange(d, f, t)
describe('空标记渐进披露', () => {
  it('空标题不隐藏', () => {
    expect(hidden('#', 0, 1)).toBe(false)
    expect(hidden('##', 0, 2)).toBe(false)
    expect(hidden('######', 0, 6)).toBe(false)
    expect(hidden('# ', 0, 1)).toBe(false)
  })
  it('空强调不隐藏', () => {
    expect(hidden('****', 0, 4)).toBe(false)
    expect(hidden('**', 0, 2)).toBe(false)
    expect(hidden('*', 0, 1)).toBe(false)
  })
  it('未闭合必须可见', () => {
    expect(hidden('**未闭合粗体', 0, 2)).toBe(false)
    expect(hidden('*未闭合斜体', 0, 1)).toBe(false)
    expect(hidden('`未闭合的代码', 0, 1)).toBe(false)
    expect(hidden('~~未闭合删除线', 0, 2)).toBe(false)
  })
  it('已闭合非空标记应隐藏（反向确认）', () => {
    expect(hidden('**粗体**', 0, 2)).toBe(true)
    expect(hidden('# 标题', 0, 1)).toBe(true)
    expect(hidden('`代码`', 0, 1)).toBe(true)
    expect(hidden('~~删除~~', 0, 2)).toBe(true)
  })
})

describe('渲染快照底线', () => {
  const cases: Array<{doc:string;label:string}> = [
    { doc: '[foo]', label: '短引用无定义' },
    { doc: '[文字]()', label: '空 URL 括号' },
    { doc: '数组 a[0] 用法', label: '数组下标' },
    { doc: '空括号对 []', label: '空括号对' },
    { doc: '[文字][未定义]', label: '引用式无定义' },
  ]
  for (const { doc, label } of cases) {
    it(`${label} 的方括号不得隐藏`, () => {
      const r = describeRender(doc)
      expect(r.hiddenMarkers, `${label} 的方括号被隐藏了`).not.toContain('[')
      expect(r.hiddenMarkers).not.toContain(']')
    })
  }
  const vis: Array<{doc:string;marker:string;label:string}> = [
    { doc: '#', marker: '#', label: '空标题' },
    { doc: '##', marker: '##', label: '二级空标题' },
    { doc: '****', marker: '****', label: '空粗体' },
    { doc: '**未闭合', marker: '**', label: '未闭合粗体' },
    { doc: '`未闭合', marker: '`', label: '未闭合行内代码' },
    { doc: '~~未闭合', marker: '~~', label: '未闭合删除线' },
  ]
  for (const { doc, marker, label } of vis) {
    it(`${label} 的 ${marker} 不得隐藏`, () => {
      const r = describeRender(doc)
      expect(r.hiddenMarkers, `${label} 的 ${marker} 被隐藏了`).not.toContain(marker)
    })
  }
})
