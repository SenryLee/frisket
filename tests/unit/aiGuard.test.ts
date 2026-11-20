import { describe, expect, it } from 'vitest'
import {
  captureContinuation,
  captureSelection,
  prepareContinuation,
  prepareReplacement,
  stripModelFences,
} from '../../src/core/aiGuard'

const doc = '前文用于参考。这里是需要改写的句子。后文不要被复述出来啊。'

describe('划选改写护栏', () => {
  it('快照只包含选区，上下文单独存放', () => {
    const from = doc.indexOf('这里是')
    const to = doc.indexOf('。后文')
    const snap = captureSelection(doc, from, to)
    expect(snap?.target).toBe('这里是需要改写的句子')
    expect(snap?.context.includes('这里是需要改写的句子')).toBe(false)
    expect(snap?.context.includes('前文用于参考')).toBe(true)
  })

  it('剥掉包住全文的 markdown 围栏', () => {
    expect(stripModelFences('```markdown\n改好了\n```')).toBe('改好了')
    expect(stripModelFences('正文里的 ```code``` 保留')).toBe('正文里的 ```code``` 保留')
  })

  it('超过原文三倍加 200 字时拒绝', () => {
    const snap = captureSelection('短句待改', 0, 4)
    expect(snap).not.toBeNull()
    const blown = '字'.repeat(220)
    const result = prepareReplacement(snap!, blown, '短句待改', 'rewrite')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('too_long')
  })

  it('复述上下文连续 20 字时拒绝，原文里已有的短语不算', () => {
    const before = 'abcdefghijklmnopqrstuvwxyz and more context here'
    const target = '目标句子'
    const doc = `${before}${target}`
    const snap = captureSelection(doc, before.length, doc.length)
    expect(snap).not.toBeNull()
    const leaked = prepareReplacement(snap!, `改写。${before.slice(0, 20)}`, doc, 'rewrite')
    expect(leaked.ok).toBe(false)
    if (!leaked.ok) expect(leaked.code).toBe('leak_detected')
    const kept = prepareReplacement(snap!, target, doc, 'rewrite')
    expect(kept.ok).toBe(true)
  })

  it('生成期间选区原文变了就拒绝', () => {
    const snap = captureSelection('原文保持不动', 0, 6)
    const result = prepareReplacement(snap!, '新句子', '原文已经被改', 'rewrite')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('stale')
  })

  it('通过时给出字数变化，并保留可写回的文本', () => {
    const snap = captureSelection('原文保持不动', 0, 6)
    const result = prepareReplacement(snap!, '```md\n改后的句子\n```', '原文保持不动', 'rewrite')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.text).toBe('改后的句子')
      expect(result.before).toBe(6)
      expect(result.after).toBe(5)
    }
  })

  it('长度锁仍是原文三倍加 200，差一字也不放宽', () => {
    const snap = captureSelection('短句待改', 0, 4)
    expect(snap).not.toBeNull()
    const limit = 4 * 3 + 200
    const under = prepareReplacement(snap!, '字'.repeat(limit), '短句待改', 'rewrite')
    const over = prepareReplacement(snap!, '字'.repeat(limit + 1), '短句待改', 'rewrite')
    expect(under.ok).toBe(true)
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.code).toBe('too_long')
  })
})

describe('续写补全', () => {
  it('只取插入点前 400 字，不带后面的字', () => {
    const before = '前'.repeat(400)
    const doc = `${before}后面的字不要送`
    const snap = captureContinuation(doc, 400)
    expect(snap?.at).toBe(400)
    expect(snap?.prefix).toBe(before)
    expect(snap?.prefix.includes('后')).toBe(false)
  })

  it('没有选区时新文字接在光标后，光标前的字不动', () => {
    const doc = '已经写好的句子。'
    const snap = captureContinuation(doc, doc.length)
    expect(snap).not.toBeNull()
    const result = prepareContinuation(snap!, '接下来的话', doc)
    expect(result.ok).toBe(true)
    if (!result.ok || snap === null) return
    const next = doc.slice(0, snap.at) + result.text + doc.slice(snap.at)
    expect(next).toBe(`${doc}接下来的话`)
  })

  it('有选区时选区原文留着，新文字接在选区末尾', () => {
    const doc = '前文。选区原文。后文。'
    const from = doc.indexOf('选区')
    const to = doc.indexOf('。后文')
    const snap = captureContinuation(doc, to)
    expect(snap).not.toBeNull()
    const result = prepareContinuation(snap!, '接上的新字', doc)
    expect(result.ok).toBe(true)
    if (!result.ok || snap === null) return
    const next = doc.slice(0, snap.at) + result.text + doc.slice(snap.at)
    expect(next.slice(from, to)).toBe('选区原文')
    expect(next.slice(to, to + result.text.length)).toBe('接上的新字')
    expect(next.endsWith('后文。')).toBe(true)
  })

  it('抄了前文就剥掉重合前缀，全部重复则不写回', () => {
    const doc = '光标前的原文'
    const snap = captureContinuation(doc, doc.length)
    expect(snap).not.toBeNull()
    const partial = prepareContinuation(snap!, '光标前的原文，以及新的一句', doc)
    expect(partial.ok).toBe(true)
    if (partial.ok) expect(partial.text).toBe('，以及新的一句')
    const tail = prepareContinuation(snap!, '原文再补一句', doc)
    expect(tail.ok).toBe(true)
    if (tail.ok) expect(tail.text).toBe('再补一句')
    const copied = prepareContinuation(snap!, '光标前的原文', doc)
    expect(copied.ok).toBe(false)
    if (!copied.ok) {
      expect(copied.code).toBe('repeat')
      expect(copied.message).toBe('结果只是在重复前文')
    }
  })

  it('插入点前面的字变了就拒绝，不把新文字写进别的位置', () => {
    const doc = '已经写好的句子。'
    const snap = captureContinuation(doc, doc.length)
    const result = prepareContinuation(snap!, '新的一句', '已经写好的句子！')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('stale')
      expect(result.force).toBe(false)
    }
  })
})

function selection(before: string, target: string, after = ''): { doc: string; snap: NonNullable<ReturnType<typeof captureSelection>> } {
  const doc = `${before}${target}${after}`
  const snap = captureSelection(doc, before.length, before.length + target.length)
  if (snap === null) throw new Error('选区没有取到')
  return { doc, snap }
}

describe('结构和泄漏', () => {
  it('二级标题改成三级、丢掉链接、拆掉围栏都会拒绝，原因里能看到那一处', () => {
    const heading = selection('', '## 第二节\n正文')
    const changed = prepareReplacement(heading.snap, '### 第二节\n正文', heading.doc, 'rewrite')
    expect(changed.ok).toBe(false)
    if (!changed.ok) {
      expect(changed.message).toContain('二级标题被改成了三级')
      expect(changed.message).toContain('第二节')
      expect(changed.force).toBe(true)
    }

    const link = selection('', '请看[说明](https://example.com/a)。')
    const dropped = prepareReplacement(link.snap, '请看[说明](https://example.com/b)。', link.doc, 'rewrite')
    expect(dropped.ok).toBe(false)
    if (!dropped.ok) expect(dropped.message).toContain('丢掉了链接地址：https://example.com/a')

    const fence = selection('', '```js\nconst a = 1\n```')
    const broken = prepareReplacement(fence.snap, 'const a = 1', fence.doc, 'rewrite')
    expect(broken.ok).toBe(false)
    if (!broken.ok) expect(broken.message).toContain('围栏被拆掉了：```js')

    const typo = prepareReplacement(fence.snap, '```js\nconst a = 2\n```', fence.doc, 'fixGrammar')
    expect(typo.ok).toBe(true)
    const rewritten = prepareReplacement(fence.snap, '```js\nconst a = 2\n```', fence.doc, 'rewrite')
    expect(rewritten.ok).toBe(false)
  })

  it('转列表、转表格不会因为变成列表或表格被拒绝', () => {
    const list = selection('', '苹果、香蕉、梨')
    const listed = prepareReplacement(list.snap, '- 苹果\n- 香蕉\n- 梨', list.doc, 'toList')
    expect(listed.ok).toBe(true)
    const table = selection('', '姓名 年龄\n阿宁 3')
    const tabulated = prepareReplacement(
      table.snap,
      '| 姓名 | 年龄 |\n| --- | --- |\n| 阿宁 | 3 |',
      table.doc,
      'toTable',
    )
    expect(tabulated.ok).toBe(true)
  })

  it('二十字中文术语照写不再拒绝，选区后连续四十字仍拒绝', () => {
    const term = '甲'.repeat(20)
    const kept = selection(term, '这里是需要改写的正文。', term)
    const echoed = prepareReplacement(kept.snap, `这里是改好的正文。${term}`, kept.doc, 'rewrite')
    expect(echoed.ok).toBe(true)

    const copied = '乙'.repeat(40)
    const leaked = selection('前文。', '这里是需要改写的正文。', copied)
    const hit = prepareReplacement(leaked.snap, `这里是改好的正文。${copied}`, leaked.doc, 'rewrite')
    expect(hit.ok).toBe(false)
    if (!hit.ok) {
      expect(hit.force).toBe(true)
      expect(hit.message).toContain('选区后')
      expect(hit.message).toContain(copied)
    }
  })

  it('空结果和选区已变不能强行采纳，超长可以', () => {
    const sample = selection('', '短句待改写的正文')
    const empty = prepareReplacement(sample.snap, '   ', sample.doc, 'rewrite')
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.force).toBe(false)
    const stale = prepareReplacement(sample.snap, '新的句子写在这里', '别的正文', 'rewrite')
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.force).toBe(false)
    const over = prepareReplacement(sample.snap, '字'.repeat(300), sample.doc, 'expand')
    expect(over.ok).toBe(false)
    if (!over.ok) {
      expect(over.code).toBe('too_long')
      expect(over.force).toBe(true)
    }
  })

  it('续写留下未闭合围栏时拒绝', () => {
    const doc = '已经写好。'
    const snap = captureContinuation(doc, doc.length)
    const result = prepareContinuation(snap!, '```js\nconst a = 1', doc)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('structure')
      expect(result.message).toContain('未闭合的围栏')
      expect(result.force).toBe(true)
    }
  })
})
