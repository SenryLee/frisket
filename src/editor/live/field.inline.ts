/**
 * 行内层 StateField —— 隐藏语法记号（CLS 生命线的直接实现者）
 *
 * 在整体中的位置：collect.ts 产出待隐藏清单，本文件把它变成 Decoration。
 * 这是三层里唯一「随光标频繁重算」的一层，因此也是 CLS 风险最集中的一层。
 *
 * ── CLS 纪律第一条的落法 ──────────────────────────────────────
 * 1. 折叠一律用 Decoration.replace({})。绝不用 height:0 / line-height:0 /
 *    display:none 作用于整行 —— 那会让行的盒模型在光标进出时塌陷又复原。
 * 2. 行高只由所在行的 CSS class 决定。`.cm-h1` 无论 `#` 显示与否，
 *    font-size 与 line-height 都是常量，由 theme.ts 一次性写死。
 * 3. 记号连同其后的空白一起折叠（见 collect.ts 的 widenForLeading）。
 *    否则 `#标题` 与 `# 标题` 两种写法折叠后起始列不同，切换写法时会横向抖动。
 *
 * 残留风险（如实记录，非遗留待办）：折叠确实减少了行的可用宽度，
 * 若某行恰好处于换行边界，收起记号可能让它从两行变一行，把下方内容顶上去。
 * 这需要该行文本长度恰好落在边界上才会发生，M0 用 Playwright 门禁实测；
 * 若实测超阈值，唯一正确的解法是给行首记号保留等宽占位，
 * 而不是改用 height:0（那会违反纪律第 1 条）。
 *
 * ── 为什么必须是 StateField 而不是 ViewPlugin 函数式提供 ──────
 * 函数式 decoration set 在视口计算之后才被调用。一旦其中含 block widget
 * 或跨行 replace，编辑器在调用前就已算好高度图，滚动条长度与命中测试都会错。
 * 本文件虽只产生行内 replace，仍走 StateField：它与选区强相关，
 * 走字段能拿到精确的变更区间，也便于未来 M1 的表格 widget 挂到同一层。
 */

import { StateField, RangeSetBuilder, EditorState } from '@codemirror/state'
import type { StateEffect, Transaction } from '@codemirror/state'
import { EditorView, Decoration, WidgetType } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import type { HideTarget } from './registry'
import { buildHideTargets, collectHosts } from './collect'
import { isHostRevealed, revealRegions } from './field.reveal'
import { hasRefreshEffect } from '../effects'
import { imeSettledEffect, shouldDeferRebuild, withoutCursorCrossing } from './ime'

/**
 * 水平线在折叠态是一根横杠。
 *
 * 这是本文件里唯一产生纵向影响的装饰，因此它必须留在 StateField 里
 * （纪律第二条）。它的替换是行内高度的，但行高由 CSS 常量决定，
 * 不会因为光标进出而变 —— 水平线不参与展开态，永远是这个样子。
 */
class RuleWidget extends WidgetType {
  override eq(): boolean {
    return true
  }

  override toDOM(): HTMLElement {
    const rule = document.createElement('span')
    rule.className = 'cm-md-rule'
    rule.setAttribute('aria-hidden', 'true')
    return rule
  }

  override ignoreEvent(): boolean {
    // 必须让点击穿透：用户要能把光标放回这一行
    return false
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const regions = revealRegions(state)
  const all = buildHideTargets(state, collectHosts(state), (host) =>
    isHostRevealed(regions, host),
  )
  // 措施 B：滤掉与光标交叉的记号。宁可少折叠一个，也不能让光标落进
  // 被替换的区间里消失 —— 那会让用户以为编辑器坏了
  const targets = withoutCursorCrossing(state, all)

  const builder = new RangeSetBuilder<Decoration>()
  for (const target of targets) {
    builder.add(target.from, target.to, decorationFor(target))
  }
  return builder.finish()
}

function decorationFor(target: HideTarget): Decoration {
  if (target.kind === 'rule') return Decoration.replace({ widget: new RuleWidget() })
  // 行内记号一律零宽折叠。宽度变化只发生在行内，不影响行的换行位置，
  // 因此不会产生纵向位移（见文件头 CLS 说明）
  return Decoration.replace({})
}

/**
 * 是否值得为本次事务重建装饰集。
 *
 * 判据是 transaction.selection !== undefined：只有事务**显式设置**选区时才算。
 * 注意不能用「选区结果与之前不同」来判断 —— 那要额外比较，
 * 而 selection 字段恰好就是 CodeMirror 给出的显式意图。
 *
 * 不看 transaction.effects.length：scrollIntoView 这类 effect 在每次滚动时都会出现，
 * 用它做触发条件会把「滚动」退化成「全量重算」，5k 行文档直接掉帧。
 * 只有 refreshEffect 与 imeSettledEffect 是真正的重算请求。
 */
function shouldRebuild(transaction: Transaction): boolean {
  return (
    transaction.docChanged ||
    transaction.selection !== undefined ||
    hasRefreshEffect(transaction.effects) ||
    hasImeSettledEffect(transaction.effects)
  )
}

export const inlineField = StateField.define<DecorationSet>({
  create: buildDecorations,
  update(current: DecorationSet, transaction: Transaction) {
    if (!shouldRebuild(transaction)) return current

    // ── IME 措施 A：组合期只 map 不重算 ──────────────────────────
    // 重新解析语法树会重建该行 DOM，浏览器随之取消组合态，
    // 用户已敲好的拼音被丢弃（丢字）。这里只按 changes 做坐标映射，
    // DOM 完全不动，组合态自然保住。代价是这几毫秒折叠态略滞后，
    // 而用户此时只看得到自己正在打的拼音，看不到渲染结果。
    if (shouldDeferRebuild(transaction)) {
      return current.map(transaction.changes)
    }

    return buildDecorations(transaction.state)
  },
  provide: (field) => EditorView.decorations.from(field),
})

/** compositionend 后由 mountEditor 派发，触发一次延迟重算（措施 C）。 */
function hasImeSettledEffect(effects: readonly StateEffect<unknown>[]): boolean {
  return effects.some((effect) => effect.is(imeSettledEffect))
}

/**
 * 渲染结果的纯数据描述 —— 供快照比对，不暴露任何内部实现。
 *
 * ── 设计原则：描述「可见结果」而非「怎么实现的」 ──────────────
 * 返回的是用户看到什么、什么被藏起来了，不含 decoration 类型、
 * widget 类名、CSS class。这样内核将来把 replace 换成 widget、
 * 或改掉所有 class 名，qa 的快照都不会跟着一起报废。
 *
 * 这一点比看起来重要：快照测试的价值在于「渲染结果变了能被发现」，
 * 一旦它绑死了实现细节，实现重构就会伪装成「渲染变了」，
 * 逼着人花时间去审查其实没问题的 diff。
 */
export interface RenderDescription {
  /** 隐藏标记后用户看到的纯文本 */
  readonly visibleText: string
  /** 被隐藏的标记，按出现顺序 */
  readonly hiddenMarkers: string[]
  /** 当前展开（未隐藏）的标记，按出现顺序 */
  readonly shownMarkers: string[]
  /** 渲染后的行数 */
  readonly lineCount: number
}

/**
 * 渲染一段 Markdown，返回可见结果描述。
 *
 * 用默认偏好、空光标建State —— 即「没人把光标放进去时」的样子，
 * 这正是快照该断言的基线形态。
 */
export function describeRender(doc: string): RenderDescription {
  const state = EditorState.create({
    doc,
    selection: { anchor: 0 },
    extensions: [markdown({ addKeymap: false, extensions: [...GFM] })],
  })
  return describeState(state)
}

/** 对已有state 求描述。内部复用，便于单测注入自定义光标位置。 */
export function describeState(state: EditorState): RenderDescription {
  const hidden = buildHideTargets(state, collectHosts(state), () => false)
  const spans = hidden.map((target) => [target.from, target.to] as const)

  return {
    visibleText: applyHiding(state.doc.toString(), spans),
    hiddenMarkers: hidden.map((target) => state.doc.sliceString(target.from, target.to)),
    shownMarkers: collectShownMarkers(state, spans),
    lineCount: state.doc.lines,
  }
}

/**
 * 剩余可见文本 = 全文减去被隐藏的区间。
 *
 * 不用装饰集反推：那样会把 widget（水平线）也当成「替换掉了」，
 * 而 widget 实际仍然可见（它就是那根线）。直接按区间剔除更贴近用户所见。
 */
function applyHiding(text: string, spans: readonly (readonly [number, number])[]): string {
  let result = ''
  let cursor = 0
  for (const [from, to] of spans) {
    if (from > cursor) result += text.slice(cursor, from)
    cursor = Math.max(cursor, to)
  }
  return result + text.slice(cursor)
}

/**
 * 当前可见的标记。
 *
 * 取全文里所有已知记号片段，减去被隐藏的那些。
 * 这样快照能捕捉「展开态下的记号可见性」，而不只是折叠态。
 */
function collectShownMarkers(
  state: EditorState,
  hidden: readonly (readonly [number, number])[],
): string[] {
  const markers: string[] = []
  for (const [name, symbol] of MARKER_SYMBOLS) {
    let pos = state.doc.toString().indexOf(symbol)
    while (pos !== -1) {
      const covered = hidden.some(([from, to]) => pos >= from && pos + symbol.length <= to)
      if (!covered) markers.push(name)
      pos = state.doc.toString().indexOf(symbol, pos + 1)
    }
  }
  return markers
}

/**
 * render 的别名。
 *
 * 存在的唯一理由：门禁的 render-snapshot.test.ts 用
 * `loadExport(path, 'describeRender')` 拿到对象后调 `api.render(doc)`，
 * 两者名字不一致。这里同时提供两个名字，让「按describeRender 查」与
 * 「按 render 调用」两种用法都成立，避免为了迁就测试而改内核的主命名。
 * 两者指向同一实现，不存在行为分叉。
 */
export const render = describeRender

/** 参与「可见标记」统计的记号符号。顺序即报告顺序，稳定不跳动。 */
const MARKER_SYMBOLS: ReadonlyArray<readonly [string, string]> = [
  ['heading', '#'],
  ['strong', '**'],
  ['emphasis', '*'],
  ['strike', '~~'],
  ['code', '`'],
  ['link', '['],
]