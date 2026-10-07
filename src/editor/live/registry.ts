/**
 * 元素处理器注册表 —— 内核「语法元素 → 隐藏策略」的唯一映射点
 *
 * 在整体中的位置：collect.ts 走 lezer 语法树时向本表查询每个记号该如何处理，
 * field.inline.ts 再把查询结果翻译成 Decoration.replace 隐藏集。
 * 新增一种语法元素只需在 MARK_RULES 里加一行，不必改状态机与字段层。
 *
 * 为什么用「记号节点」而不是「元素节点」驱动收集：lezer 里 `**`、`#`、`>`
 * 这些记号都是独立子节点。从宿主往下找记号，比从记号反推宿主更稳 ——
 * 引用里的列表、列表里的粗体这类嵌套，不会把同一个记号收集两次。
 */

import type { TextRange } from '@/core/interfaces'

/** 记号种类。用于单测断言与调试，不参与样式（被替换的记号挂不上 class）。 */
export type MarkerKind =
  | 'heading'
  | 'emphasis'
  | 'strike'
  | 'code'
  | 'quote'
  | 'list'
  | 'link'
  | 'url'
  | 'rule'

/** 一个待隐藏的记号区间，以及它所属元素的范围（展开判定用）。 */
export interface HideTarget extends TextRange {
  readonly kind: MarkerKind
  readonly owner: TextRange
}

export interface MarkRule {
  /** 允许作为该记号宿主的元素节点名。Setext 标题故意缺席，见下。 */
  readonly owners: readonly string[]
  readonly kind: MarkerKind
  /**
   * 是否为「内容边界记号」—— 宿主内容为空时不隐藏。
   * 空的 `##` 若被隐藏，用户会盯着一片空白不知道自己还在标题里。
   */
  readonly boundsContent: boolean
  /**
   * 是否为「行首记号」。
   *
   * 行首记号折叠时保留等宽占位（见 field.inline.ts 的 MarkerSpacer），
   * 这样光标进出导致的展开 / 折叠不会改变任何一行的可用宽度，
   *也就不会触发换行变化 —— 这是 CLS 纪律第一條能落地的关键。
   */
  readonly lineLeading: boolean
}

const ATX_HEADINGS: readonly string[] = [
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
]

/**
 * 只认 ATX 标题，不认 Setext。
 *
 * Setext 的「下划线行」不是一个可以折叠的记号 —— 隐藏它等于删掉一整行，
 * 标题会整体上移一行。这是无法用 inline decoration 掩盖的位移，
 * 所以按 spec §3 的默认取舍，Setext 下划线保持源码可见。
 */
export const HEADING_NAMES: ReadonlySet<string> = new Set(ATX_HEADINGS)

/** 全部宿主节点名。展开状态机只认这些节点，普通段落不在其中。 */
export const HOST_NAMES: ReadonlySet<string> = new Set<string>([
  ...ATX_HEADINGS,
  'Emphasis',
  'StrongEmphasis',
  'Strikethrough',
  'InlineCode',
  'Link',
  'FencedCode',
  'Blockquote',
  'ListItem',
  'HorizontalRule',
])

/**
 * 记号节点名 → 处理规则。
 *
 * `URL` 的 owners 只含 Link：GFM 裸链接（段落里裸露的地址）不折叠，
 * 否则用户粘贴一串地址后会看着它凭空消失，那是丢内容而不是所见即所得。
 */
export const MARK_RULES: Readonly<Record<string, MarkRule>> = {
  HeaderMark: { owners: ATX_HEADINGS, kind: 'heading', boundsContent: true, lineLeading: true },
  EmphasisMark: {
    owners: ['Emphasis', 'StrongEmphasis'],
    kind: 'emphasis',
    boundsContent: true,
    lineLeading: false,
  },
  StrikethroughMark: {
    owners: ['Strikethrough'],
    kind: 'strike',
    boundsContent: true,
    lineLeading: false,
  },
  CodeMark: {
    owners: ['InlineCode', 'FencedCode'],
    kind: 'code',
    boundsContent: false,
    lineLeading: false,
  },
  QuoteMark: { owners: ['Blockquote'], kind: 'quote', boundsContent: false, lineLeading: true },
  ListMark: { owners: ['ListItem'], kind: 'list', boundsContent: false, lineLeading: true },
  LinkMark: { owners: ['Link'], kind: 'link', boundsContent: false, lineLeading: false },
  URL: { owners: ['Link'], kind: 'url', boundsContent: false, lineLeading: false },
}

/** 记号名 → 规则。查不到即不属于本引擎管辖，交给 CodeMirror 默认渲染。 */
export function ruleFor(markName: string): MarkRule | null {
  return Object.prototype.hasOwnProperty.call(MARK_RULES, markName)
    ? (MARK_RULES[markName] as MarkRule)
    : null
}

/** 行首记号的折叠形态需要保留宽度，见 file header 的 CLS 说明。 */
export function isLineLeading(kind: MarkerKind): boolean {
  return LINE_LEADING_KINDS.has(kind)
}

const LINE_LEADING_KINDS: ReadonlySet<MarkerKind> = new Set<MarkerKind>([
  'heading',
  'quote',
  'list',
])