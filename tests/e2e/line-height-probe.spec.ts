import { expect, test } from '@playwright/test'
import {
  compareHeights,
  formatDrifts,
  installLineHeightProbe,
  measureRowHeights,
  settleMeasurement,
} from '../../src/test-utils/line-height'

/**
 * 行高探针自验证
 *
 * ── 为什么它排在 CLS 自验证之前并成为主门禁 ────────────────────
 *
 * MDN 兼容性表标注 **Safari 全版本不支持 `layout-shift`**。
 * macOS Tauri 用的正是 WKWebView —— Slate 唯一的首发平台上，
 * CLS 分数很可能根本采不到。用一个采不到的指标当主门禁是自欺。
 *
 * 行高用 `getBoundingClientRect` 测，不依赖任何性能 API，双引擎一致。
 * 而且它比 CLS 更精确：CLS = 0.008 无法指导修复，
 * 「「粗体」展开 29.6px / 折叠 25.6px」能直接指出是哪个语法元素在抖。
 *
 * ── 这个文件的作用 ────────────────────────────────────────────
 *
 * 证明行高探针**抓得到**错误实现（第 1 条），
 * 且**不误报**正确实现（第 2 条）。
 * 这两条都成立，主门禁的绿灯才有意义。
 *
 * 不依赖 src/editor/，内核就绪前就能运行。
 */

const HARNESS_URL = '/tests/fixtures/harness.html'

/** harness 的 7 行。标签与 harness.html 里setAttribute 的格式一致。 */
const HARNESS_LABELS = Array.from({ length: 7 }, (_, index) => `line-${index}`)

/** 循环次数，与 cls.spec.ts 的 ROUNDS 保持一致。 */
const ROUNDS = 10

test.describe('行高探针自验证', () => {
  test.beforeEach(async ({ page }) => {
    await installLineHeightProbe(page)
  })

  test('探针能捕捉 block widget 造成的行高变化（错误实现的对照组）', async ({ page }) => {
    await page.goto(`${HARNESS_URL}?mode=block-widget`)
    await page.waitForFunction(
      () => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true,
    )
    await settleMeasurement(page)

    const mode = await page.evaluate(
      () => (window as unknown as { harness: { currentMode(): string } }).harness.currentMode(),
    )
    expect(mode).toBe('block-widget')

    // 折叠态行高
    await page.evaluate(() => {
      ;(window as unknown as { harness: { exit(): void } }).harness.exit()
    })
    await settleMeasurement(page)
    const collapsed = await measureRowHeights(page)

    // 展开态行高。逐行循环，覆盖所有 7 行。
    const expandedByRow: Record<string, number> = {}
    for (let round = 0; round < ROUNDS; round += 1) {
      const index = round % HARNESS_LABELS.length
      await page.evaluate((i) => {
        ;(window as unknown as { harness: { enter(n: number): void } }).harness.enter(i)
      }, index)
      await settleMeasurement(page)

      const heights = await measureRowHeights(page)
      for (const label of HARNESS_LABELS) {
        const h = heights[label]
        // 同一行可能被多次展开，取最大值即「最不稳定的那次」
        if (h !== undefined) {
          const seen = expandedByRow[label]
          expandedByRow[label] = seen === undefined ? h : Math.max(seen, h)
        }
      }

      await page.evaluate(() => {
        ;(window as unknown as { harness: { exit(): void } }).harness.exit()
      })
      await settleMeasurement(page)
    }

    const measurement = compareHeights(HARNESS_LABELS, expandedByRow, collapsed)

    // 核心断言：必须测出行高变化。
    // 若这里为 0，说明探针坏了 —— 主门禁形同虚设。
    expect(
      measurement.drifts.length,
      `block widget 实现理应改变行高，但探针测到「行高恒定」。${formatDrifts(measurement)}` +
        '若探针报 0，行高采集链路已失效，主门禁形同虚设。',
    ).toBeGreaterThan(0)

    // 进一步：变化量必须达到肉眼可见的量级（block widget 加了 20px padding）。
    // 若只有 0.1px 级别的差异，可能是浮点噪声而非真实抖动。
    expect(
      measurement.maxDrift,
      `行高变化量过小（${measurement.maxDrift.toFixed(3)}px），` +
        '疑似浮点噪声而非真实布局变化，自验证无效。',
    ).toBeGreaterThan(5)

    // 定位能力：必须能指认是哪些行在变，而不是只给一个总数。
    expect(measurement.drifts[0]?.label).toBeTruthy()
  })

  test('探针对零位移的实现不误报（正确实现的对照组）', async ({ page }) => {
    await page.goto(`${HARNESS_URL}?mode=inline`)
    await page.waitForFunction(
      () => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true,
    )
    await settleMeasurement(page)

    await page.evaluate(() => {
      ;(window as unknown as { harness: { exit(): void } }).harness.exit()
    })
    await settleMeasurement(page)
    const collapsed = await measureRowHeights(page)

    const expandedByRow: Record<string, number> = {}
    for (let round = 0; round < ROUNDS; round += 1) {
      const index = round % HARNESS_LABELS.length
      await page.evaluate((i) => {
        ;(window as unknown as { harness: { enter(n: number): void } }).harness.enter(i)
      }, index)
      await settleMeasurement(page)

      const heights = await measureRowHeights(page)
      for (const label of HARNESS_LABELS) {
        const h = heights[label]
        if (h !== undefined) {
          const seen = expandedByRow[label]
          expandedByRow[label] = seen === undefined ? h : Math.max(seen, h)
        }
      }

      await page.evaluate(() => {
        ;(window as unknown as { harness: { exit(): void } }).harness.exit()
      })
      await settleMeasurement(page)
    }

    const measurement = compareHeights(HARNESS_LABELS, expandedByRow, collapsed)

    // 这条同样关键：探针若对正确实现也报警，主门禁会退化成「永远失败」，
    // 团队会习惯性忽略它 —— 那等于没有门禁。
    expect(
      measurement.drifts.length,
      `零宽标记的实现不应改变行高，但测到：\n${formatDrifts(measurement)}` +
        '若探针对正确实现也报警，说明它在统计与标记显隐无关的因素。',
    ).toBe(0)
  })

  test('WebKit 上行高探针同样可用（不依赖 layout-shift）', async ({ page }, testInfo) => {
    await page.goto(`${HARNESS_URL}?mode=block-widget`)
    await page.waitForFunction(
      () => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true,
    )
    await settleMeasurement(page)

    // 无论哪个引擎，行高都必须测得到 —— 这是行高探针替代 CLS 的前提。
    const heights = await measureRowHeights(page)
    const measured = Object.keys(heights).length

    expect(
      measured,
      `行高探针在 ${testInfo.project.name} 上未能读到任何行高度。` +
        '若该引擎的 layout-shift 也不支持，CLS 门禁与行高门禁会同时失效，项目失去唯一的客观判据。',
    ).toBeGreaterThan(0)

    for (const [label, height] of Object.entries(heights)) {
      expect(height, `${label} 的行高应为正数，实际 ${height}`).toBeGreaterThan(0)
    }
  })
})