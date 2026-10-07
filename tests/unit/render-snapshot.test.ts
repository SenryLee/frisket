import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COMMONMARK_CASES } from '../fixtures/corpus-commonmark'
import { GFM_CASES } from '../fixtures/corpus-gfm'
import { KERNEL_PATHS, PENDING_REASON, loadExport } from './helpers/pending'

/**
 * 渲染快照：CommonMark + GFM 共 120+ 条
 *
 * M0 验收标准：CommonMark 60 条 + GFM 60 条渲染快照比对。
 *
 * ── 为什么用快照而不是逐字段断言 ──────────────────────────────
 *
 * 120 条语法用例，每条要断言「哪些标记被隐藏、可见文本是什么、行数多少」。
 * 写成显式断言就是 120 段高度重复的代码，真正想覆盖的差异被淹没。
 *
 * 快照把这 120 条的期望结果固化成一份可 review 的文件：
 * 渲染变了 → 快照 diff 展示「哪条语料的哪部分变了」→ 人来判断是否合理。
 * 这正是渲染引擎需要的审查方式。
 *
 * vitest 配了 `snapshotOptions.updateSnapshot: 'none'`，
 * 意味着快照不存在时会**失败**而不是自动写入 ——
 * 防止第一次运行时把当前（可能是错的）输出当成基准固化下来。
 *
 * ── 为什么额外保留结构化断言 ──────────────────────────────────
 *
 * 快照能告诉你「变了」，但不能告诉你「哪里错得不合规」。
 * 所以退化防御（`[]` 必须可见）另有一组显式断言，
 * 见 link-degradation.test.ts 与 empty-marker.test.ts。
 * 两者互补：快照管整体形状，显式断言管硬性底线。
 *
 * ── 运行状态 ──────────────────────────────────────────────────
 *
 * 依赖的渲染实现（src/editor/**）由内核子智能体开发中，当前不存在。
 * 本文件整体 skip。**尚未跑通**，不构成通过。
 * 快照文件需在首次真实运行时由 `vitest -u` 生成后人工 review。
 */

/** 被测的渲染结果描述。 */
interface RenderResult {
  /** 隐藏标记后用户看到的纯文本 */
  visibleText: string
  /** 被隐藏的标记 */
  hiddenMarkers: string[]
  /** 渲染后的行数 */
  lineCount: number
}

interface RenderApi {
  /** 渲染一段 Markdown，返回可见结果描述（不依赖具体 DOM 结构）。 */
  render(doc: string): RenderResult
}

const api = await loadExport<RenderApi>(KERNEL_PATHS.render, 'describeRender')
const describeRender = api === null ? describe.skip : describe

if (api === null) {
  describe.skip(`渲染快照（${PENDING_REASON}）`, () => {
    it('占位', () => {
      expect(api).toBeNull()
    })
  })
}

/**
 * 快照必须已存在，不允许自动生成。
 *
 * ── 为什么不能靠配置 ──────────────────────────────────────────
 *
 * 想「快照缺失即失败」最自然的做法是配 `snapshotOptions.updateSnapshot: 'none'`，
 * 但实测 vitest 3.2.4 里该字段不是合法的 UserConfig 项（只存在于内部
 * ResolvedConfig），写在配置中会报类型错误。
 *
 * 更关键的是：即便配了，它也只是**隐式行为** —— 有人删掉那行配置，
 * 门禁就会静默退化成「快照缺失即写入」，把当前（可能错误的）输出固化成基准，
 * 且没有任何提示。
 *
 * 所以改为在这里显式断言快照文件的存在性。配置能被删，断言不会。
 *
 * ── 为什么用 skipIf 而不是无条件断言 ──────────────────────────
 *
 * 内核尚未就绪时快照本就不该存在，此时断言它存在是**过早的失败**：
 * 它会让 `pnpm test` 在 M0 期间一直是红的，
 * 团队每天跑测试都看到同一个失败，最终学会无视它 ——
 * 那比没有这道断言更糟（狼来了效应）。
 *
 * 因此只在渲染实现就绪（即快照本该存在）时才断言。
 * 内核一落地、快照一生成，这条立刻生效。
 */
describe.skipIf(api === null)('快照基准必须已存在', () => {
  it('渲染快照文件已提交（缺失说明基准尚未建立）', () => {
    const snapshotDir = join(dirname(fileURLToPath(import.meta.url)), '__snapshots__')
    const exists = existsSync(snapshotDir) && readdirSync(snapshotDir).length > 0

    expect(
      exists,
      '渲染快照基准不存在。首次运行请执行 `pnpm test -u` 生成，' +
        '然后人工 review 快照内容 —— 自动生成的快照可能本身就是错的，' +
        '直接采信等于把当前行为当成正确行为。',
    ).toBe(true)
  })
})

describeRender('CommonMark 渲染快照', () => {
  for (const item of COMMONMARK_CASES) {
    it(`${item.spec} · ${item.name}`, () => {
      const result = (api as RenderApi).render(item.source)
      expect(
        result,
        `语料「${item.name}」渲染结果与快照不符。` +
          `若这是有意变更，人工确认后用 vitest -u 更新快照。`,
      ).toMatchSnapshot()
    })
  }
})

describeRender('GFM 渲染快照', () => {
  for (const item of GFM_CASES) {
    it(`${item.spec} · ${item.name}`, () => {
      const result = (api as RenderApi).render(item.source)
      expect(
        result,
        `语料「${item.name}」渲染结果与快照不符。` +
          `若这是有意变更，人工确认后用 vitest -u 更新快照。`,
      ).toMatchSnapshot()
    })
  }
})

// ── 结构化断言：不依赖快照的硬性底线 ────────────────────────────
//
// 这些断言在快照之外独立成立，因为它们对应的是「用户可见的功能缺陷」，
// 而不是「外观差异」。快照被人 review 放过一次就过去了，
// 显式断言则会在每次运行时都拦一次。

describeRender('底线：无 URL 的链接语法必须退化为纯文本', () => {
  const mustStayPlain: ReadonlyArray<{ doc: string; label: string }> = [
    { doc: '[foo]', label: '短引用无定义' },
    { doc: '[文字]()', label: '空 URL 括号' },
    { doc: '数组 a[0] 用法', label: '数组下标' },
    { doc: '空括号对 []', label: '空括号对' },
    { doc: '[文字][未定义]', label: '引用式无定义' },
  ]

  for (const { doc, label } of mustStayPlain) {
    it(`${label}：${JSON.stringify(doc)} 的方括号不得被隐藏`, () => {
      const result = (api as RenderApi).render(doc)
      // 括号若被隐藏，说明用户看不到自己写了什么 —— 竞品的已知缺陷
      expect(result.hiddenMarkers, `${label} 中的方括号被隐藏了，这是竞品已知的严重缺陷`).not.toContain('[')
      expect(result.hiddenMarkers).not.toContain(']')
    })
  }
})

describeRender('底线：空标记与未闭合标记必须可见', () => {
  const mustStayVisible: ReadonlyArray<{ doc: string; marker: string; label: string }> = [
    { doc: '#', marker: '#', label: '空标题' },
    { doc: '##', marker: '##', label: '二级空标题' },
    { doc: '**未闭合', marker: '**', label: '未闭合粗体' },
    { doc: '`未闭合', marker: '`', label: '未闭合行内代码' },
    { doc: '~~未闭合', marker: '~~', label: '未闭合删除线' },
  ]

  for (const { doc, marker, label } of mustStayVisible) {
    it(`${label}：${JSON.stringify(doc)} 的 ${marker} 不得被隐藏`, () => {
      const result = (api as RenderApi).render(doc)
      expect(result.hiddenMarkers, `${label} 的 ${marker} 被隐藏了：用户看不到自己敲了什么`).not.toContain(
        marker,
      )
    })
  }
})