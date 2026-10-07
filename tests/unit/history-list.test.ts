import { describe, expect, it } from 'vitest'
import { omitHistory } from '../../src/core/historyList'

const items = [
  { id: '/notes/甲.md', path: '/notes/甲.md', title: '甲' },
  { id: 'hash-乙', path: '/notes/乙.md', title: '乙' },
  { id: '/notes/丙.md', path: '/notes/丙.md', title: '丙' },
]

describe('omitHistory', () => {
  it('按 id 去掉记录，其余保持原对象', () => {
    const next = omitHistory(items, ['/notes/甲.md'])
    expect(next.map((item) => item.title)).toEqual(['乙', '丙'])
    expect(next[0]).toBe(items[1])
    expect(items).toHaveLength(3)
  })

  it('id 和 path 不是同一个字符串时，按 path 也能去掉', () => {
    const next = omitHistory(items, ['/notes/乙.md'])
    expect(next.map((item) => item.title)).toEqual(['甲', '丙'])
  })

  it('一次去掉多条，空名单和未知 id 都不改内容', () => {
    expect(omitHistory(items, ['/notes/甲.md', 'hash-乙']).map((item) => item.title)).toEqual(['丙'])
    expect(omitHistory(items, []).map((item) => item.title)).toEqual(['甲', '乙', '丙'])
    expect(omitHistory(items, ['', '/missing.md'])).toHaveLength(3)
  })

  it('NFC 和 NFD 看成同一条路径', () => {
    const composed = '/notes/é.md'.normalize('NFC')
    const decomposed = '/notes/é.md'.normalize('NFD')
    const list = [{ id: decomposed, path: decomposed }]
    expect(omitHistory(list, [composed])).toEqual([])
  })
})
