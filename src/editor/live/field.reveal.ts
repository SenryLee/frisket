/**
 * 展开层 StateField —— 维护「当前哪些元素显示源码」
 *
 * 在整体中的位置：reveal.ts 是纯算法，本文件把它接进 CodeMirror 事务体系。
 * 它不产生任何可见装饰，只提供一份可被其他字段查询的展开区集合。
 *
 * 为什么值得单独一个字段：展开态有多个消费者（样式层判断要不要上色、
 * 未来 M1 的表格 widget 判断自己在渲染态还是源码态）。算一次、多处读，
 * 避免出现「样式认为是渲染态、widget 认为是源码态」的分裂。
 */

import { StateField } from '@codemirror/state'
import type { EditorState, Transaction } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { computeRevealRegions, isRevealed } from './reveal'
import type { RevealRegion } from './reveal'

/** 空集常量。避免每次事务新建数组，减少无谓分配。 */
const NO_REGIONS: readonly RevealRegion[] = []

export const revealField = StateField.define<readonly RevealRegion[]>({
  create() {
    return NO_REGIONS
  },
  update(regions: readonly RevealRegion[], transaction: Transaction) {
    // 选区与正文都没动时展开态必然不变，跳过重算。
    // transaction.selection 只在事务显式设置选区时有值，
    // 这正是「光标确实动了」的准确信号。
    if (!transaction.docChanged && transaction.selection === undefined) return regions
    return computeRevealRegions(transaction.state)
  },
})

/** 读取当前展开区。字段一定存在，false 分支只是类型兜底。 */
export function revealRegions(state: EditorState): readonly RevealRegion[] {
  return state.field(revealField, false) ?? NO_REGIONS
}

/**
 * 宿主是否处于展开态。
 *
 * field.inline、样式层、未来 widget 共用此函数 —— 口径必须唯一，
 * 否则会出现「记号露出来了但样式还按折叠态渲染」这类半展开 bug。
 */
export function isHostRevealed(regions: readonly RevealRegion[], host: SyntaxNode): boolean {
  return isRevealed(regions, host.from, host.to)
}