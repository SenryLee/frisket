import type { CDPSession, Page } from '@playwright/test'

/**
 * IME 测试驱动
 *
 * 位置：门禁层。中文组合输入的三条防线都由这里驱动。
 *
 * ── 为什么必须双路径 ──────────────────────────────────────────
 *
 * 1. Chromium 走 CDP `Input.imeSetComposition`。这是真实 IME 通道 ——
 *    浏览器会真正进入 composing 状态、派发 composition 事件、
 *    走 CM6 的 InputDOMObserver。这是最接近真实用户的路径。
 *
 * 2. WebKit 走合成 CompositionEvent。**WebKit 不提供 CDP**，
 *    Playwright 的 newCDPSession 在 WebKit 上不可用（会抛错）。
 *    而 macOS 上的 Tauri WKWebView 用的是 WebKit，
 *    只测 Chromium 等于没测真实环境。
 *    退而求其次：用 dispatchEvent 派发真实的 CompositionEvent，
 *    CM6 的 contentDOM 监听器照样会被触发、照样进入 composing 状态，
 *    因此「组合输入期间装饰引擎动手改文档」这条丢字路径仍被覆盖。
 *    但它**不覆盖**浏览器原生 IME 的候选窗与按键协商 ——
 *    这部分缺口必须在报告里写明，不能假装等价。
 *
 * ── 一个关键陷阱 ──────────────────────────────────────────────
 *
 * `Input.imeSetComposition` 只「设置候选文本」，**不会提交**。
 * 规范给的说法是「用空字符串调用可取消」，提交需要另发一次调用。
 * 如果误以为 setComposition 就等于输入完成，测试会断言在一个从未落地的
 * 状态上 —— 表面通过，实际什么都没验。
 *
 * 因此本工具把 组合中 / 提交 / 取消 拆成三个显式方法，
 * 由调用方决定何时结束组合，断言才有可能验到最终文档。
 */

/** 一次组合输入的完整过程。 */
export interface CompositionStep {
  /** 候选文本，如 'n' → 'ni' → '你' */
  text: string
  /** 选区起点（相对组合文本） */
  selectionStart: number
  /** 选区终点 */
  selectionEnd: number
}

export type ImeDriverKind = 'cdp' | 'synthetic'

/**
 * 按浏览器选择驱动。
 *
 * 不靠 try/catch 探测 CDP 可用性 —— 失败路径的报错信息会被后续逻辑吞掉，
 * 静默退化成合成事件却不告知，读测试报告的人会以为测的是真实 IME。
 */
export function selectImeDriver(page: Page): ImeDriverKind {
  const browserName = page.context().browser()?.browserType().name()
  return browserName === 'webkit' ? 'synthetic' : 'cdp'
}

export interface ImeDriver {
  kind: ImeDriverKind
  /** 进入/更新组合输入状态。 */
  compose(step: CompositionStep): Promise<void>
  /** 提交组合文本，使其真正进入文档。 */
  commit(text: string): Promise<void>
  /** 取消组合文本，文档应恢复到组合前的状态。 */
  cancel(): Promise<void>
}

// ─────────────────────────────────────────────────────────────
// Chromium：CDP 路径
// ─────────────────────────────────────────────────────────────

/**
 * 用 CDP 真实驱动 IME。
 *
 * 注意 selectionStart/End 是**组合文本内部**的偏移，不是文档偏移。
 * 传错的话候选窗会落在错误位置，但内容仍可能「看起来对」，
 * 所以断言必须以文档内容为准，不能只看候选文本。
 */
async function createCdpDriver(page: Page): Promise<ImeDriver> {
  // 注意：newCDPSession 仅 Chromium 可用。此函数只应在 kind==='cdp' 时调用。
  const client: CDPSession = await page.context().newCDPSession(page)

  /**
 * 发一条 CDP 命令。
 *
 * Playwright 的 CDPSession.send() 类型签名是为浏览器协议里的
 * Input / Runtime 等少量 domain 手工写的联合类型，不接受任意字符串 ——
 * 直接传 `'Input.imeSetComposition'` 会被判为不属于 `keyof CommandParameters`。
 *
 * 但 Input domain 的方法确实存在于协议中（协议本身是开放的，
 * 只是 Playwright 的类型定义没有覆盖全）。所以这里做一次显式断言转换：
 * 我们已经用 grep 过protocol 定义，`imeSetComposition` 是真实存在的方法名。
 * 若某个引擎的版本没有它，会在运行期以「unknown method」报错，
 * 而不是被类型系统静默拦下 —— 那正是我们想要的失败方式。
 */
const send = (method: string, params: Record<string, unknown>): Promise<object> =>
  client.send(method as Parameters<CDPSession['send']>[0], params)

  return {
    kind: 'cdp',

    async compose(step: CompositionStep): Promise<void> {
      await send('Input.imeSetComposition', {
        text: step.text,
        selectionStart: step.selectionStart,
        selectionEnd: step.selectionEnd,
      })
    },

    async commit(text: string): Promise<void> {
      // imeSetComposition 不提交；insertText 才是落地的那一步。
      // 两者都发：insertText 会把仍在组合中的候选文本替换为最终文本。
      await send('Input.insertText', { text })
    },

    async cancel(): Promise<void> {
      // 规范：空文本的 imeSetComposition 表示取消组合。
      await send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })
    },
  }
}

// ─────────────────────────────────────────────────────────────
// WebKit：合成 CompositionEvent 路径
// ─────────────────────────────────────────────────────────────

/**
 * 浏览器内执行的合成事件脚本。
 *
 * ── 一个必须避开的坑：候选文本不能放进编辑器 ──────────────
 *
 * 最初的实现把候选项 `<span class="cm-composition-hold">` appendChild 到
 * `.cm-content` 里，结果候选文本被 CodeMirror 当作文档内容读入：
 *
 *   组合中[z    ]: "**粗体**z"
 *   组合中[zh   ]: "**粗体**zzh"← 累积而非替换
 *   组合中[zhong]: "**粗体**zzhzhozhong"
 *
 * 最后 commit 时这些残留文本仍在文档里，把末尾的 `**` 顶到中间，
 * 测试报「末尾 ** 丢失」—— 看起来像内核丢字，实际是驱动污染了文档。
 *
 * 所以候选项放在编辑器**之外**（挂在 body 上）。它只用于让
 * composition 事件带上 data，验证「装饰引擎在组合期间不动文档」；
 * 真正的落字交给 commit 时的 keyboard.insertText。
 *
 * 这条路径验的不是输入法行为是否正确（WebKit 无 CDP，做不到），
 * 而是**装饰引擎有没有在组合期间改文档** —— 那才是本项目
 * 真正会丢字的地方。
 */
function syntheticComposeScript(step: CompositionStep): void {
  const content = document.querySelector('.cm-content')
  if (!(content instanceof HTMLElement)) {
    throw new Error('找不到 .cm-content，无法派发合成组合事件')
  }

  content.focus()

  const isFirst = !content.dataset.composing
  if (isFirst) {
    content.dataset.composing = '1'
    content.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: step.text }))
  }

  content.dispatchEvent(
    new CompositionEvent('compositionupdate', { bubbles: true, data: step.text }),
  )

  // 候选项挂在 body 上而非编辑器内：CM6 会同步编辑器内的 DOM 文本。
  let holder = document.querySelector('.cm-composition-hold')
  if (holder === null) {
    const span = document.createElement('span')
    holder = span
    span.className = 'cm-composition-hold'
    span.setAttribute('contenteditable', 'false')
    span.style.display = 'none'
    document.body.appendChild(span)
  }
  holder.textContent = step.text
}

function syntheticCommitScript(text: string): void {
  const content = document.querySelector('.cm-content')
  if (!(content instanceof HTMLElement)) {
    throw new Error('找不到 .cm-content，无法提交合成组合事件')
  }

  // 提交：先把候选文本移除，再以 beforeinput/input 落地正式文本。
  // 顺序不能反 —— 反了会让 CM6 读到重复内容。
  const holder = document.querySelector('.cm-composition-hold')
  holder?.remove()
  delete content.dataset.composing

  content.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }))
}

/**
 * 用合成事件驱动 IME。
 *
 * 只派发 composition 事件而不模拟真实按键 —— 这是与 CDP 路径的已知差距，
 * 已在文件头注明。断言仍以文档内容为准，因此该路径下「不丢字」是可验的。
 */
async function createSyntheticDriver(page: Page): Promise<ImeDriver> {
  return {
    kind: 'synthetic',

    async compose(step: CompositionStep): Promise<void> {
      await page.evaluate(syntheticComposeScript, step)
    },

    async commit(text: string): Promise<void> {
      await page.evaluate(syntheticCommitScript, text)
      // 合成路径没有真正的输入通道，需要显式插入文本。
      // 用 keyboard.insertText 而非直接改 state：
      // 直接改 state 会绕过 CM6 的 transaction 管线，验不到丢字。
      //
      // 插入前先把原生选区对齐到 CM6 的光标 —— 否则浏览器原生选区
      // 可能停在别处，文本会插到错误位置（表现为标记被顶走）。
      await page.evaluate(() => {
        const bridge = (window as unknown as { __slate?: { getSelection?: () => { from: number } } }).__slate
        const from = bridge?.getSelection?.().from
        const content = document.querySelector('.cm-content')
        if (typeof from !== 'number' || !(content instanceof HTMLElement)) return
        content.focus()
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
        let remaining = from
        let node = walker.nextNode()
        while (node) {
          const len = node.textContent?.length ?? 0
          if (remaining <= len) {
            const range = document.createRange()
            range.setStart(node, remaining)
            range.collapse(true)
            const sel = window.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(range)
            return
          }
          remaining -= len
          node = walker.nextNode()
        }
      })
      await page.keyboard.insertText(text)
    },

    async cancel(): Promise<void> {
      await page.evaluate(() => {
        const content = document.querySelector('.cm-content')
        if (!(content instanceof HTMLElement)) return
        document.querySelector('.cm-composition-hold')?.remove()
        delete content.dataset.composing
        content.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
      })
    },
  }
}

/** 按浏览器创建对应驱动。 */
export async function createImeDriver(page: Page): Promise<ImeDriver> {
  return selectImeDriver(page) === 'cdp'
    ? createCdpDriver(page)
    : createSyntheticDriver(page)
}