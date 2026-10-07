import type { Page } from '@playwright/test'

/**
 * E2E 测试桥（test bridge）
 *
 * 位置：门禁层 ↔ 被测应用的唯一通道。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────
 *
 * E2E 测试若直接操纵 CodeMirror 内部（`view.dispatch`、StateField 取值），
 * 会把测试焊死在实现细节上：内核一重构，全部测试一起报废，
 * 而报废原因跟「CLS 是否达标」毫无关系。
 *
 * 因此这里约定一个极小的表面：应用在 dev 模式下把 `window.__slate` 挂出来，
 * 只暴露 EditorHandle 已有的能力。测试只通过它驱动编辑器。
 *
 * ── 归属 ──────────────────────────────────────────────────────
 *
 * 我（qa）不实现它 —— 它属于 src/ 侧。
 * 已作为「请求变更」上报给 team-lead，由 editor-core / ui-shell 落地。
 * 在它就绪前，依赖它的用例会显式失败并说明原因，而不是静默跳过。
 */

/**
 * window.__slate 的**跨进程代理**形状。
 *
 * ── 为什么全部是 Promise ──────────────────────────────────────
 *
 * 页面里的 window.__slate 是同步对象，但测试不在页面里 ——
 * 每次调用都要跨 Playwright 的进程边界，因此**必然**是异步的。
 *
 * 这一点必须写进类型而不是靠 cast 掩盖：先前把类型写成同步返回，
 * 结果是 typecheck 报 4 处「Promise 不能赋给 boolean/string」，
 * 而修法若是用 as 强转，就会让「忘记 await」这类 bug 静默通过 ——
 * 那正是我先前已经踩过一次的坑（IPC 还在飞就测下一帧）。
 *
 * 与 src/core/interfaces.ts 的 EditorHandle 的关系：
 * EditorHandle 是**页面内**的同步接口，本接口是它的**远程代理**，
 * 语义一一对应，但多了一层 IPC，所以全部返回 Promise。
 */
export interface SlateTestBridge {
  /** 应用与编辑器是否已就绪 */
  ready(): Promise<boolean>
  /** 载入指定 Markdown 全文（替换整个文档） */
  setDoc(text: string): Promise<void>
  /** 读取当前全文 */
  getDoc(): Promise<string>
  /** 设置选区。from === to 表示纯光标 */
  setSelection(from: number, to?: number): Promise<void>
  /** 把光标移到指定字符偏移 */
  setCursor(offset: number): Promise<void>
  /** 聚焦编辑器。IME 测试必须先聚焦，否则组合输入不落在编辑器里 */
  focus(): Promise<void>
  /** 当前是否处于 IME 组合输入中 */
  isComposing(): Promise<boolean>
  /**
   * 触发主题切换。IME 场景三要用。
   * 传主题 id；不传则切到下一个。
   *
   * 可能为 undefined：内核不应依赖视觉层，故不保证实现（见 editor-core 的说明）。
   * 缺失时 IME 场景三会退化为「只做面板切换」，并在报告里标明未完整覆盖。
   */
  toggleTheme?(themeId?: string): Promise<void>
  /** 切换 AI 面板可见性。IME 场景三要用。同样可能未实现。 */
  toggleAiPanel?(): Promise<void>
}

/**
 * 门禁专用入口。
 *
 * 为什么不用应用正式首页：门禁要断言的是「编辑器的布局与输入行为」。
 * 若挂在正式 App 上，视觉层的任何改动（改 padding、换字体、调布局）都可能让门禁失败，
 * 而失败原因与门禁要测的东西无关 —— 这是最耗时间的假失败来源。
 *
 * gate.html 只挂内核、不挂 UI，因此门禁失败必然指向内核。
 * 这个文件由 ui-shell / editor-core 维护，不在我的所有权内。
 */
export const GATE_URL = '/gate.html'

/** 探针：桥是否已挂载。 */
export async function readBridge(page: Page): Promise<SlateTestBridge | null> {
  const has = await page.evaluate(() => {
    const scope = window as unknown as { __slate?: SlateTestBridge }
    return scope.__slate !== undefined && scope.__slate !== null
  })
  return has ? createProxiedBridge(page) : null
}

/**
 * 在页面上下文里调用桥的某个方法。
 *
 * ── 为什么必须这样做 ──────────────────────────────────────────
 *
 * 最初我写的是 `page.evaluate(() => window.__slate)`，
 * 想把整个桥对象取回 Node 侧调用。实测报`bridge.ready is not a function`。
 *
 * 原因：`page.evaluate` 的返回值经结构化克隆传回 Node，
 * **函数属性会被丢弃** —— 取回来只剩一个空壳对象。
 *
 * 改成每次调用都进页面执行一次 `evaluate`，函数在页面里执行完只回传返回值。
 * 代价是每次调用一次 IPC（约几毫秒），对门禁完全够用。
 */
async function callBridge<T>(
  page: Page,
  method: keyof SlateTestBridge,
  ...args: readonly unknown[]
): Promise<T> {
  return page.evaluate(
    ({ name, callArgs }) => {
      const scope = window as unknown as {
        __slate?: Record<string, ((...a: unknown[]) => unknown) | undefined>
      }
      const bridge = scope.__slate
      if (bridge === undefined || bridge === null) {
        throw new Error('window.__slate 测试桥未挂载')
      }
      const fn = bridge[name]
      if (typeof fn !== 'function') {
        throw new Error(
          `window.__slate.${String(name)} 不是函数（类型为 ${typeof fn}）。` +
            '测试桥接口与 src/test-utils/bridge.ts 的定义不一致。',
        )
      }
      return fn(...callArgs) as never
    },
    { name: method as string, callArgs: args as unknown[] },
  )
}

/** 构造一个把方法调用转发进页面的桥代理。 */
function createProxiedBridge(page: Page): SlateTestBridge {
  // 注意：每个方法都是 async，返回的是 Promise。
  // 调用方必须 await —— 否则 setDoc 这类会触发重排的调用还在飞，
  // 下一步的 settleLayout 就先跑了，测到的是空转。
  return {
    ready: () => callBridge<boolean>(page, 'ready'),
    setDoc: (text) => callBridge<void>(page, 'setDoc', text),
    getDoc: () => callBridge<string>(page, 'getDoc'),
    setSelection: (from, to) => callBridge<void>(page, 'setSelection', from, to),
    setCursor: (offset) => callBridge<void>(page, 'setCursor', offset),
    focus: () => callBridge<void>(page, 'focus'),
    isComposing: () => callBridge<boolean>(page, 'isComposing'),
    toggleTheme: (themeId) => callBridge<void>(page, 'toggleTheme', themeId),
    toggleAiPanel: () => callBridge<void>(page, 'toggleAiPanel'),
  }
}

/**
 * 取出桥，取不到就抛出可操作的错误。
 *
 * 为什么抛错而不是 test.skip：
 * skip 会让「桥没实现」和「门禁通过」在报告里长得一样（都是绿的），
 * 那正是我们要避免的。抛错会明确说：门禁尚未运行。
 */
export async function requireBridge(page: Page): Promise<SlateTestBridge> {
  const bridge = await readBridge(page)
  if (bridge === null) {
    throw new Error(
      'window.__slate 测试桥未挂载。\n' +
        '需要 gate.html 在 dev 模式下暴露一个满足 SlateTestBridge 的对象，' +
        `见 ${GATE_URL} 与 src/test-utils/bridge.ts 的接口定义。\n` +
        '在此之前，CLS / IME / perf 门禁无法运行 —— 请勿把本次结果当作通过。',
    )
  }
  // 这个 await 不能省：ready() 是跨进程调用，返回 Promise。
  // 漏了它就会拿 Promise 对象当布尔值判断，恒为 true —— 于是
  // 「未就绪」这个分支永远走不到，失去它本来的作用。
  if (!(await bridge.ready())) {
    throw new Error('window.__slate 已挂载但 ready() 为 false：应用尚未完成初始化。')
  }
  return bridge
}

/**
 * 打开门禁入口并等内核就绪。
 *
 * 为什么必须等：gate.html 里内核是通过 CustomEvent 异步装配的，
 * 页面 load 事件触发时 `window.__slate` 可能还没挂上。
 * 直接 goto 后立刻取桥会拿到 null，报错信息会指向「桥未实现」——
 * 而真实原因是「等早了」。这两种混淆会浪费大量排查时间。
 *
 * @param waitReady gate.html 暴露的额外就绪标志；不存在时退化为 __slate 就绪检查
 */
export async function openGate(page: Page, waitReady?: boolean): Promise<void> {
  await page.goto(GATE_URL)

  // 双保险：先等页面自己的就绪标志，再确认桥真的可用。
  await page.waitForFunction(
    (expectFlag) => {
      const scope = window as unknown as {
        __slate?: { ready?: () => boolean }
        __editorReady?: boolean
      }
      if (expectFlag && scope.__editorReady === true) return true
      return typeof scope.__slate?.ready === 'function' && scope.__slate.ready()
    },
    waitReady === true,
    { timeout: 15_000 },
  )

  await requireBridge(page)
}

/**
 * 在页面里执行一段操作，并保证期间不抛「桥不存在」。
 *
 * 用法：await withBridge(page, '载入测试文档', async (b) => b.setDoc(text))
 */
export async function withBridge<T>(
  page: Page,
  action: string,
  run: (bridge: SlateTestBridge) => Promise<T>,
): Promise<T> {
  const bridge = await requireBridge(page)
  try {
    return await run(bridge)
  } catch (error) {
    throw new Error(`${action} 失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 把一段 Markdown 读进编辑器并等待布局稳定。
 *
 * 为什么自己读文件而不用 page.goto：测试文档是构建产物的一部分，
 * 走 HTTP 拉取才能顺带验证「静态资源能被正确服务」；
 * 而编辑器是单页应用，切路由没有意义（见 main.ts 里的说明）。
 */
export async function loadDoc(page: Page, source: string): Promise<void> {
  await withBridge(page, '载入测试文档', async (bridge) => {
    bridge.setDoc(source)
    bridge.focus()
  })
}

/** 读取 fixtures 目录下的 .md 原文。 */
export async function readFixture(page: Page, name: string): Promise<string> {
  const response = await page.request.get(`/tests/fixtures/${name}`)
  if (!response.ok()) {
    throw new Error(`读取 fixture 失败：${name} → HTTP ${response.status()}`)
  }
  return response.text()
}