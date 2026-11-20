import { describe, expect, it } from 'vitest'
import {
  captureContinuation,
  captureSelection,
  containsContextLeak,
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
    const result = prepareReplacement(snap!, blown, '短句待改')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('too_long')
  })

  it('复述上下文连续 20 字时拒绝，原文里已有的短语不算', () => {
    const context = '这是一段只允许阅读、绝不能被模型复述的上下文'
    const target = '目标句子'
    expect(containsContextLeak(`改写。${context}`, context, target)).toBe(true)
    expect(containsContextLeak(`改写。${target}`, context, target)).toBe(false)
    expect(containsContextLeak(context.slice(0, 10), context, target)).toBe(false)
  })

  it('生成期间选区原文变了就拒绝', () => {
    const snap = captureSelection('原文保持不动', 0, 6)
    const result = prepareReplacement(snap!, '新句子', '原文已经被改')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('stale')
  })

  it('通过时给出字数变化，并保留可写回的文本', () => {
    const snap = captureSelection('原文保持不动', 0, 6)
    const result = prepareReplacement(snap!, '```md\n改后的句子\n```', '原文保持不动')
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
    const under = prepareReplacement(snap!, '字'.repeat(limit), '短句待改')
    const over = prepareReplacement(snap!, '字'.repeat(limit + 1), '短句待改')
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
    if (!result.ok) expect(result.code).toBe('stale')
  })
})
