import { describe, expect, it } from 'vitest'
import { KERNEL_PATHS, PENDING_REASON, loadExport } from './helpers/pending'

/**
 * 空标记渐进披露（progressive disclosure）
 *
 * ── 为什么空标记不能隐藏 ──────────────────────────────────────
 *
 * 用户输入 `##` 时 intending 写标题，但还没想好内容。
 * 如果此时 `##` 被隐藏，屏幕上就是一片空白 ——
 * 用户会以为没输入成功，于是再敲一遍 `#`，变成 `###`。
 * 打字越多错得越离谱，且无从纠正（因为看不到自己写了什么）。
 *
 * 这不是审美问题，是「能不能正常写字」的问题。
 * 同理适用于未闭合的 `****`、未闭合的反引号：
 * 打字过程中的中间态必须始终可见。
 *
 * 判据：空标记、未闭合标记必须保持可见。
 *
 * ── 运行状态 ──────────────────────────────────────────────────
 *
 * 依赖 src/editor/live/guards.ts，当前未就绪，本文件整体 skip。
 * **尚未跑通**，不构成通过。
 */

interface GuardsApi {
  /** 该范围是否应当被隐藏（true=隐藏）。空标记必须返回 false。 */
  shouldHideRange(doc: string, from: number, to: number): boolean
}

const api = await loadExport<GuardsApi>(KERNEL_PATHS.guards, 'shouldHideRange')
const describeGuards = api === null ? describe.skip : describe

if (api === null) {
  describe.skip(`空标记渐进披露（${PENDING_REASON}）`, () => {
    it('占位', () => {
      expect(api).toBeNull()
    })
  })
}

/** 判定：给定范围是否会被隐藏。 */
function hidden(doc: string, from: number, to: number): boolean {
  return (api as GuardsApi).shouldHideRange(doc, from, to)
}

describeGuards('空标题标记不得隐藏', () => {
  it('单独一个 # 不得隐藏', () => {
    expect(hidden('#', 0, 1)).toBe(false)
  })

  it('单独 ## 不得隐藏', () => {
    expect(hidden('##', 0, 2)).toBe(false)
  })

  it('###### 不得隐藏', () => {
    expect(hidden('######', 0, 6)).toBe(false)
  })

  it('# 后跟空格也不得隐藏', () => {
    expect(hidden('# ', 0, 1)).toBe(false)
  })
})

describeGuards('空的强调标记不得隐藏', () => {
  // ── 关于 **** ──────────────────────────────────────────────────
  //
  // 这里**不能**用 `****` 当「空粗体」的例子。
  // 实测 lezer-markdown：`****` 解析为 HorizontalRule（thematic break），
  // 与 `***` / `___` 同类 —— 这是 CommonMark 规范行为，不是解析器的怪癖。
  //
  // 若把它当成「待隐藏的粗体标记」，用户敲四个星号就会看到裸星号而不是一条横线，
  // 那是渲染错误，比少折叠一个记号严重得多。
  //
  // 想测「空标记必须可见」就用真正未闭合的形式，见下方 `**` 与 ``。

  it('** 不得隐藏', () => {
    expect(hidden('**', 0, 2)).toBe(false)
  })

  it('* 不得隐藏', () => {
    expect(hidden('*', 0, 1)).toBe(false)
  })

  it('`` 不得隐藏（空行内代码）', () => {
    expect(hidden('``', 0, 2)).toBe(false)
  })

  it('~~ 不得隐藏（未闭合删除线）', () => {
    expect(hidden('~~', 0, 2)).toBe(false)
  })
})

describeGuards('未闭合的标记必须保持可见', () => {
  it('未闭合的粗体 **text 不得隐藏起始星号', () => {
    expect(hidden('**未闭合粗体', 0, 2)).toBe(false)
  })

  it('未闭合的斜体 *text 不得隐藏起始星号', () => {
    expect(hidden('*未闭合斜体', 0, 1)).toBe(false)
  })

  it('未闭合的行内代码 ` 不得隐藏反引号', () => {
    expect(hidden('`未闭合的代码', 0, 1)).toBe(false)
  })

  it('未闭合的删除线 ~~ 不得隐藏', () => {
    expect(hidden('~~未闭合删除线', 0, 2)).toBe(false)
  })
})

describeGuards('已闭合的非空标记应当隐藏（反向确认）', () => {
  it('**粗体** 的标记应隐藏', () => {
    // 这条是反向确认：如果连正常标记都不隐藏，说明整个守卫逻辑没接上，
    // 上面那些「不得隐藏」的断言会因为什么都没做而全绿 —— 那是假通过。
    expect(hidden('**粗体**', 0, 2)).toBe(true)
  })

  it('#标题 的井号应隐藏', () => {
    expect(hidden('# 标题', 0, 1)).toBe(true)
  })

  it('`代码` 的反引号应隐藏', () => {
    expect(hidden('`代码`', 0, 1)).toBe(true)
  })

  it('~~删除~~ 的波浪号应隐藏', () => {
    expect(hidden('~~删除~~', 0, 2)).toBe(true)
  })
})