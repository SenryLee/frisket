/**
 * 刷新信号 —— 让装饰层在样式或配置变更后主动重算
 *
 * 在整体中的位置：EditorHandle.refresh() 是外部唯一能强制重算的入口，
 * 它不能直接触碰 StateField（那需要拿到 field 引用并构造事务内部结构）。
 * 一个空 StateEffect 是 CodeMirror 提供的标准解耦手段：
 * 外部只管 dispatch，内部只管 is() 判断。
 *
 * 为什么不用 transaction.effects.length > 0 那条捷径：
 * EditorView.scrollIntoView 本身就是 effect，打字机模式每次滚动都会带一个。
 * 用「有 effect 就重建」会让滚动退化成全量重算，5k 行文档直接掉帧。
 */

import { StateEffect } from '@codemirror/state'
import type { StateEffect as StateEffectType } from '@codemirror/state'

/** 空效果。载荷无意义，存在本身即信号。 */
export const refreshEffect = StateEffect.define<null>()

/** 事务里是否带了刷新信号。 */
export function hasRefreshEffect(effects: readonly StateEffectType<unknown>[]): boolean {
  return effects.some((effect) => effect.is(refreshEffect))
}