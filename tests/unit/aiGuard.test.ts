import { describe, expect, it } from 'vitest'
import { captureSelection, containsContextLeak, prepareReplacement, stripModelFences } from '../../src/core/aiGuard'

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
})
