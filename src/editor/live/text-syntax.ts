/**
 * 文本级语法判定 —— 不依赖 EditorState 的纯字符串分析
 *
 * 在整体中的位置：与 guards.ts（语法树级）平行的一层。
 * 门禁测试要在没有视图、没有语法树的纯数据上跑判定，
 * 而 EditorState 版的守卫需要 markdown语言包才能工作 —— 那让单测必须先起语言包，
 * 失败时只能得到「跳过」而非「失败」。
 *
 * 两层的一致性保证：两者共用同一套语义定义（成对记号、围栏配对、代码区排除），
 * 且都以「宁可漏隐藏，不可错隐藏」为底线 —— 漏隐藏只是不够好看，
 * 错隐藏会让用户看不见自己敲了什么，是竞品已被验证的严重缺陷。
 *
 * ── 为什么文本扫描在这个场景是安全的 ──────────────────────────
 * 这里的输入都是**单行或结构极简单**的片段（`# 标题`、`**粗体**`、`[foo]`），
 * 不是完整文档的逐字分析。对这类片段，扫描记号配对的结果与
 * lezer 的解析结果一致。真正复杂的嵌套（跨行容器、多层引用）
 * 仍由语法树层负责，文本层不越界。
 */

/** 代码区（行内代码 / 围栏代码）判定。命中则其内一切语法不生效。 */
export interface CodeSpan {
  readonly from: number
  readonly to: number
  readonly fenced: boolean
}

/** 找出文档里所有代码区。围栏按行首配对，行内代码按反引号配对。 */
export function findCodeSpans(doc: string): CodeSpan[] {
  const spans: CodeSpan[] = []
  let pos = 0

  while (pos < doc.length) {
    const lineEnd = indexOfLineEnd(doc, pos)

    if (doc.startsWith('```', pos)) {
      const close = doc.indexOf('```', pos + 3)
      const end = close === -1 ? doc.length : close + 3
      spans.push({ from: pos, to: end, fenced: true })
      pos = end
      continue
    }

    // 行内代码：跳过已落在围栏内的反引号
    if (doc[pos] === '`') {
      const close = doc.indexOf('`', pos + 1)
      if (close === -1) {
        pos = lineEnd
        continue
      }
      spans.push({ from: pos, to: close + 1, fenced: false })
      pos = close + 1
      continue
    }
    pos += 1
  }
  return spans
}

function indexOfLineEnd(doc: string, from: number): number {
  const found = doc.indexOf('\n', from)
  return found === -1 ? doc.length : found
}

/** 只取围栏代码区。行内代码的反引号是待折叠的记号，不能算作「代码区内部」。 */
function findFencedSpans(doc: string): CodeSpan[] {
  return findCodeSpans(doc).filter((span) => span.fenced)
}

function insideAny(spans: readonly CodeSpan[], from: number, to: number): boolean {
  return spans.some((span) => from < span.to && to > span.from)
}

/**
 * 行内链接是否有可用的 URL 定义 —— 链接误渲染防御。
 *
 * 四条判定规则，任一不满足即退化为纯文本：
 *   1. 范围必须落在代码区外 —— `` `[a](b)` `` 里的括号不是链接
 *   2. 必须在完整的 `[文字]` 结构内
 *   3. `]` 之后若跟 `(...)`，括号内必须有非空目标
 *   4. `]` 之后若跟 `[ref]` 或什么都不跟（短引用），
 *      必须在文档里能找到 `[文字]: url` 的定义行
 *
 * @param doc 全文
 * @param from 范围起点（通常是链接文字部分）
 * @param to 范围终点
 * @returns true 表示应渲染为链接；false 表示必须退化为纯文本
 */
export function isResolvableLink(doc: string, from: number, to: number): boolean {
  const spans = findCodeSpans(doc)
  if (insideAny(spans, from, to)) return false

  const bracketOpen = findEnclosing(doc, '[', ']', from, to)
  if (bracketOpen === null) return false

  const afterBracket = bracketOpen.close + 1
  if (doc[afterBracket] === '(') {
    const closeParen = doc.indexOf(')', afterBracket)
    if (closeParen === -1) return false
    return !isBlank(doc.slice(afterBracket + 1, closeParen))
  }
  return hasLinkDefinition(doc, doc.slice(bracketOpen.open + 1, bracketOpen.close))
}

/** 找到包住 [from, to) 的最近一层 [ ]配对。找不到返回 null。 */
function findEnclosing(
  doc: string,
  open: string,
  close: string,
  from: number,
  to: number,
): { open: number; close: number } | null {
  let depth = 0
  let openIndex = -1

  for (let pos = from; pos >= 0; pos -= 1) {
    const char = doc[pos]
    if (char === close) depth += 1
    else if (char === open) {
      if (depth === 0) {
        openIndex = pos
        break
      }
      depth -= 1
    }
  }
  if (openIndex === -1) return null

  let closeIndex = -1
  depth = 0
  for (let pos = openIndex + 1; pos < doc.length; pos += 1) {
    const char = doc[pos]
    if (char === open) depth += 1
    else if (char === close) {
      if (depth === 0) {
        closeIndex = pos
        break
      }
      depth -= 1
    }
  }
  // 半个括号（数组下标a[0] 里只有 `[`）不算链接
  if (closeIndex === -1 || closeIndex < to) return null
  return { open: openIndex, close: closeIndex }
}

/**
 * 文档里是否存在 `[文字]: url` 形式的定义。
 *
 * 只比对文字部分：CommonMark 的链接定义里 label 大小写不敏感，
 * 但空白与换行规则复杂（可跨行、可多行），此处按单行精确匹配 ——
 * 宁可漏判（退化为纯文本，用户手动补全）也不误判（把普通括号当链接）。
 */
function hasLinkDefinition(doc: string, label: string): boolean {
  const trimmed = label.trim()
  if (trimmed === '') return false
  const pattern = new RegExp(`^\\[[^\\]\\n]*\\]:\\s*\\S+`, 'gm')

  let match = pattern.exec(doc)
  while (match !== null) {
    const defined = /^\[([^\]\n]*)\]:/.exec(match[0])
    if (defined !== null && (defined[1] ?? '').trim().toLowerCase() === trimmed.toLowerCase()) {
      return true
    }
    match = pattern.exec(doc)
  }
  return false
}

/**
 * 该范围是否应当被隐藏 —— 空标记与未闭合标记的统一判定。
 *
 * @param doc 全文
 * @param from 范围起点（记号本身）
 * @param to 范围终点（记号本身）
 * @returns true 表示应折叠；false 表示必须保持可见
 */
export function shouldHideRange(doc: string, from: number, to: number): boolean {
  if (to <= from) return false
  const text = doc.slice(from, to)
  if (isBlank(text)) return false

  // 行内代码的记号本身**就是**代码区的边界，不在「代码区内部」——
  // 排除代码区是为了防止把 `` `[a](b)` `` 里的括号当链接，
  // 而反引号自身恰恰是应当折叠的记号。故只排除围栏代码区。
  if (insideAny(findFencedSpans(doc), from, to)) return false

  return isPairedMarker(doc, text, from, to)
}

/**
 * 记号是否成对闭合。
 *
 * 判定规则按记号种类分三种，核心原则是**只看记号本身能否在文中找到配对**：
 *   1. 强调类（`*` `**` `~~` `` ` ``）—— 全文必须存在**第二个**同样长的记号
 *   2. 标题类（`#` `##` …）—— 记号之后必须有非空内容
 *   3. 括号类（`[` `]`）—— 必须能配成对
 *
 * 「第二个」这个要求是刻意的：`未闭合粗体` 里的 `**` 是唯一一处该记号，
 * 折叠它等于删掉用户刚敲的两个字符。只出现一次说明用户还在输入中。
 *
 * 同理 `****`（空粗体）虽然有两个 `**`，但它们之间没有任何内容，
 * 折叠后用户看到的是一片空白，不知道自己站在哪 —— 空内容不得折叠。
 */
function isPairedMarker(doc: string, text: string, from: number, to: number): boolean {
  if (isBracket(text)) return hasBracketPair(doc, text, from)

  if (isHeadingMarker(text)) return hasContentAfter(doc, to)

  if (isRepeatedMark(text)) {
    // 记号之后必须还有内容，否则是空标记（**** / **）。
    // 之前也要有：闭合记号（如 `**粗体**` 的尾部 **）前面才是内容
    if (!hasContentAfter(doc, to) && !hasContentBefore(doc, from)) return false
    const unit = text[0] ?? ''
    return countRunsOf(doc, unit, text.length) >= 2
  }
  return true
}

function isBracket(text: string): boolean {
  return text === '[' || text === ']'
}

/**
 * 括号是否有配对。
 *
 * 数组下标 `a[0]` 只有一个 `[`，没有任何 `]` —— 折叠它会让下标消失。
 */
function hasBracketPair(doc: string, bracket: string, from: number): boolean {
  const pair = bracket === '[' ? ']' : '['
  return doc.indexOf(bracket, from + 1) !== -1 || doc.lastIndexOf(pair, from) !== -1
}

/**
 * 全文中长度至少为 width 的同类记号连续段数量。
 *
 * 用连续段而非单个字符计数：`****` 里 `*` 有 4 个但 `**` 连续段只有 2 段，
 * 而我们要判断的是「能否构成一对」，连续段数才是对应关系。
 */
function countRunsOf(doc: string, char: string, width: number): number {
  let runs = 0
  let index = 0
  while (index < doc.length) {
    if (doc[index] !== char) {
      index += 1
      continue
    }
    let length = 0
    while (index + length < doc.length && doc[index + length] === char) length += 1
    if (length >= width) runs += 1
    // 跳过整段，避免把长段拆成多个 width 的段重复计数
    index += length
  }
  return runs
}

function isHeadingMarker(text: string): boolean {
  return text.length > 0 && text === '#'.repeat(text.length) && text.length <= 6
}

/**
 * 重复记号：`**`、`~~`、`` `` ``、以及**单字符的强调记号** `*` 与 `` ` ``。
 *
 * 单字符也纳入判定，因为 `*未闭合斜体` 与 `` `未闭合的代码 `` 里的
 * 首字符同样需要判定是否成对 —— 它们各有且仅有一个连续段，
 * countRunsOf 会给出 1 < 2，于是判定为未闭合、保持可见。
 */
function isRepeatedMark(text: string): boolean {
  if (text.length < 1) return false
  const first = text[0] ?? ''
  // 这些字符单独出现时是列表符号 / 井号 / 分隔线，不是强调记号
  if (first === ' ' || first === '#' || first === '-' || first === '_') return false
  return text.split('').every((char) => char === first)
}

/** 记号之后是否还有非空内容。空标题不得隐藏。 */
function hasContentAfter(doc: string, to: number): boolean {
  const lineEnd = indexOfLineEnd(doc, to)
  return !isBlank(doc.slice(to, lineEnd))
}

/** 记号之前是否还有非空内容。 */
function hasContentBefore(doc: string, from: number): boolean {
  const lineStart = doc.lastIndexOf('\n', from - 1) + 1
  return !isBlank(doc.slice(lineStart, from))
}

const BLANK = /[\s­-‏⁠-⁤﻿]/

export function isBlank(text: string): boolean {
  return text.replace(BLANK, '') === ''
}