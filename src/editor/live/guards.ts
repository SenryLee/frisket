/**
 * 渲染防御 —— 在隐藏任何记号之前先回答「这条语法真的能折叠吗」
 *
 * 在整体中的位置：syntax.ts 遍历语法树时逐个记号调用本文件的守卫。
 * 守卫的立场是保守的：判断不了就不隐藏。漏隐藏只是不够好看，
 * 错隐藏会让用户丢内容或看到错误的排版，后者不可接受。
 */

import type { Text } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

/** 零宽与不可见字符：折叠与否都看不见，判定「空」时必须一并剥掉。 */
const INVISIBLE = /[\s­-‏‪-‮⁠-⁤⁦-⁯﻿]/gu

/** 只含空白与零宽字符。 */
export function isBlank(text: string): boolean {
  return text.replace(INVISIBLE, '') === ''
}

/**
 * 链接误渲染防御。
 *
 * lezer 会把 `[foo]`（快捷引用链接）也解析成 Link 节点。若照常折叠方括号，
 * 用户看到的就只剩 `foo`，与本意（一个还没填定义的引用）完全不同。
 * 因此只在 Link 内含 URL 子节点 —— 即行内链接 `[text](url)` —— 时才允许折叠。
 */
export function isInlineLink(node: SyntaxNode): boolean {
  return node.getChild('URL') !== null
}

/**
 * 空标记渐进披露。
 *
 * 折叠后的可见内容为空时（如 `##`、`[]()`），保持源码可见：
 * 用户需要看见自己站在哪个容器里，否则会以为光标丢了。
 *
 * 单记号宿主（ATX 标题只有 HeaderMark）的内容区是「记号之后到宿主结尾」，
 * 不能按双记号那套「首个记号尾 → 末个记号头」来算，否则恒为空。
 */
export function isEmptyHost(doc: Text, node: SyntaxNode, marks: readonly SyntaxNode[]): boolean {
  if (marks.length === 0) return false
  const first = marks[0]
  if (first === undefined) return false

  if (marks.length === 1) {
    return isBlank(doc.sliceString(first.to, node.to))
  }
  const last = marks[marks.length - 1]
  if (last === undefined) return false
  return isBlank(doc.sliceString(first.to, last.from))
}

/**
 * 围栏代码块的记号防御。
 *
 * 未闭合的围栏（``` 开头没有结尾）里 CodeMark 只有一个。此时折叠掉它，
 * 用户会以为代码块已经结束，实际却还在里面 —— 所以数量不为 2 时不折叠。
 */
export function isBalancedFence(marks: readonly SyntaxNode[]): boolean {
  return marks.length === 2
}

/**
 * 引用块记号的相邻性防御。
 *
 * 引用块的 QuoteMark 只出现在各行行首。若某个 QuoteMark 前面不是行首，
 * 说明它不是真正的引用前缀（可能是被内联引用的边界情况），不折叠。
 */
export function isAtLineStart(doc: Text, from: number): boolean {
  if (from === 0) return true
  return doc.lineAt(from).from === from
}

/**
 * 行内链接的 URL 防御。
 *
 * `[text]()` 与 `[text](  )` 这类空目标折叠后等于删掉用户刚输入的括号，
 * 保留括号让用户看到「目标还没填」。
 */
export function hasNonBlankTarget(doc: Text, node: SyntaxNode): boolean {
  const url = node.getChild('URL')
  if (url === null) return false
  return !isBlank(doc.sliceString(url.from, url.to))
}

/*
 * ── 门禁测试入口 ──────────────────────────────────────────────
 * 下面两个 re-export 是给纯数据单测用的：qa 的守卫用例以
 * (doc: string, from, to) 调用它们，不构造 EditorState 也不起视图。
 * 实现在 text-syntax.ts —— 那里做的是同一套语义判定的文本版实现。
 *
 * 为什么不直接把文本版实现写在 guards.ts 里：guards.ts 的其他函数
 * 都吃 Text / SyntaxNode，混进一个纯字符串函数会让「本文件的入参约定」
 * 变得不一致，读代码时无法一眼看出哪个能用。
 */

export { isResolvableLink, shouldHideRange } from './text-syntax'