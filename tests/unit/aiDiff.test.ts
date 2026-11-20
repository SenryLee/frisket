import { describe, expect, it } from 'vitest'
import { diffText } from '../../src/core/aiDiff'

describe('采纳前的对比', () => {
  it('多行把改动的行标出来', () => {
    const diff = diffText('第一行\n要改的行\n第三行', '第一行\n改过的行\n第三行')
    expect(diff.mode).toBe('lines')
    if (diff.mode !== 'lines') return
    expect(diff.lines.map((line) => [line.kind, line.text])).toEqual([
      ['same', '第一行'],
      ['remove', '要改的行'],
      ['add', '改过的行'],
      ['same', '第三行'],
    ])
  })

  it('单行收起相同的头尾，只留中间换掉的片段', () => {
    const diff = diffText('你好世界今天', '你好中国今天')
    expect(diff.mode).toBe('fragment')
    if (diff.mode !== 'fragment') return
    expect(diff.pieces).toEqual([
      { kind: 'equal', text: '…' },
      { kind: 'remove', text: '世界' },
      { kind: 'add', text: '中国' },
      { kind: 'equal', text: '…' },
    ])
  })
})
