import { describe, expect, it } from 'vitest'
import { KERNEL_PATHS, PENDING_REASON, loadExport } from './helpers/pending'

/**
 * 无感打字：光标停在正文里时，不展开任何 Markdown 记号。
 *
 * 点击某一行如果把 `#`、`**` 整组露出来，写的时候会一直看到源码。
 * 记号只有在光标正好落进记号字符时才由替换层单独露出，那条路径不在这里。
 *
 * ── 关于本文件的运行状态 ──────────────────────────────────────
 *
 * 依赖的 src/editor/live/reveal.ts 由内核子智能体开发中，当前不存在。
 * 本文件用动态 import 守卫，就绪前会整体 skip。
 * **这些用例尚未跑通**，不构成通过。详见 helpers/pending.ts 的说明。
 */

/** 一个语法标记范围。depth 用于表达嵌套层级。 */
interface Range {
  from: number
  to: number
  depth: number
}

/** 被测模块需要暴露的接口。 */
interface RevealApi {
  /**
   * @param doc 全文
   * @param cursor 光标偏移
   * @param ranges 全部标记范围
   * @returns 需要展开的范围下标集合
   */
  computeRevealed(doc: string, cursor: number, ranges: readonly Range[]): Set<number>
}

/** 语料：`**粗斜体**`，其中嵌套 `*斜体*`。
 *  偏移： 0123456789...
 *  实际串 `**粗*斜*体**` → 粗在 2，斜在 3，体在 4
 */
const NESTED_DOC = '**粗*斜*体**'
/** 外层粗体的范围（含两个星号） */
const OUTER: Range = { from: 0, to: 9, depth: 0 }
/** 内层斜体的范围（含两个星号） */
const INNER: Range = { from: 3, to: 6, depth: 1 }

const api = await loadExport<RevealApi>(KERNEL_PATHS.reveal, 'computeRevealed')
const describeReveal = api === null ? describe.skip : describe

if (api === null) {
  // 让「未跑」这件事在报告里显式可见，而不是安静地变成一堆通过
  describe.skip(`reveal 状态机（${PENDING_REASON}）`, () => {
    it('占位', () => {
      expect(api).toBeNull()
    })
  })
}

describeReveal('reveal：光标在正文里不展开记号', () => {
  it('光标在文档开头不展开', () => {
    const revealed = (api as RevealApi).computeRevealed(NESTED_DOC, 0, [OUTER, INNER])
    expect(revealed.size).toBe(0)
  })

  it('光标在粗体正文中间也不展开', () => {
    const revealed = (api as RevealApi).computeRevealed(NESTED_DOC, 2, [OUTER, INNER])
    expect(revealed.size).toBe(0)
  })

  it('光标在嵌套斜体内部也不展开', () => {
    const revealed = (api as RevealApi).computeRevealed(NESTED_DOC, 4, [OUTER, INNER])
    expect(revealed.size).toBe(0)
  })

  it('三层嵌套的最内层同样保持折叠', () => {
    const doc = '***深***'
    const ranges: Range[] = [
      { from: 0, to: 7, depth: 0 },
      { from: 0, to: 7, depth: 1 },
      { from: 3, to: 4, depth: 2 },
    ]
    const revealed = (api as RevealApi).computeRevealed(doc, 3, ranges)
    expect(revealed.size).toBe(0)
  })
})

describeReveal('reveal：逐字移动不得把记号闪出来', () => {
  it('单层和嵌套范围的展开状态始终为空', () => {
    for (const ranges of [[OUTER], [INNER], [OUTER, INNER]]) {
      for (let cursor = 0; cursor <= NESTED_DOC.length; cursor += 1) {
        const revealed = (api as RevealApi).computeRevealed(NESTED_DOC, cursor, ranges)
        expect(revealed.size, `光标 ${cursor} 展开了记号`).toBe(0)
      }
    }
  })

  it('范围列表为空时不报错', () => {
    expect(() => (api as RevealApi).computeRevealed('任意文本', 2, [])).not.toThrow()
  })

  it('光标超出文档长度时不抛错，也不展开', () => {
    const revealed = (api as RevealApi).computeRevealed(NESTED_DOC, 9999, [OUTER, INNER])
    expect(revealed.size).toBe(0)
  })
})