import type { Page } from '@playwright/test'

/**
 * 行高探针 —— 门禁一的主判据
 *
 * 位置：门禁层。所有「标记显隐是否会改变行高」的断言走这里。
 *
 * ── 为什么它比 CLS 更适合当主门禁 ──────────────────────────────
 *
 * 1. CLS 依赖 PerformanceObserver 的 `layout-shift`，而 MDN 兼容性表明确标注
 *    **Safari 全版本不支持**。macOS Tauri 用的正是 WKWebView ——
 *    Frisket 唯一的首发平台上，CLS 分数很可能根本采不到。
 *
 * 2. 更根本的问题是：CLS 分数是个**聚合的、间接的**指标。
 *    「CLS = 0.008」这句话无法指导修复，也无法指认是哪个语法元素在抖。
 *    而 H3 约束的真正含义是「标记显隐不改变行高」——
 *    这是一个可以直接测量、可以直接定位、跨引擎一致的事实。
 *
 * 3. 行高用 ResizeObserver 测量，不依赖任何性能 API，
 *    在任何引擎上行为一致。
 *
 * 因此本项目把「行高恒定」作为**主门禁**，CLS 分数降级为 chromium 上的辅助指标
 * —— 后者仍能反映滚动条跳动等更广的视觉抖动，是 CLS 唯一的独有价值。
 *
 * ── 为什么是精确相等而不是「变化很小」 ──────────────────────────
 *
 * 因为「行高由行 class 决定」是项目的 CSS 铁律：
 * 同一行在「标记展开」与「标记折叠」两种状态下，行高应当**完全相同**。
 * 允许 0.5px 的容差会让 font fallback 与亚像素舍入的噪声混进来，
 * 于是「+0.3px 的真实回归」也能通过 —— 那就退回到主观阈值了。
 *
 * 若实测发现浏览器在行高上存在亚像素抖动（极罕见），
 * 应改为断言「变化量 < 0.5px」并在注释里写明原因，而不是默默放宽。
 */

/** 单行的行高观测结果。 */
export interface LineObservation {
  /** 行在该文档中的位置标识（用行内文本或序号，稳定即可） */
  label: string
  /** 观测到的行高（px）。同一次测量的多次取样应完全一致。 */
  height: number
}

/** 一个语法元素的完整测量结果。 */
export interface LineHeightMeasurement {
  /** 探针是否成功运行（两个引擎都应恒为 true） */
  ok: boolean
  /** 展开状态下的行高，键为 label */
  expanded: Record<string, number>
  /** 折叠状态下的行高，键为 label */
  collapsed: Record<string, number>
  /**
   * 发生高度变化的行。空数组 = 通过。
   * 每项给出 label 与变化量（px）。
   */
  drifts: Array<{ label: string; delta: number; expanded: number; collapsed: number }>
  /** 最大变化量。0 表示完全稳定。 */
  maxDrift: number
}

/** 行高是否必须完全相等。若实测存在亚像素抖动，此处应改为 0.5。 */
export const LINE_HEIGHT_TOLERANCE = 0

/**
 * 注入页面的行高探针。
 *
 * 函数名带Injected 后缀是刻意的：这个函数会被字符串化后送进浏览器上下文执行，
 * 必须与 Node 侧的同名导出函数区分开 —— 否则 TS 会判定为重复实现，
 * 而 addInitScript 送进去的那个必须是**无依赖的纯函数**。
 *
 * 用 ResizeObserver 而非轮询：轮询会漏掉两次采样之间发生又复原的变化，
 * 而「抖动」恰恰可能只持续一两帧。ResizeObserver 在元素尺寸变化的那一刻回调，
 * 不会漏。
 */
function installLineHeightProbeInjected(): void {
  const scope = window as unknown as { __lineProbe?: { samples: number[] } }
  if (scope.__lineProbe) return
  scope.__lineProbe = { samples: [] }

  if (typeof ResizeObserver === 'undefined') return

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const element = entry.target as HTMLElement
      // borderBoxSize 才是含边框的实际占用尺寸。用 contentRect 会漏掉
      // 由 padding 引起的高度变化 —— 而 padding 正是 block widget 抖动的元凶。
      const box = entry.borderBoxSize?.[0]
      const height = box !== undefined ? box.blockSize : entry.contentRect.height
      const label = element.dataset.lhLabel ?? ''
      if (label === '') continue
      scope.__lineProbe?.samples.push(height)
    }
  })

  // 观察编辑区内所有带 data-lh-label 的元素（即行元素）
  const attach = (): void => {
    const rows = document.querySelectorAll('[data-lh-label]')
    for (const row of rows) observer.observe(row)
  }

  // 行元素会被虚拟滚动增删，需要持续扫描。
  // 用 MutationObserver 而非只扫一次：CodeMirror 只渲染视口内的行，
  // 滚动时新行进入 DOM，若不重新观察就漏掉了。
  const mutations = new MutationObserver(attach)
  mutations.observe(document.body, { childList: true, subtree: true })
  attach()
}

/** 注入行高探针。必须在 page.goto 之前调用。 */
export async function installLineHeightProbe(page: Page): Promise<void> {
  await page.addInitScript(installLineHeightProbeInjected)
}

/** 给页面里的行元素打上稳定标签，供探针识别。 */
export async function labelRows(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.cm-line'))
    rows.forEach((row, index) => {
      const text = (row.textContent ?? '').trim()
      // 标签优先用行内文本（对语法元素有辨识度），空行退化为序号
      row.setAttribute('data-lh-label', text.length > 0 ? text.slice(0, 40) : `empty-${index}`)
    })
    return rows.map(
      (row, index) => (row.textContent ?? '').trim().slice(0, 40) || `empty-${index}`,
    )
  })
}

/** 等两帧，让 ResizeObserver 的回调落地。 */
export async function settleMeasurement(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
}

/**
 * 读取当前所有行高。
 *
 * 注意：这里直接读 getBoundingClientRect 而不用 ResizeObserver 的回调结果。
 * 因为我们要断言的是「测量时刻的真实高度」，
 * 而 ResizeObserver 的回调列表只告诉你「曾经变过」——
 * 那会把「变了又变回来」也算成一次抖动，而最终视觉上并无偏移。
 */
export async function measureRowHeights(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const result: Record<string, number> = {}
    const rows = document.querySelectorAll('[data-lh-label]')
    for (const row of rows) {
      const label = row.getAttribute('data-lh-label')
      if (label === null) continue
      const height = row.getBoundingClientRect().height
      const existing = result[label]
      // 同一标签出现多次时取最大值：只要有一处不一致就算不一致，
      // 不能因为前面的恰好相同就放过后面的
      result[label] = existing === undefined ? height : Math.max(existing, height)
    }
    return result
  })
}

/**
 * 对比同一份文档在两种光标状态下的行高。
 *
 * @param labelRowsResult labelRows() 的返回值，即被观测的行
 */
export function compareHeights(
  labelRowsResult: readonly string[],
  expanded: Record<string, number>,
  collapsed: Record<string, number>,
): LineHeightMeasurement {
  const drifts: LineHeightMeasurement['drifts'] = []

  for (const label of labelRowsResult) {
    const a = expanded[label]
    const b = collapsed[label]
    if (a === undefined || b === undefined) continue
    const delta = Math.abs(a - b)
    if (delta > LINE_HEIGHT_TOLERANCE) {
      drifts.push({ label, delta, expanded: a, collapsed: b })
    }
  }

  drifts.sort((x, y) => y.delta - x.delta)

  let maxDrift = 0
  for (const d of drifts) {
    if (d.delta > maxDrift) maxDrift = d.delta
  }

  return { ok: true, expanded, collapsed, drifts, maxDrift }
}

/** 把测量结果格式化成便于放进断言消息的形式。 */
export function formatDrifts(m: LineHeightMeasurement): string {
  if (m.drifts.length === 0) return '所有行行高恒定'
  return m.drifts
    .slice(0, 8)
    .map(
      (d) =>
        `  「${d.label}」展开=${d.expanded.toFixed(2)}px 折叠=${d.collapsed.toFixed(2)}px 差=${d.delta.toFixed(2)}px`,
    )
    .join('\n')
}