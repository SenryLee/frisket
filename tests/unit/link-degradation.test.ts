import { describe, expect, it } from 'vitest'
import { KERNEL_PATHS, PENDING_REASON, loadExport } from './helpers/pending'

/**
 * 链接误渲染防御
 *
 * ── 这条门禁来自竞品的真实缺陷 ──────────────────────────────────
 *
 * 竞品 atomic-editor 把 `[foo]`、`[文字]()` 这类**没有 URL 的引用式链接**
 * 也当作链接渲染，并隐藏了 `[]`。
 *
 * 后果是：用户在正文里随手写了个方括号（数组下标 `a[0]`、语气停顿、
 * 或者只是打了一半想删掉），回头一看方括号不见了，内容也变成了蓝色链接，
 * 但链接地址根本不存在 —— 点进去是坏的。
 *
 * 用户完全无法察觉自己写了什么，也无从修复。
 *
 * 这类缺陷能通过人工评审：截图上看「有个链接」，视觉上完全正常。
 * 只有把「无 URL 必须退化为纯文本」写成断言才拦得住。
 *
 * ── 判据 ──────────────────────────────────────────────────────
 *
 * 无 URL 定义时，`[` 与 `]` 必须保持可见。
 * 用「标记是否可见」而非「是否渲染为 <a>」作判据，是因为前者才是用户能感知的东西，
 * 且不依赖内部实现选择。
 *
 * ── 运行状态 ──────────────────────────────────────────────────
 *
 * 依赖 src/editor/live/guards.ts，当前未就绪，本文件整体 skip。
 * **尚未跑通**，不构成通过。
 */

interface GuardsApi {
  /**
   * 判断某个链接类语法是否有可用的 URL 定义。
   * @returns true 表示应渲染为链接；false 表示必须退化为纯文本
   */
  isResolvableLink(doc: string, from: number, to: number): boolean
}

const api = await loadExport<GuardsApi>(KERNEL_PATHS.guards, 'isResolvableLink')
const describeGuards = api === null ? describe.skip : describe

if (api === null) {
  describe.skip(`链接误渲染防御（${PENDING_REASON}）`, () => {
    it('占位', () => {
      expect(api).toBeNull()
    })
  })
}

/** 判定：在给定文档中，[from, to) 范围是否应当被当作链接渲染。 */
function resolvable(doc: string, from: number, to: number): boolean {
  return (api as GuardsApi).isResolvableLink(doc, from, to)
}

describeGuards('防御：短引用无 URL 定义时退化为纯文本', () => {
  it('[foo] 在无定义时不得被当作链接', () => {
    // 范围是 [foo] 里的 foo 部分
    expect(resolvable('[foo]', 1, 4)).toBe(false)
  })

  it('[bar] 在无定义时不得被当作链接', () => {
    expect(resolvable('[bar]', 1, 4)).toBe(false)
  })

  it('存在定义时应当被当作链接', () => {
    const doc = '[foo]\n\n[foo]: /url\n'
    expect(resolvable(doc, 1, 4)).toBe(true)
  })
})

describeGuards('防御：空 URL 括号退化为纯文本', () => {
  it('[文字]() 空目标不得被当作链接', () => {
    // 范围是「文字」部分
    expect(resolvable('[文字]()', 1, 3)).toBe(false)
  })

  it('[a]() 空目标不得被当作链接', () => {
    expect(resolvable('[a]()', 1, 2)).toBe(false)
  })
})

describeGuards('防御：普通文本中的方括号不得被误判为链接', () => {
  it('数组下标 a[0] 不是链接', () => {
    expect(resolvable('数组索引 a[0] 的用法', 6, 7)).toBe(false)
  })

  it('单独方括号 [ 不是链接', () => {
    expect(resolvable('这是 [ 单独方括号', 4, 5)).toBe(false)
  })

  it('空括号对 [] 不是链接', () => {
    expect(resolvable('空括号对 []', 5, 5)).toBe(false)
  })

  it('引用式链接无定义时不是链接', () => {
    expect(resolvable('[文字][未定义]', 1, 3)).toBe(false)
  })
})

describeGuards('防御：行内代码内的链接语法不得生效', () => {
  it('`[a](b)` 在行内代码内不得解析为链接', () => {
    expect(resolvable('`[a](b)`', 2, 3)).toBe(false)
  })

  it('`[]` 在行内代码内不得解析为链接', () => {
    expect(resolvable('`[]`', 1, 1)).toBe(false)
  })
})

describeGuards('防御：围栏代码块内的链接语法不得生效', () => {
  it('代码块内的 [a](b) 不得解析为链接', () => {
    const doc = '```\n[a](b)\n```\n'
    const from = doc.indexOf('[a]') + 1
    expect(resolvable(doc, from, from + 1)).toBe(false)
  })
})