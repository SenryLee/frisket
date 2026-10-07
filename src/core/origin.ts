/**
 * 变更来源标注 —— 内核与 UI / 原生层之间的「这次改动怎么来的」契约
 *
 * 在整体中的位置：core/editor.ts 打标注，editor.config.ts 的 updateListener 读出并回调。
 * 单独成文件是因为两端都需要它，而editor.ts 依赖 editor.config.ts ——
 * 标注放在这里才能打断这个循环依赖。
 *
 * 为什么用 Annotation 而不是 Transaction.userEvent：
 * userEvent 回答的是「这次输入来自哪个键位」，服务于默认键位的行为分支；
 * 我们要回答的是「这次改动该不该被 AI 撤销栈特殊对待」。
 * 两者语义不同，共用一个字段必然在某个场景下给出错误答案
 * （例如 AI 写回会派发带 userEvent 的事务，会被误判成用户手动输入）。
 */

import { Annotation } from '@codemirror/state'
import type { Transaction } from '@codemirror/state'
import type { ChangeOrigin } from '@/core/interfaces'

/** 变更来源标注。挂在事务上，随事务流转。 */
export const originAnnotation = Annotation.define<ChangeOrigin>()

/**
 * 从事务批次里读出变更来源。
 *
 * 一个 update 里可能有多条事务（如自动保存触发的连锁变更），
 * 取第一个带显式标注的；都没有则说明是用户直接输入，返回 null 让调用方决定默认值。
 */
export function readOrigin(transactions: readonly Transaction[]): ChangeOrigin | null {
  for (const transaction of transactions) {
    const origin = transaction.annotation(originAnnotation)
    if (origin !== undefined) return origin
  }
  return null
}