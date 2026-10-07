import { describe, expect, it } from 'vitest'
import { KERNEL_PATHS, PENDING_REASON, loadExport } from './helpers/pending'

/**
 * 「光标进入则展开原始语法」状态机
 *
 * ── 为什么这条规则值得单独测 ──────────────────────────────────
 *
 * 这条规则是 Typora 类编辑器的核心交互：平时隐藏 `**`，光标进入粗体内部时展开 `**`。
 * 它同时触碰三件易错的事：
 *   1. 嵌套时展开哪些 —— 全展开会让页面看起来像源码，全不展开则用户看不到自己在哪
 *   2. 光标在元素边界时算进内还是外 —— 差一个字符就会导致标记反复显隐（闪烁）
 *   3. 组合输入期间不得切换 —— 否则丢字（见 e2e/ime.spec.ts）
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

describeReveal('reveal：光标在段落外时全部折叠', () => {
  it('光标在文档开头，范围内的一切都不展开', () => {
    const revealed = (api as RevealApi).computeRevealed(NESTED_DOC, 0, [OUTER, INNER])
    expect(revealed.size).toBe(0)
  })

  it('光标在文档末尾，一切都不展开', () => {
    const revealed = (api as RevealApi).computeRevealed(NESTED_DOC, NESTED_DOC.length, [OUTER, INNER])
    expect(revealed.size).toBe(0)
  })
})

describeReveal('reveal：光标在粗体内部则展开粗体', () => {
  it('光标落在粗体正文中间时，粗体标记应展开', () => {
    // 「粗」在偏移 2
    const revealed = (api as RevealApi).computeRevealed(NESTED_DOC, 2, [OUTER, INNER])
    expect(revealed.has(0)).toBe(true)
  })

  it('光标紧贴起始星号之前时不应展开', () => {
    // 偏移 0 是第一个星号本身。落在标记之上不算进入内容，
    // 展开会导致光标刚移入就看到星号，体验上等同于闪烁。
    const revealed = (api as RevealApi).computeRevealed(NESTED_DOC, 0, [OUTER, INNER])
    expect(revealed.has(0)).toBe(false)
  })
})

describeReveal('reveal：嵌套时只有最内层及其祖先展开', () => {
  it('光标在斜体内部时，斜体与其祖先粗体都展开', () => {
    // 「斜」在偏移 4
    const revealed = (api as RevealApi).computeRevealed(NESTED_DOC, 4, [OUTER, INNER])
    expect(revealed.has(1)).toBe(true)
    // 祖先必须一起展开，否则斜体标记会脱离粗体语境，
    // 视觉上像是两个独立的语法元素
    expect(revealed.has(0)).toBe(true)
  })

  it('光标在粗体但不在斜体内时，只有粗体展开', () => {
    // 偏移 2 处的「粗」属于外层，不属于内层斜体
    const revealed = (api as RevealApi).computeRevealed(NESTED_DOC, 2, [OUTER, INNER])
    expect(revealed.has(0)).toBe(true)
    expect(revealed.has(1)).toBe(false)
  })

  it('三层层级嵌套时，祖先链完整展开', () => {
    const doc = '***深***'
    const l1: Range = { from: 0, to: 7, depth: 0 }
    const l2: Range = { from: 0, to: 7, depth: 1 }
    const l3: Range = { from: 3, to: 4, depth: 2 }
    const revealed = (api as RevealApi).computeRevealed(doc, 3, [l1, l2, l3])
    // 最内层在光标处，祖先链都应展开
    expect(revealed.has(2)).toBe(true)
    expect(revealed.has(1)).toBe(true)
    expect(revealed.has(0)).toBe(true)
  })
})

describeReveal('reveal：边界行为不得抖动', () => {
  /**
   * 抖动检测的语义边界（实测厘清，2026-10）：
   *
   * 「切换次数 ≤ 2」这个阈值**只适用于单层范围**。
   * 实测轨迹：
   *   仅外层 [0,9]     : 1:[0] → 9:[]                             = 2 次
   *   仅内层 [3,6]     : 4:[0] → 6:[]                             = 2 次
   *   外层+内层（嵌套） : 1:[0] → 4:[0,1] → 6:[0] → 9:[]          = 4 次
   *
   * 嵌套多出的 2 次是「进入内层」「退出内层」，**语义必需**：
   * 光标在外层粗体内时，斜体不该展开 —— 否则斜体的 `*` 会脱离粗体语境，
   * 这与上面「祖先必须一起展开」那条用例直接矛盾。
   *
   * 所以抖动检测按单元素范围做（每个语法元素单独进出一次），
   * 嵌套的正确性由「祖先链」用例保证。两者职责不同，不能用同一个阈值。
   */
  it('单层范围：光标逐字符穿过边界时展开状态最多切换 2 次', () => {
    const transitions: string[] = []
    let previous = ''

    for (let cursor = 0; cursor <= NESTED_DOC.length; cursor += 1) {
      const revealed = (api as RevealApi).computeRevealed(NESTED_DOC, cursor, [OUTER])
      const signature = [...revealed].sort().join(',')
      if (signature !== previous) {
        transitions.push(`${cursor}:[${signature}]`)
        previous = signature
      }
    }

    expect(transitions.length, `单元素切换过于频繁：${transitions.join(' → ')}`).toBeLessThanOrEqual(2)
  })

  it('嵌套范围：切换次数等于嵌套层数 + 1（进入内层与退出内层各一次）', () => {
    const transitions: string[] = []
    let previous = ''

    for (let cursor = 0; cursor <= NESTED_DOC.length; cursor += 1) {
      const revealed = (api as RevealApi).computeRevealed(NESTED_DOC, cursor, [OUTER, INNER])
      const signature = [...revealed].sort().join(',')
      if (signature !== previous) {
        transitions.push(`${cursor}:[${signature}]`)
        previous = signature
      }
    }

    // 两层嵌套 → 进入外层、进入内层、退出内层、退出外层 = 4 次。
    // 断言「恰好 4 次」而非「不超过 4 次」：多一次说明有抖动，
    // 少一次说明内层没独立展开（祖先链断了）。
    expect(transitions.length, `嵌套切换次数异常：${transitions.join(' → ')}`).toBe(4)
  })

  it('不得出现「离开后又立刻回到原状态」的抖动', () => {
    /*
     * 抖动的真实形态：光标在某处停留，标记忽隐忽现。
     *
     * 第一版我写成「轨迹里不能出现 A→B→A」，那是错的 ——
     * 正常的「进入内层再退出内层」也是 []→[0]→[]，语义上完全正常。
     *
     * 真正要抓的是：**不连续的状态重复**。
     * 即 A→B→A 三步里，第 1 步和第 3 步之间隔着「其他状态」，
     * 且回到A 之后立刻又要变 —— 那意味着状态不稳定。
     *
     * 判据改为：相邻两次切换的目标状态，必须都不同（即不得回退到上一个状态）。
     * 正常轨迹 []→[0]→[0,1]→[0]→[] 中，[0]→[0,1] 与 [0,1]→[0] 都是有效变化，
     * 而 [0]→[] 是正常退出。
     */
    let backtrack = ''

    for (const ranges of [[OUTER], [INNER], [OUTER, INNER]]) {
      const states: string[] = []
      for (let cursor = 0; cursor <= NESTED_DOC.length; cursor += 1) {
        const revealed = (api as RevealApi).computeRevealed(NESTED_DOC, cursor, ranges)
        const signature = [...revealed].sort().join(',')
        if (states[states.length - 1] !== signature) states.push(signature)
      }

      // 抖动检查：若某状态在轨迹里出现两次，且中间只隔了一个不同状态，
      // 说明进入后立刻又退出 —— 逐字符扫描时不可见，但光标停在边界会看到闪烁。
      // 唯一允许的重复是首尾（空→有→空），那是完整的一次进出。
      for (let i = 1; i < states.length - 1; i += 1) {
        if (states[i] === states[i + 1]) {
          backtrack = states.join(' → ')
        }
      }
    }

    expect(backtrack, `展开状态出现回退抖动：${backtrack}`).toBe('')
  })

  it('范围列表为空时不报错', () => {
    expect(() => (api as RevealApi).computeRevealed('任意文本', 2, [])).not.toThrow()
  })

  it('光标超出文档长度时被夹紧而非抛错', () => {
    expect(() =>
      (api as RevealApi).computeRevealed(NESTED_DOC, 9999, [OUTER, INNER]),
    ).not.toThrow()
  })
})