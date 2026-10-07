/**
 * IME 组合输入期间的行为 —— 三条措施的实现
 *
 * 在整体中的位置：field.inline.ts 在重建装饰集前先问本模块「现在能不能动」。
 * 本模块不产生任何装饰，只回答「该不该重算 / 该不该避开某段区间」。
 *
 * ── 为什么组合期是唯一危险期 ──────────────────────────────────
 * 组合输入（拼音打「你好」的过程）期间，用户每敲一个键文档都会变，
 * 而此时 DOM 里有一块**由输入法拥有**的选区。装饰集一旦在这期间被替换：
 *   1. CodeMirror 会重建该行的DOM，浏览器随之取消组合态
 *   2. 用户已经敲好的拼音被丢弃，表现为「丢字」
 *   3. 部分平台上组合窗会闪一下再重新弹出
 * 这三点都是不可接受的 —— 丢字是编辑器级的致命缺陷。
 *
 * ── 措施 A：组合期只 map 不重算 ────────────────────────────────
 * 组合期发生的文档变化，只把现有装饰集按changes 做坐标映射，
 * 完全不重新解析语法树。这样 DOM 结构不动，组合态自然不被破坏。
 * 代价是组合期间的折叠态是「过期的」，但那几毫秒用户看不到结果、
 * 只看得到自己正在打的拼音 —— 用短暂的视觉滞后换不丢字是明确的正收益。
 *
 * ── 措施 B：成对替换且边界避开光标 ─────────────────────────────
 * 即使在组合期，若某处仍需重算（例如组合结束后），
 * 也必须保证替换区间成对出现（`**` 与 `**` 一起），
 * 且**不跨越光标**。跨光标的 replace 会让光标落进被替换的区间里，
 * 表现为光标凭空消失或跳到行首 —— 用户会以为编辑器坏了。
 *
 * ── 措施 C：compositionend 后 rAF 强制重算 ────────────────────
 * 组合结束时浏览器的 selectionchange 事件时机不可靠，
 * 直接同步重算会拿到还没提交的 DOM。推迟到下一帧（rAF）
 * 是唯一能确保「输入法已经完全交还控制权」的时机。
 * 不重算的后果是折叠态停留在组合开始前 —— 用户会看到刚打完的`**` 一直露着。
 */

import { StateEffect, Transaction } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/**
 * 请求在下一帧重算装饰集。
 *
 * 用空载荷的 StateEffect 而非直接调 view.dispatch：前者能被
 * field.inline 的 update 正常拦截到，且天然被并入事务，
 * 不会与用户输入产生两次独立的更新。
 */
export const imeSettledEffect = StateEffect.define<null>()

/**
 * 事务是否处于组合输入期间。
 *
 * 判据是 userEvent 注解为 `input.type.compose` 家族 —— 这是 CodeMirror
 * 对组合输入事务的固定标记。用 view.composing 判是不对的：
 * 那是**视图**状态，StateField 里拿不到；且它在组合刚结束、
 * 事务还在队列里时就已经翻 false 了，时机上对不齐。
 *
 * 注意 userEvent 是 annotationType，必须用 Transaction.userEvent.is() 读，
 * 不能当普通属性访问 —— 它不在 Transaction 的实例字段上。
 */
export function isComposingTransaction(transaction: Transaction): boolean {
  const event = transaction.annotation(Transaction.userEvent)
  return event !== undefined && event.startsWith('input.type.compose')
}

/**
 * 措施 A 的判定：本次事务能否安全地重算装饰集。
 *
 * 返回 false 时调用方只做映射，不重新解析语法树。
 */
export function shouldDeferRebuild(transaction: Transaction): boolean {
  return isComposingTransaction(transaction)
}

/**
 * 措施 C 的调度器：在组合结束后的下一帧重算。
 *
 * 为什么用 rAF 而不是 setTimeout(0)：rAF 保证在浏览器完成本轮
 * 布局与绘制后执行，此时输入法已经完全交还了 DOM 控制权。
 * setTimeout 的执行时机不确定，可能早于输入法提交组合。
 *
 * 返回一个取消函数，视图销毁时必须调用 —— 否则会在已销毁的视图上
 * dispatch，那会抛异常并中断后续的清理逻辑。
 */
export function scheduleRebuildAfterComposition(view: EditorView): () => void {
  const handle = requestAnimationFrame(() => {
    // 视图可能已销毁：dispatch 到已销毁的 view 会抛
    if (view.dom.isConnected === false) return
    view.dispatch({ effects: imeSettledEffect.of(null) })
  })
  return () => cancelAnimationFrame(handle)
}

/**
 * 措施 B：区间是否与光标交叉。
 *
 * 用于在重算时跳过跨光标的替换区间 —— 宁可少折叠一个记号，
 * 也不能让光标消失。
 *
 * 注意边界用「开区间」比较：光标恰好停在记号起点或终点时不算交叉，
 * 因为那正是用户准备删除该记号的时刻，必须让它可见可操作。
 */
export function crossesSelection(state: EditorState, from: number, to: number): boolean {
  for (const range of state.selection.ranges) {
    // 有选区时，只要不是「选区完全包住本记号」，就视为交叉
    if (range.from < to && range.to > from) return true
  }
  return false
}

/**
 * 措施 B 的过滤：筛掉与光标交叉的记号。
 *
 * 只在重算路径上调用；组合期根本不重算（措施 A 已经拦下），
 * 所以这条不会影响组合期的性能。
 */
export function withoutCursorCrossing<T extends { from: number; to: number }>(
  state: EditorState,
  targets: readonly T[],
): T[] {
  return targets.filter((target) => !crossesSelection(state, target.from, target.to))
}
