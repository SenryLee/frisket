import { describe, expect, it } from 'vitest'
import { COMMONMARK_CASES, type SyntaxCase } from '../fixtures/corpus-commonmark'
import { GFM_CASES } from '../fixtures/corpus-gfm'

/**
 * 语料自身的完整性校验
 *
 * ── 为什么需要这个文件 ────────────────────────────────────────
 *
 * 后面所有渲染快照测试都靠语料驱动。语料若本身有错
 * （锚点拼错、期望值写反、标记类型不存在于 CommonMark），
 * 失败会出现在渲染断言里，排查方向被误导到「内核实现有 bug」，
 * 而真正的问题在测试数据里 —— 这是很贵的误诊成本。
 *
 * 所以先用一条独立的测试把语料校验一遍：数量、唯一性、字段自洽性。
 * 它不依赖任何被测代码，因此在 src/editor/ 就绪前就能跑，且必须能跑。
 */

const ALL_CASES: ReadonlyArray<SyntaxCase & { spec: string }> = [
  ...COMMONMARK_CASES,
  ...GFM_CASES,
]

describe('语料完整性', () => {
  it('CommonMark 语料至少 60 条', () => {
    expect(COMMONMARK_CASES.length).toBeGreaterThanOrEqual(60)
  })

  it('GFM 语料至少 60 条', () => {
    expect(GFM_CASES.length).toBeGreaterThanOrEqual(60)
  })

  it('用例名全局唯一', () => {
    const names = ALL_CASES.map((c) => c.name)
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index)
    expect(duplicates, `用例名重复：${duplicates.join(', ')}`).toEqual([])
  })

  it('每条语料都有 name / spec / source', () => {
    for (const item of ALL_CASES) {
      expect(item.name, 'name 不能为空').toBeTruthy()
      expect(item.spec, `${item.name} 缺少 spec 章节号`).toBeTruthy()
      expect(item.source, `${item.name} 的 source 不能为空`).toBeTruthy()
    }
  })

  it('visibleText 为 null 的语料必须给出另一个可断言的字段', () => {
    // 否则这条用例等于什么都不断言 —— 快照会「通过」但毫无意义。
    for (const item of ALL_CASES) {
      if (item.visibleText !== null) continue
      const hasOtherAssertion =
        (item.hiddenMarkers !== undefined && item.hiddenMarkers.length > 0) ||
        (item.shownMarkers !== undefined && item.shownMarkers.length > 0) ||
        item.lineCount !== undefined
      expect(
        hasOtherAssertion,
        `${item.name} 的 visibleText 为 null 且没有任何其他断言字段，等于空用例`,
      ).toBe(true)
    }
  })

  it('hiddenMarkers 与 shownMarkers 不应同时声明同一标记', () => {
    for (const item of ALL_CASES) {
      const hidden = item.hiddenMarkers ?? []
      const shown = item.shownMarkers ?? []
      const conflict = hidden.filter((marker) => shown.includes(marker))
      expect(conflict, `${item.name} 把 ${conflict.join(',')} 同时列为隐藏与显示`).toEqual([])
    }
  })

  it('shownMarkers 中的标记确实出现在 source 里', () => {
    // 若标记根本不在源码里，「保持可见」这条断言永远不会失败 ——
    // 看起来是防御用例，实际是空断言。
    for (const item of ALL_CASES) {
      for (const marker of item.shownMarkers ?? []) {
        expect(
          item.source.includes(marker),
          `${item.name} 声明 ${marker} 应保持可见，但源码里没有这个标记`,
        ).toBe(true)
      }
    }
  })

  it('hiddenMarkers 中的标记确实出现在 source 里', () => {
    for (const item of ALL_CASES) {
      for (const marker of item.hiddenMarkers ?? []) {
        expect(
          item.source.includes(marker),
          `${item.name} 声明 ${marker} 应被隐藏，但源码里没有这个标记`,
        ).toBe(true)
      }
    }
  })

  it('lineCount 是正整数', () => {
    // 注意：这里**不**校验 lineCount 等于 source 的行数。
    // lineCount 的语义是「渲染后的可见行数」，而围栏代码块会把整个块
    // 收成一个 widget，渲染行数本就少于源码行数。
    // 强行拿源码行数去卡它，得到的失败是关于语料字段的，
    // 与真正要验的渲染行为无关 —— 那会把排查方向带偏。
    // 它的实际取值由渲染快照测试校准。
    for (const item of ALL_CASES) {
      if (item.lineCount === undefined) continue
      expect(
        Number.isInteger(item.lineCount) && (item.lineCount as number) > 0,
        `${item.name} 的 lineCount=${String(item.lineCount)} 不是正整数`,
      ).toBe(true)
    }
  })

  it('visibleText 若声明，则不得包含源码里应被隐藏的标记', () => {
    // 例：声明隐藏 '**' 的语料，visibleText 里就不该再有 '**'。
    // 若出现，说明两条期望互相矛盾，渲染时必然有一条失败。
    for (const item of ALL_CASES) {
      if (item.visibleText === null) continue
      for (const marker of item.hiddenMarkers ?? []) {
        expect(
          item.visibleText.includes(marker),
          `${item.name} 声明隐藏 ${marker}，但 visibleText 里仍含该标记：` +
            JSON.stringify(item.visibleText),
        ).toBe(false)
      }
    }
  })
})