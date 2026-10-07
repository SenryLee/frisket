import { expect, test } from '@playwright/test'
import {
  CLS_BUDGET,
  formatCls,
  installClsProbe,
  readCls,
  resetCls,
  settleLayout,
  waitForFonts,
} from '../../src/test-utils/cls'

/**
 * CLS 探针自验证
 *
 * ── 实测结论（2026-10，Playwright WebKit 26.0 / Chromium 1208）────────
 *
 * WebKit **确实不支持** `PerformanceObserver` 的 `layout-shift`：
 * `supportedEntryTypes` 里没有该类型，探针的 supported=false，
 * `readCls()` 按设计抛错。
 *
 * 这从实测确认了 CLS 不能当主门禁 —— Frisket 首发平台（macOS WKWebView）
 * 上它根本采不到。行高探针（line-height-probe.spec.ts）在同一引擎上通过。
 *
 * 所以本文件的作用也随之改变：**它是 chromium 上的辅助门禁**，
 * 保留下来是因为 CLS 分数能反映滚动条跳动等更广的视觉抖动，
 * 这是行高探针覆盖不到的。
 *
 * ── 这个文件为什么仍然存在 ────────────────────────────────────
 *
 * 一套 `expect(cls).toBeLessThan(0.01)` 的断言，在**探针坏掉**的时候也会通过 ——
 * 探针没装上、事件类型拼错、过滤器滤光，结果都是 0，测试绿。
 * 一个永远绿的门禁比没有门禁更危险。
 *
 * 所以这里用一个**故意写错**的页面（harness.html，block widget 整块替换）
 * 作为标尺：断言写成「必须测出偏移」。
 * 它通过 ⇒ 探针确实抓得到偏移 ⇒ chromium 上 CLS 门禁的绿灯是有意义的。
 *
 * 不依赖 src/editor/，因此可以在内核写完之前就运行。
 */

const HARNESS_URL = '/tests/fixtures/harness.html'

/** CLS 是否可用。WebKit 上为 false，此时整个 describe 跳过。 */
let clsSupported = false

test.beforeEach(async ({ page }) => {
  await installClsProbe(page)
  clsSupported = await page
    .evaluate(() => (PerformanceObserver.supportedEntryTypes ?? []).includes('layout-shift'))
    .catch(() => false)
})

test.describe('CLS 探针自验证（仅 Chromium —— WebKit 不支持 layout-shift）', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'WebKit 不支持 layout-shift，CLS 无法采集。主门禁是行高探针，见 line-height-probe.spec.ts。',
  )

  test('探针能捕捉到 block widget 造成的偏移（错误实现的对照组）', async ({ page }) => {
    test.skip(!clsSupported, '当前浏览器不支持 layout-shift')

    await page.goto(`${HARNESS_URL}?mode=block-widget`)
    await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true)
    await waitForFonts(page)
    await settleLayout(page, 3)

    // 确认走的是 block-widget 分支，否则下面的断言没有意义。
    const mode = await page.evaluate(
      () => (window as unknown as { harness: { currentMode(): string } }).harness.currentMode(),
    )
    expect(mode).toBe('block-widget')

    // 清零：只关心交互引发的偏移，不含首屏渲染。
    await resetCls(page)

    // 循环「光标移入语法元素内部 → 移出」，模拟真实编辑时的进出。
    for (let round = 0; round < 10; round += 1) {
      await page.evaluate((index) => {
        ;(window as unknown as { harness: { enter(i: number): void } }).harness.enter(index)
      }, round % 5)
      await settleLayout(page, 3)

      await page.evaluate(() => {
        ;(window as unknown as { harness: { exit(): void } }).harness.exit()
      })
      await settleLayout(page, 3)
    }

    const measurement = await readCls(page)

    // 核心断言：必须测到偏移。
    // 若这里为 0，说明探针坏了 —— 后面所有 CLS 门禁都是空转。
    expect(
      measurement.total,
      `block widget 实现理应产生明显偏移，但探针测到 ${formatCls(measurement)}。` +
        '若探针报 0，说明 layout-shift 采集链路已失效，CLS 门禁形同虚设。',
    ).toBeGreaterThan(CLS_BUDGET)

    // 反向确认：这个量级确实是「肉眼可见的抖动」，不是浮点噪声。
    expect(measurement.entries.length).toBeGreaterThan(0)
  })

  test('探针对零偏移的实现报接近 0（探针不会无差别报警）', async ({ page }) => {
    test.skip(!clsSupported, '当前浏览器不支持 layout-shift')

    await page.goto(`${HARNESS_URL}?mode=inline`)
    await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true)
    await waitForFonts(page)
    await settleLayout(page, 3)

    await resetCls(page)

    for (let round = 0; round < 10; round += 1) {
      await page.evaluate((index) => {
        ;(window as unknown as { harness: { enter(i: number): void } }).harness.enter(index)
      }, round % 5)
      await settleLayout(page, 3)

      await page.evaluate(() => {
        ;(window as unknown as { harness: { exit(): void } }).harness.exit()
      })
      await settleLayout(page, 3)
    }

    const measurement = await readCls(page)

    // 这条同样关键：探针不能对正确实现也报警，否则门禁会退化成
    // 「永远失败」，团队会习惯性忽略它 —— 那等于没有门禁。
    expect(
      measurement.total,
      `零宽标记的实现不应产生偏移，但测到 ${formatCls(measurement)}。` +
        '若探针对正确实现也报警，说明它在统计与光标进出无关的因素。',
    ).toBeLessThan(CLS_BUDGET)
  })

  test('浏览器不支持 layout-shift 时显式失败而非报 0', async ({ page }) => {
    await page.goto(HARNESS_URL)
    await page.waitForFunction(
      () => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true,
    )

    if (clsSupported) {
      // 支持的浏览器上，这条退化为「readCls 不抛错」。
      await expect(readCls(page)).resolves.toMatchObject({ supported: true })
      return
    }

    // 不支持时必须抛错。返回 0 会被 `toBeLessThan(0.01)` 判成通过。
    await expect(readCls(page)).rejects.toThrow(/不支持/)
  })
})