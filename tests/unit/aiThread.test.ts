import { describe, expect, it } from 'vitest'
import {
  attachContext,
  buildChatContext,
  clearThreadMemory,
  recallThread,
  rememberThread,
  replacePayload,
  type ChatMessage,
} from '../../src/core/aiThread'

function storage(): Storage {
  const bag = new Map<string, string>()
  return {
    get length() {
      return bag.size
    },
    clear: () => bag.clear(),
    getItem: (key) => bag.get(key) ?? null,
    key: (index) => [...bag.keys()][index] ?? null,
    removeItem: (key) => {
      bag.delete(key)
    },
    setItem: (key, value) => {
      bag.set(key, value)
    },
  }
}

const turns: ChatMessage[] = [
  { role: 'user', content: '第一句' },
  { role: 'assistant', content: '第一答' },
]

describe('按文档留住对话', () => {
  it('甲乙两篇互不串，退出再打开路径还在，未命名不进 localStorage', () => {
    clearThreadMemory()
    const disk = storage()
    rememberThread({ kind: 'path', path: '/notes/甲.md' }, turns, disk)
    rememberThread({ kind: 'path', path: '/notes/乙.md' }, [{ role: 'user', content: '乙的话' }], disk)
    expect(recallThread({ kind: 'path', path: '/notes/乙.md' }, disk).map((item) => item.content)).toEqual(['乙的话'])
    expect(recallThread({ kind: 'path', path: '/notes/甲.md' }, disk).map((item) => item.content)).toEqual(['第一句', '第一答'])

    clearThreadMemory()
    expect(recallThread({ kind: 'path', path: '/notes/甲.md' }, disk).map((item) => item.content)).toEqual(['第一句', '第一答'])

    rememberThread({ kind: 'session', sessionKey: 'draft-1' }, [{ role: 'user', content: '还没保存' }], disk)
    expect(disk.length).toBe(2)
    expect(recallThread({ kind: 'session', sessionKey: 'draft-1' }, disk)[0]?.content).toBe('还没保存')
    clearThreadMemory()
    expect(recallThread({ kind: 'session', sessionKey: 'draft-1' }, disk)).toEqual([])
  })

  it('超过 20 条丢掉最早的', () => {
    clearThreadMemory()
    const many = Array.from({ length: 22 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: String(index),
    }))
    rememberThread({ kind: 'session', sessionKey: 'long' }, many, null)
    const kept = recallThread({ kind: 'session', sessionKey: 'long' }, null)
    expect(kept).toHaveLength(20)
    expect(kept[0]?.content).toBe('2')
    expect(kept[19]?.content).toBe('21')
  })

  it('写不进 localStorage 时留在内存，并说明这次没能记下', () => {
    clearThreadMemory()
    const disk = storage()
    disk.setItem = () => {
      throw new Error('quota')
    }
    const note = rememberThread({ kind: 'path', path: '/notes/甲.md' }, turns, disk)
    expect(note).toBe('这次没能记下')
    expect(recallThread({ kind: 'path', path: '/notes/甲.md' }, disk)).toHaveLength(2)
  })
})

describe('自由对话的上下文', () => {
  const doc = ['# 缘起', '这一段是正文，不要送进大纲。', '## 规则', '```', '# 代码里的', '```', '结尾'].join('\n')

  it('默认不带上下文时请求和对话本身一样', () => {
    const context = buildChatContext(doc, 0, { outline: false, nearby: false, whole: false })
    const sent = attachContext(turns, context)
    expect(context).toBe('')
    expect(sent.map((item) => item.content)).toEqual(turns.map((item) => item.content))
    expect(turns[0]?.content).toBe('第一句')
  })

  it('大纲只有标题，光标附近只有两侧各 400 字，整篇超过 8000 字会截断', () => {
    const outline = buildChatContext(doc, 0, { outline: true, nearby: false, whole: false })
    expect(outline).toContain('# 缘起')
    expect(outline).toContain('## 规则')
    expect(outline).not.toContain('这一段是正文')
    expect(outline).not.toContain('代码里的')

    const cursor = 1000
    const long = `${'前'.repeat(1000)}光标${'后'.repeat(1000)}`
    const nearby = buildChatContext(long, cursor, { outline: false, nearby: true, whole: false })
    expect(nearby).toContain('光标')
    expect(nearby).not.toContain('前'.repeat(401))
    expect(nearby).not.toContain('后'.repeat(401))
    const around = long.slice(cursor - 400, cursor + 400)
    expect(nearby).toContain(around)

    const whole = `${'文'.repeat(9000)}`
    const clipped = buildChatContext(whole, 8500, { outline: false, nearby: false, whole: true })
    expect(clipped).toContain('正文已截断')
    expect(clipped).toContain('文'.repeat(8000))
    expect(clipped).not.toContain('文'.repeat(8001))
  })
})

describe('在结果上再改一句', () => {
  const card = {
    action: 'shorten',
    instruction: '',
    snapshot: { from: 3, to: 9, target: '原来的选区', context: '前后文' },
    followUp: null,
  }

  it('重试仍对原选区，再改一句只换模型看到的文本，写回范围不变', () => {
    expect(replacePayload(card)).toMatchObject({
      action: 'shorten',
      target: '原来的选区',
      instruction: '',
      from: 3,
      to: 9,
      context: '前后文',
    })
    const again = replacePayload({
      ...card,
      followUp: { source: '上一版结果', instruction: '再短一点' },
    })
    expect(again.target).toBe('上一版结果')
    expect(again.instruction).toBe('再短一点')
    expect(again.from).toBe(3)
    expect(again.to).toBe(9)
    expect(again.context).toBe('前后文')
    expect(again.context).not.toContain('整篇')
  })
})
