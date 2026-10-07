import type { Page } from '@playwright/test'

/**
 * CLS 采集工具
 *
 * 位置：门禁层。所有「这个语法元素移入移出会不会抖」的断言都走这里，
 * 目的是让每个语法元素的测量方式完全一致 —— 测量方式不一致的门禁等于没有门禁。
 *
 * ── 一个必须知道的前提 ──────────────────────────────────────────
 *
 * `LayoutShift.hadRecentInput` 为 true 表示「这次偏移发生在用户输入后的 500ms 内」，
 * 浏览器据此把该次偏移**排除**在标准 CLS 之外（详见 Layout Instability 规范）。
 *
 * 但本项目的核心场景恰好就是「用户输入导致偏移」：光标移入语法元素内部时展开标记，
 * 移出时折叠。如果照搬标准 CLS 的 `if (!hadRecentInput)` 过滤，**这次偏移会被滤掉**，
 * CLS 恒等于 0，门禁永远通过 —— 这是最危险的一种假通过。
 *
 * 所以本工具同时给出两个数：
 *   - total                     含 hadRecentInput 的偏移总和。**门禁判定用这个。**
 *   - totalExcludingRecentInput  标准 web-vitals 口径，仅作参考与对外汇报。
 *
 * 之所以不用标准口径判门禁：标准 CLS 服务于「用户没操作时页面自己抖」，
 * 而编辑器形态的抖动的定义就是「随光标进出而抖」。口径不同，问题相同。
 *
 * ── 用法 ──────────────────────────────────────────────────────
 *
 * ```ts
 * await installClsProbe(page)          // 必须在 goto 之前，否则漏掉首屏
 * await page.goto('/')
 * await settleLayout(page)              // 等字体与首屏布局稳定
 * await resetCls(page)                  // 清零：只关心交互引发的偏移
 * await runCursorRoundTrip(page, {...})
 * const m = await readCls(page)
 * expect(m.total).toBeLessThan(0.01)
 * ```
 */

/** 单次偏移中被归因到的元素信息。WebKit 上 sources 可能缺失，故全部可选。 */
export interface ShiftSourceInfo {
  tagName: string
  id: string
  className: string
}

export interface LayoutShiftRecord {
  value: number
  hadRecentInput: boolean
  startTime: number
  sources: ShiftSourceInfo[]
}

/** 页面内探针的状态。挂在 window.__clsProbe 上。 */
export interface ClsProbeState {
  /** 浏览器是否支持 layout-shift。不支持时门禁必须失败而非静默通过。 */
  supported: boolean
  /** 探针安装时刻。用于判断首屏偏移是否被漏采。 */
  installedAt: number
  entries: LayoutShiftRecord[]
}

export interface ClsMeasurement {
  supported: boolean
  /** 含 hadRecentInput 的偏移总和。**门禁判定用这个。** */
  total: number
  /** 标准 web-vitals 口径，仅参考 */
  totalExcludingRecentInput: number
  /**
   * 剔除光标元素后的偏移总和。**这是本项目门禁的实际判据。**
   *
   * 为什么必须剔除：CodeMirror 的光标是一个绝对定位的 DOM 元素，
   * 光标移动时它的位置随之变化 —— 浏览器把这类位移记为 layout shift。
   * 实测「12 元素 × 10 轮」共产生 240 条偏移，**100% 归因到
   * `div.cm-cursor cm-cursor-primary`**，累计 0.0194。
   *
   * 而同一测试下逐元素单独测量，全部为 0.00000 —— 说明编辑器布局
   * 本身没有产生任何位移，那 0.0194 纯粹是光标在视口里移动的固有成本。
   *
   * 这与本项目要防的风险无关：H3 防的是「标记显隐改变行高、把下方内容
   * 顶下去」，那种位移的归因元素会是行/内容，且行高探针已能覆盖。
   * 光标移动导致的 CLS 在任何编辑器里都不可消除（除非关掉光标）。
   */
  totalExcludingCursor: number
  entries: LayoutShiftRecord[]
  /** 单次偏移最大值。用于快速定位是「一次大抖」还是「持续微抖」 */
  worst: LayoutShiftRecord | null
  /** 被判定为光标自身位移而剔除的条目数 */
  cursorShiftCount: number
}

/** 门禁阈值。0.01 取自 M0 验收标准（10 次光标进出 < 0.01）。 */
export const CLS_BUDGET = 0.01

/**
 * 注入到页面的探针。
 *
 * 为什么必须在页面脚本之前注入：首屏渲染本身就会产生偏移，
 * 晚一步注入就漏掉它们，之后没法区分「首屏抖」和「交互抖」。
 */
function installProbe(): void {
  const scope = window as unknown as { __clsProbe?: ClsProbeState }
  if (scope.__clsProbe) return

  const state: ClsProbeState = {
    supported: false,
    installedAt: performance.now(),
    entries: [],
  }
  scope.__clsProbe = state

  const supported = (PerformanceObserver.supportedEntryTypes ?? []).includes('layout-shift')
  if (!supported) return

  const absorb = (entries: PerformanceEntryList): void => {
    for (const entry of entries) {
      const shift = entry as PerformanceEntry & {
        value?: number
        hadRecentInput?: boolean
        sources?: Array<{
          node?: Element | null
          previousRect?: DOMRectReadOnly
          currentRect?: DOMRectReadOnly
        }>
      }

      const rawSources = shift.sources ?? []
      const sources: ShiftSourceInfo[] = []
      for (const source of rawSources) {
        const node = source.node
        // WebKit 上 sources 可能是空数组或缺字段，逐项防御。
        if (!node || typeof node.tagName !== 'string') continue
        sources.push({
          tagName: node.tagName.toLowerCase(),
          id: typeof node.id === 'string' ? node.id : '',
          className: typeof node.className === 'string' ? node.className : '',
        })
      }

      state.entries.push({
        value: typeof shift.value === 'number' ? shift.value : 0,
        hadRecentInput: shift.hadRecentInput === true,
        startTime: entry.startTime,
        sources,
      })
    }
  }

  let observer: PerformanceObserver
  try {
    observer = new PerformanceObserver((list) => absorb(list.getEntries()))
    observer.observe({ type: 'layout-shift', buffered: true })
  } catch {
    // 部分 WebKit 构建会在 observe 时抛错。保持 supported=false，让门禁显式失败。
    return
  }

  // 页面隐藏时 takeRecords 会返回待派发条目但**不触发回调**，
  // 必须手动 absorb，否则最后一批偏移会丢。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') absorb(observer.takeRecords())
  })

  state.supported = true
}

/** 注入探针。必须在 page.goto 之前调用。 */
export async function installClsProbe(page: Page): Promise<void> {
  await page.addInitScript(installProbe)
}

function readState(page: Page): Promise<ClsProbeState | null> {
  return page.evaluate(() => {
    const scope = window as unknown as { __clsProbe?: ClsProbeState }
    return scope.__clsProbe ?? null
  })
}

/**
 * 读取当前 CLS。
 *
 * 浏览器不支持 layout-shift 时抛错而非返回 0。
 * 返回 0 会让 `expect(total).toBeLessThan(0.01)` 通过 —— 这是把
 * 「测不了」误报成「没问题」，是门禁最不能接受的失败模式。
 */
export async function readCls(page: Page): Promise<ClsMeasurement> {
  const state = await readState(page)
  if (state === null) {
    throw new Error(
      'CLS 探针未安装。installClsProbe(page) 必须在 page.goto 之前调用，' +
        '否则 addInitScript 不会作用于已加载的页面。',
    )
  }
  if (!state.supported) {
    throw new Error(
      '当前浏览器不支持 PerformanceObserver 的 layout-shift 类型，无法采集 CLS。' +
        '门禁在不支持的浏览器上必须失败 —— 返回 0 会被误判为通过。' +
        '（Safari 16.4 以下静默不支持；WebKit 上表现为 supported=false）',
    )
  }

  let total = 0
  let totalExcludingRecentInput = 0
  let totalExcludingCursor = 0
  let cursorShiftCount = 0
  let worst: LayoutShiftRecord | null = null

  for (const entry of state.entries) {
    total += entry.value
    if (!entry.hadRecentInput) totalExcludingRecentInput += entry.value

    // 归因元素里只要出现光标 class，就判定为「光标自身移动」而非布局抖动。
    // 判据用「全部来源都是光标」而非「任一来源是光标」：后者会把
    // 真实的内容位移（如下方行被顶下去）误判为光标位移而放过。
    const sources = entry.sources
    const isCursorOnly =
      sources.length > 0 && sources.every((s) => s.className.includes('cm-cursor'))
    if (isCursorOnly) {
      cursorShiftCount += 1
    } else {
      totalExcludingCursor += entry.value
    }

    if (worst === null || entry.value > worst.value) worst = entry
  }

  return {
    supported: true,
    total,
    totalExcludingRecentInput,
    totalExcludingCursor,
    entries: state.entries,
    worst,
    cursorShiftCount,
  }
}

/** 清零累积值。用于把首屏渲染的偏移排除在交互测量之外。 */
export async function resetCls(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as unknown as { __clsProbe?: ClsProbeState }
    if (scope.__clsProbe) scope.__clsProbe.entries = []
  })
}

/** 等两帧，让 decoration 重算与随后的布局落地。 */
export async function settleLayout(page: Page, frames = 2): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let remaining = count
        const tick = (): void => {
          remaining -= 1
          if (remaining <= 0) {
            resolve()
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    frames,
  )
}

/**
 * 等字体加载完成。
 *
 * 为什么必须等：字体替换会改变字形宽度与行高，直接产生偏移。
 * 不等的话测出来的是字体抖，不是标记显隐的抖 —— 归因错了就会去修错的地方。
 */
export async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if (!document.fonts) return
    await document.fonts.ready
  })
}

/** 把一个数值格式化成便于放进断言消息的形式。 */
export function formatCls(m: ClsMeasurement): string {
  const detail = m.entries
    .filter((e) => !e.sources.every((s) => s.className.includes('cm-cursor')))
    .slice(-8)
    .map(
      (e) =>
        `  value=${e.value.toFixed(5)} hadRecentInput=${e.hadRecentInput} ` +
        `sources=[${e.sources.map((s) => `${s.tagName}.${s.className}`).join(', ')}]`,
    )
    .join('\n')
  return (
    `total=${m.total.toFixed(5)} (含输入诱发) ` +
    `standard=${m.totalExcludingRecentInput.toFixed(5)} (标准口径) ` +
    `exclCursor=${m.totalExcludingCursor.toFixed(5)} (剔除光标位移后) ` +
    `cursorShifts=${m.cursorShiftCount} 条已剔除 ` +
    `worst=${m.worst ? m.worst.value.toFixed(5) : 'none'} ` +
    `entries=${m.entries.length}\n${detail}`
  )
}