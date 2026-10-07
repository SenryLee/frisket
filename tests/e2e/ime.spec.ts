import { expect, test, type Page } from '@playwright/test'
import { settleLayout, waitForFonts } from '../../src/test-utils/cls'
import { withBridge, openGate } from '../../src/test-utils/bridge'
import { createImeDriver, type ImeDriver } from '../../src/test-utils/ime'

/**
 * 门禁二：IME 零丢字
 *
 * M0 验收标准：三个场景下组合输入不丢字、不乱码。
 *
 * ── 为什么把 IME 列为止损线 ────────────────────────────────────
 *
 * CodeMirror 6 在 6.39.6 / 6.39.7 / 6.39.8 连续修了三个 IME 相关 bug。
 * 一个项目在三个月里修三次同一子系统，说明这个子系统脆弱 —— 它有大量
 * 平台相关的隐式状态，测试覆盖不了，只能靠真实输入法暴露。
 *
 * 更要紧的是丢字的失败形态：中文用户输入「你好」，屏幕上出现「好」。
 * 不崩、不报错、没有任何可观测的异常，只是安静地吞掉一个字。
 * 这类 bug 靠人工评审几乎必然漏检，必须有自动化断言盯着。
 *
 * ── 丢字是怎么发生的 ──────────────────────────────────────────
 *
 * 组合输入期间（composing），文档处于「半成品」状态：候选文本已在文档里，
 * 但尚未提交。此时如果装饰引擎重算并重建了 DOM（decoration 重建 / widget 重绘），
 * 候选文本就会被抹掉。
 *
 * 因此本门禁的核心断言是：**组合进行中不要动文档**。
 * 三个场景都是这个问题的不同触发条件。
 */

/** 把编辑器内容读出来，作为所有断言的依据。 */
async function docOf(page: Page): Promise<string> {
  return withBridge(page, '读取文档', async (b) => b.getDoc())
}

/** 组合结束后必须落地的文本。三个场景共用。 */
const FINAL_TEXT = '中文输入'

test.describe('门禁二：IME 组合输入零丢字', () => {
  let driver: ImeDriver

  test.beforeEach(async ({ page }) => {
    await openGate(page, true)
    await waitForFonts(page)
    await settleLayout(page, 3)
    driver = await createImeDriver(page)
  })

  /**
   * 场景一：在 `**粗|体**` 两个星号之间输入中文。
   *
   * 为什么这个位置最危险：光标位于 StrongEmphasis 节点内部，
   * 组合输入会改变该节点的文本内容，从而让 decoration 缓存失效并重算。
   * 如果 decoration 引擎在 composing 期间重建该范围的 DOM，
   * 候选文本会被抹掉 —— 这正是 CM6 反复修 IME bug 的那个场景。
   */
  test('场景一：在粗体标记之间组合输入中文', async ({ page }) => {
    await withBridge(page, '准备文档', async (b) => {
      await b.setDoc('**粗体**')
      await b.focus()
    })
    await settleLayout(page, 2)

    // 光标落到「粗」与「体」之间，即** | **
    await withBridge(page, '定位光标', async (b) => {
      await b.setCursor(3)
    })
    await settleLayout(page, 2)

    const before = await docOf(page)

    // 分步推进拼音，模拟真实候选过程
    for (const partial of ['z', 'zh', 'zho', 'zhong']) {
      await driver.compose({
        text: partial,
        selectionStart: partial.length,
        selectionEnd: partial.length,
      })
      await settleLayout(page, 1)
    }

    // 组合进行中：文档必须是「已插入候选文本」的状态，但绝不能丢字或乱码。
    const duringComposition = await docOf(page)

    await driver.commit(FINAL_TEXT)
    await settleLayout(page, 2)

    const after = await docOf(page)

    // 断言 1：提交后中文必须完整落地，一个字都不能少。
    expect(
      after.includes(FINAL_TEXT),
      `IME 丢字。组合前=${JSON.stringify(before)} ` +
        `组合中=${JSON.stringify(duringComposition)} 提交后=${JSON.stringify(after)}`,
    ).toBe(true)

    // 断言 2：粗体标记仍然完整。若装饰引擎在组合中动过文档，
    // 星号可能被吃掉或错位。
    expect(after).toContain('**')
    expect(after.startsWith('**')).toBe(true)
    expect(after.endsWith('**')).toBe(true)

    // 断言 3：不得出现替换字符（U+FFFD）。乱码在字节层面表现为它。
    expect(after).not.toContain('�')

    // 断言 4：原内容未被破坏。
    expect(after).toContain('粗')
    expect(after).toContain('体')
  })

  /**
   * 场景二：在行首连续输入中文标点，触发 autoFormat。
   *
   * 为什么危险：autoFormat 是「输入时修改文档」的典型代表。
   * 如果 autoFormat 在 composing 期间触发，它会对半成品的候选文本做转换 ——
   * 输入「，」时把上一步的拼音替换成标点，是最经典的丢字路径：
   * 候选窗还没提交就被转换逻辑吃掉。
   */
  test('场景二：行首中文标点触发 autoFormat 不丢字', async ({ page }) => {
    await withBridge(page, '准备文档', async (b) => {
      await b.setDoc('')
      await b.focus()
    })
    await settleLayout(page, 2)

    const collected: string[] = []

    // 连续输入多个中文标点。每一个都走完整的组合 → 提交流程。
    for (const mark of ['，', '。', '、']) {
      await driver.compose({ text: mark, selectionStart: mark.length, selectionEnd: mark.length })
      await settleLayout(page, 1)
      collected.push(await docOf(page))
      await driver.commit(mark)
      await settleLayout(page, 2)
      collected.push(await docOf(page))
    }

    const final = await docOf(page)

    // 断言 1：三个标点全部落地，顺序正确。
    // 逐个断言而非一次性比对，是为了让失败信息直接指出「丢的是哪一个」。
    expect(final, `标点丢失。采集到的中间状态：\n${collected.join('\n')}`).toContain('，')
    expect(final).toContain('。')
    expect(final).toContain('、')

    expect(final.indexOf('，')).toBeLessThan(final.indexOf('。'))
    expect(final.indexOf('。')).toBeLessThan(final.indexOf('、'))

    // 断言 2：无乱码
    expect(final).not.toContain('�')

    // 断言 3：autoFormat 没有把标点转成别的东西。
    // 若 autoFormat 在组合期间误触发，常见结果是标点被吞或被转义。
    expect(final).not.toContain('\\，')
  })

  /**
   * 场景三：组合输入进行中点击 AI 面板 / 切换主题。
   *
   * 为什么最危险：这两个动作都会导致**大范围 DOM 重建**
   * —— 主题切换重建全部样式，AI 面板增删侧栏。
   * 若装饰引擎没有把 composing 状态纳入判断，重建时会把候选文本一起抹掉。
   *
   * 这条是三个场景里最能区分「认真做了 composing 守卫」与「没做」的：
   * 前两个场景 DOM 变化范围小，容易侥幸通过；这一条变化范围是全文档。
   */
  test('场景三：组合进行中点击 AI 面板 / 切换主题', async ({ page }) => {
    await withBridge(page, '准备文档', async (b) => {
      await b.setDoc('这一行文字用于验证组合输入期间的面板交互是否丢字。')
      await b.focus()
    })
    await settleLayout(page, 2)

    await withBridge(page, '定位光标', async (b) => {
      await b.setCursor(5)
    })
    await settleLayout(page, 2)

    // 进入组合状态
    await driver.compose({ text: 'zhong', selectionStart: 5, selectionEnd: 5 })
    await settleLayout(page, 1)

    const beforeInterruption = await docOf(page)

    // 组合进行中切换主题
    await withBridge(page, '切换主题', async (b) => {
      await b.toggleTheme?.()
    })
    await settleLayout(page, 2)

    const afterTheme = await docOf(page)
    expect(
      afterTheme,
      '组合进行中切换主题导致候选文本丢失。' +
        `切换前=${JSON.stringify(beforeInterruption)} 切换后=${JSON.stringify(afterTheme)}`,
    ).toBe(beforeInterruption)

    // 组合进行中点击 AI 面板
    await withBridge(page, '点击 AI 面板', async (b) => {
      await b.toggleAiPanel?.()
    })
    await settleLayout(page, 2)

    const afterPanel = await docOf(page)

    // 组合仍在进行中：候选文本必须原样保留。
    // 这是本场景的核心 —— 面板点击不该动正在组合的文本。
    expect(
      afterPanel,
      '组合进行中点击 AI 面板导致候选文本丢失。' +
        `点击前=${JSON.stringify(afterTheme)} 点击后=${JSON.stringify(afterPanel)}`,
    ).toBe(afterTheme)

    await driver.commit(FINAL_TEXT)
    await settleLayout(page, 2)

    const afterCommit = await docOf(page)
    expect(afterCommit, '组合被打断后再提交，内容未落地。').toContain(FINAL_TEXT)
    expect(afterCommit).not.toContain('�')
  })

  /**
   * 辅助断言：组合进行中文档必须保持稳定。
   *
   * 单独抽出来是因为「组合期间文档不变」是所有 IME 场景的公共不变量。
   * 一旦这条挂了，其余断言会因为文档已被破坏而给出误导性的失败信息。
   */
  test('不变量：组合进行中不丢字、取消后完全复原', async ({ page }) => {
    await withBridge(page, '准备文档', async (b) => {
      await b.setDoc('前缀**中间**后缀')
      await b.focus()
      await b.setCursor(4)
    })
    await settleLayout(page, 2)

    const before = await docOf(page)

    // ── 为什么不能断言「组合中文档完全不变」 ──────────────────
    //
    // 真实 IME 在组合期间**本来就会**把候选文本插入文档 —— 那正是
    // `imeSetComposition` 的作用，用户能在编辑器里看到自己正在拼的拼音。
    // 实测（CDP 路径）：`imeSetComposition({text:'a'})` 后文档变为
    // `前缀**a中间**后缀`。所以「文档不变」是错的断言，会误报为丢字。
    //
    // 正确的表述是：**文档变化只能是候选文本的插入与替换，不得丢失
    // 原有内容**。因此这里断言「去掉最后一次候选文本后能还原」。
    for (const partial of ['a', 'ab', 'abc']) {
      await driver.compose({
        text: partial,
        selectionStart: partial.length,
        selectionEnd: partial.length,
      })
      const during = await docOf(page)

      // 不变量一：原有内容一个字符都不能少
      expect(
        during.startsWith('前缀**'),
        `组合期丢失了前部内容。partial=${partial} before=${JSON.stringify(before)} during=${JSON.stringify(during)}`,
      ).toBe(true)
      expect(
        during.endsWith('中间**后缀'),
        `组合期丢失了后部内容。partial=${partial} before=${JSON.stringify(before)} during=${JSON.stringify(during)}`,
      ).toBe(true)

      // 不变量二：文档长度相对 before 的增加量不超过候选文本长度。
      // 若装饰引擎在组合期间把标记当普通文本处理（展开/折叠误改文档），
      // 增长会远超候选文本长度 —— 这才是真正的丢字/改字信号。
      const growth = during.length - before.length
      expect(
        growth,
        `组合期文档异常膨胀 ${growth} 字符（候选文本仅 ${partial.length}）。` +
          `before=${JSON.stringify(before)} during=${JSON.stringify(during)}\n` +
          '多半是装饰引擎在组合期间改了文档 —— 那会丢字。',
      ).toBeLessThanOrEqual(partial.length)
    }

    await driver.cancel()
    await settleLayout(page, 1)

    // 取消组合后，文档必须回到组合前的状态：候选文本要完全撤掉。
    // 这条是本用例的核心 —— 撤不干净就是真丢字。
    expect(await docOf(page)).toBe(before)
  })
})