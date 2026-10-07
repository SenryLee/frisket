import { describe, expect, it } from 'vitest'
import { activeOutlineKey, outlineRows, parseOutline } from '../../src/core/outline'

const sample = ['# 缘起', '正文', '## 规则一', '### 细则', '## 规则二', '# 色彩'].join('\n')

describe('目录', () => {
  it('按标题层级收成树，并从本篇最浅的一级开始缩进', () => {
    const rows = outlineRows(parseOutline(sample), new Set())
    expect(rows.map((row) => [row.text, row.depth])).toEqual([
      ['缘起', 0],
      ['规则一', 1],
      ['细则', 2],
      ['规则二', 1],
      ['色彩', 0],
    ])
    expect(rows[0]?.hasChildren).toBe(true)
    expect(rows[2]?.hasChildren).toBe(false)
  })

  it('从二级标题写起时，二级贴在最左', () => {
    const rows = outlineRows(parseOutline('## 甲\n### 乙'), new Set())
    expect(rows.map((row) => row.depth)).toEqual([0, 1])
  })

  it('井号贴着字、空标题、代码块里的井号都不进目录', () => {
    const markdown = ['#不是标题', '###', '```', '# 代码里的', '```', '# 真正的标题 ##'].join('\n')
    const rows = outlineRows(parseOutline(markdown), new Set())
    expect(rows.map((row) => row.text)).toEqual(['真正的标题'])
  })

  it('折叠后子标题消失，光标仍算在还能看见的那一节', () => {
    const nodes = parseOutline(sample)
    const parent = nodes[0]
    expect(parent).toBeTruthy()
    const collapsed = new Set([parent?.key ?? ''])
    const rows = outlineRows(nodes, collapsed)
    expect(rows.map((row) => row.text)).toEqual(['缘起', '色彩'])
    expect(rows[0]?.open).toBe(false)
    const inside = parent?.children[0]?.children[0]?.from ?? 0
    expect(activeOutlineKey(nodes, inside, collapsed)).toBe(parent?.key)
    expect(activeOutlineKey(nodes, inside, new Set())).toBe(parent?.children[0]?.children[0]?.key)
  })
})
