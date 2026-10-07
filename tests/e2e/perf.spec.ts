import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { settleLayout, waitForFonts } from '../../src/test-utils/cls'
import { withBridge, openGate } from '../../src/test-utils/bridge'

/**
 * 门禁三：大文档滚动帧率
 *
 * M0 验收标准：5000 行文档滚动 FPS ≥ 55。
 *
 * ── 为什么用 requestAnimationFrame 计数而不是性能面板 ──────────
 *
 * 帧率必须在真实渲染循环里数。Chrome DevTools 的 Performance 面板
 * 能给帧，但需要人工操作、无法在 CI 里复现，也就无法当门禁。
 * rAF 回调由浏览器在每帧绘制前调用，计数即等价于帧数 ——
 * 简单、可自动化、且不会因为「测的是别的东西」而给出虚高结果。
 *
 * ── 阈值为什么是 55 而不是 60 ──────────────────────────────────
 *
 * 60fps 意味着每帧预算 16.67ms，而 CI 机器常被其他进程抢占。
 * 卡在 60 会出现大量与代码无关的偶发失败，久而久之团队会习惯性忽略这条门禁。
 * 55 留了一点余量，但仍足以拦住真正的性能问题：
 * 一个每帧耗时超过 18ms 的渲染循环，在 60fps 下掉帧、在 55fps 下也一样掉。
 *
 * 注意：这条门禁测的是「滚动过程中」的帧率。若解码性能不足导致掉帧，
 * 应当优化解析或视口裁剪，而不是放宽这个数字。
 */

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/large-5k.md')

/** 目标行数。与 gen-large.mjs 保持一致。 */
const EXPECTED_LINES = 5000

/** 帧率下限。 */
const MIN_FPS = 55

/** 滚动时长。取 2 秒：太短测不出持续掉帧，太长会让门禁变慢。 */
const SCROLL_MS = 2000

interface FpsResult {
  frames: number
  elapsedMs: number
  fps: number
}

test.describe('门禁三：大文档滚动帧率', () => {
  test.beforeEach(async ({ page }) => {
    await openGate(page, true)
    await waitForFonts(page)
  })

  test('5000 行文档滚动 FPS ≥ 55', async ({ page }) => {
    if (!existsSync(FIXTURE)) {
      throw new Error(
        `性能测试文档不存在：${FIXTURE}\n` +
          '请先执行：node tests/fixtures/gen-large.mjs',
      )
    }

    const doc = readFileSync(FIXTURE, 'utf8')
    const lineCount = doc.split('\n').length - 1
    expect(lineCount, '性能文档行数与 gen-large.mjs 的约定不符').toBe(EXPECTED_LINES)

    await withBridge(page, '载入 5000 行文档', async (b) => {
      await b.setDoc(doc)
      await b.focus()
    })
    await settleLayout(page, 5)

    // 用逐步推进 scrollTop 而非一次性跳到底：
    // 渐进滚动会逐帧触发 CodeMirror 的视口更新与 decoration 重算，
    // 一次性跳转只测得到绘制，测不到滚动过程中的解析开销 —— 那正是要防的退化。
    const result: FpsResult = await page.evaluate(
      ({ durationMs }) =>
        new Promise<FpsResult>((resolve) => {
          const scroller = document.querySelector('.cm-scroller') ?? document.scrollingElement
          if (scroller === null) {
            throw new Error('找不到滚动容器')
          }

          let frames = 0
          let start = 0
          let raf = 0

          const step = (now: number): void => {
            if (start === 0) start = now
            frames += 1

            const elapsed = now - start
            if (elapsed < durationMs) {
              scroller.scrollTop += 40
              raf = requestAnimationFrame(step)
              return
            }
            cancelAnimationFrame(raf)
            resolve({ frames, elapsedMs: elapsed, fps: (frames * 1000) / elapsed })
          }

          raf = requestAnimationFrame(step)
        }),
      { durationMs: SCROLL_MS },
    )

    // 留 3 帧余量补偿首帧与最后一帧的计时误差。
    // 不给余量的话这条门禁会变成「测 rAF 何时触发」而非测性能。
    expect(
      result.fps,
      `滚动帧率不足：${result.fps.toFixed(1)} fps ` +
        `（${result.frames} 帧 / ${result.elapsedMs.toFixed(0)} ms）。` +
        '排查方向：视口裁剪是否失效、decoration 是否全量重算、' +
        '大文档下 StateField 是否退化为 O(n)。',
    ).toBeGreaterThanOrEqual(MIN_FPS)
  })

  test('打开 5000 行文档应在 300ms 内完成首屏可交互', async ({ page }) => {
    if (!existsSync(FIXTURE)) {
      throw new Error(`性能测试文档不存在：${FIXTURE}，请先执行 node tests/fixtures/gen-large.mjs`)
    }
    const doc = readFileSync(FIXTURE, 'utf8')

    // 冷启动指标（M4 验收项）。放在 M0 是为了尽早暴露「打开大文档就卡」的架构问题：
    // 若解析策略需要重构，越早知道越好。
    //
    // 计时必须在浏览器侧做：requestAnimationFrame 只存在于浏览器，
    // 在 Node 侧调用会直接抛错。两帧等待用 page.evaluate 触发，
    // 它的往返时间不计入耗时（耗时以浏览器内的 performance 为准）。
    const elapsed = await page.evaluate(async (content) => {
      const scope = window as unknown as {
        __slate?: { setDoc(text: string): void; focus(): void }
      }
      const bridge = scope.__slate
      if (!bridge) {
        throw new Error('window.__slate 测试桥未挂载，无法测量打开耗时')
      }

      const started = performance.now()
      bridge.setDoc(content)
      bridge.focus()
      // 等两帧：首帧提交内容，次帧完成布局。此时才算「可交互」。
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
      return performance.now() - started
    }, doc)

    expect(
      elapsed,
      `打开 5000 行文档耗时 ${elapsed.toFixed(0)}ms，超过 300ms。`,
    ).toBeLessThan(300)
  })
})