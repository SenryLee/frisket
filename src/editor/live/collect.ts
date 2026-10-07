/**
 * 语法树收集器 —— 把 lezer 语法树翻译成「待隐藏记号」清单
 *
 * 在整体中的位置：registry.ts 声明规则，本文件执行规则，
 * field.inline.ts 消费结果。三者分离的理由是规则会随语法支持增长而变化，
 * 而字段层的重建逻辑必须保持稳定。
 *
 * 收集方向是「宿主 → 记号」而非「记号 → 宿主」：一个 FencedCode 有两个 CodeMark，
 * 一个 Link 有四个 LinkMark 加一个 URL。从宿主往下遍历天然成组，
 * 不会出现同一个记号被两条路径重复收集（那会让 RangeSetBuilder 抛错）。
 */

import type { EditorState } from '@codemirror/state'
import type { SyntaxNode, SyntaxNodeRef, Tree } from '@lezer/common'
import { syntaxTree } from '@codemirror/language'
import type { HideTarget, MarkerKind } from './registry'
import { isLineLeading } from './registry'
import {
  hasNonBlankTarget,
  isAtLineStart,
  isBalancedFence,
  isBlank,
  isEmptyHost,
  isInlineLink,
} from './guards'

/**
 * 一个宿主节点及其直接子记号。
 *
 * 类型是真正的 SyntaxNode 而非 iterate回调给的 SyntaxNodeRef：
 * guards 需要 getChild（查URL 子节点），后者只有 from/to/name/type。
 * 代价是每个宿主要做一次 resolveInner 换对象，可接受 ——
 * 宿主数量是 O(记号数量)，不是 O(字符数)。
 */
export interface HostEntry {
  readonly host: SyntaxNode
  readonly markers: readonly SyntaxNode[]
}

const HOST_NAMES: ReadonlySet<string> = new Set([
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
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

/** 记号节点名 → 它会被折叠成的种类。 */
const MARK_KIND: Readonly<Record<string, MarkerKind>> = {
  HeaderMark: 'heading',
  EmphasisMark: 'emphasis',
  StrikethroughMark: 'strike',
  CodeMark: 'code',
  QuoteMark: 'quote',
  ListMark: 'list',
  LinkMark: 'link',
  URL: 'url',
}

function markKindOf(name: string): MarkerKind | null {
  return Object.prototype.hasOwnProperty.call(MARK_KIND, name)
    ? (MARK_KIND[name] as MarkerKind)
    : null
}

/**
 * 遍历语法树，收集所有宿主节点及其直接子记号。
 *
 * 只收直接子节点：lezer 把记号建成元素的直接子节点，
 * 再往下的节点属于内容本身（段落、嵌套强调等），不是要隐藏的记号。
 *
 * iterate 回调拿到的是 SyntaxNodeRef（只有 from/to/name/type），
 * 而守卫需要 getChild，因此对每个宿主做一次 resolveInner 换成完整节点。
 */
export function collectHosts(state: EditorState): readonly HostEntry[] {
  const entries: HostEntry[] = []
  const tree = syntaxTree(state)

  tree.iterate({
    enter(ref) {
      if (!HOST_NAMES.has(ref.name)) return true
      if (ref.to <= ref.from) return true

      const host = resolveHost(tree, ref)
      if (host === null) return true

      if (host.name === 'HorizontalRule') {
        entries.push({ host, markers: [host] })
        return false
      }

      entries.push({ host, markers: directMarkers(host) })
      // 不剪枝：链接文字里可以嵌套强调（[**粗**](url)），
      // 剪掉会让嵌套的 ** 露在渲染态里
      return true
    },
  })
  return entries
}

/**
 * 从树里取回 ref 指向的那个节点本身（而非它的某个后代）。
 *
 * 为什么不能直接 resolveInner(ref.from + 1, 1)：
 * 记号总是宿主的第一个子节点，所以 from+1 正好落在记号内部，
 * resolveInner 会返回记号（标题的 [0,6] 拿到 HeaderMark[0,1]）。
 * 从 ref.to - 1 起步同样不安全 —— 围栏代码的 to-1 是收尾记号。
 *
 * 稳妥做法是解析到任意位置后沿 parent 回溯，直到找到 from 与 name 都吻合的祖先。
 * 深度等于语法嵌套层数（通常 < 6），代价可忽略。
 */
function resolveHost(tree: Tree, ref: SyntaxNodeRef): SyntaxNode | null {
  const seed = tree.resolveInner(ref.from + 1, 1) ?? tree.resolveInner(ref.to - 1, -1)
  let node: SyntaxNode | null = seed
  while (node !== null) {
    if (node.from === ref.from && node.name === ref.name) return node
    node = node.parent
  }
  return null
}

/** 取宿主的直接子记号。用 cursor 而非递归，深度天然只有一层。 */
function directMarkers(host: SyntaxNode): readonly SyntaxNode[] {
  const markers: SyntaxNode[] = []
  const cursor = host.cursor()
  if (!cursor.firstChild()) return markers
  do {
    if (markKindOf(cursor.name) !== null) markers.push(cursor.node)
  } while (cursor.nextSibling())
  return markers
}

/**
 * 把宿主分组转成待隐藏记号清单。
 *
 * `isHostRevealed` 是「光标进入则展开」的落地点：命中的宿主整组不折叠。
 */
export function buildHideTargets(
  state: EditorState,
  entries: readonly HostEntry[],
  isHostRevealed: (host: SyntaxNode) => boolean,
): HideTarget[] {
  const targets: HideTarget[] = []

  for (const entry of entries) {
    if (isHostRevealed(entry.host)) continue
    collectEntry(state, entry, targets)
  }
  return targets.sort((left, right) => left.from - right.from || left.to - right.to)
}

function collectEntry(state: EditorState, entry: HostEntry, out: HideTarget[]): void {
  const { host, markers } = entry

  if (host.name === 'HorizontalRule') {
    out.push({ from: host.from, to: host.to, kind: 'rule', owner: rangeOf(host) })
    return
  }
  if (markers.length === 0) return
  if (!isHostExpandable(state, entry)) return

  const owner = rangeOf(host)
  for (const marker of markers) {
    const kind = markKindOf(marker.name)
    if (kind === null) continue
    out.push({ from: marker.from, to: widenForLeading(state, kind, marker.to), kind, owner })
  }
}

function rangeOf(node: SyntaxNode): { from: number; to: number } {
  return { from: node.from, to: node.to }
}

/**
 * 行首记号连带吃掉其后的空白。
 *
 * `# foo` 只隐藏 `#` 会让 `foo` 顶到行首，与展开态相比横向位置差一个字符，
 * 视觉上就是一次抖动。吃掉空白后两种状态的内容起始列完全一致。
 */
function widenForLeading(state: EditorState, kind: MarkerKind, to: number): number {
  if (!isLineLeading(kind)) return to
  const line = state.doc.lineAt(to)
  let end = to
  const text = line.text
  while (end < line.to && text[end] === ' ') end += 1
  return end
}

/** 宿主级防御：结构前提不满足时整组不折叠。 */
function isHostExpandable(state: EditorState, entry: HostEntry): boolean {
  const { host, markers } = entry
  switch (host.name) {
    case 'FencedCode':
      // 未闭合的围栏只有一个 CodeMark，折叠掉用户会误以为代码块已结束
      return isBalancedFence(byName(markers, 'CodeMark'))
    case 'Link':
      // 只折叠行内链接 [text](url)；[text] 引用链接折叠掉方括号会让人以为定义丢了
      return isInlineLink(host) && hasNonBlankTarget(state.doc, host)
    case 'InlineCode':
      return byName(markers, 'CodeMark').length === 2
    case 'Blockquote':
      return markers.every((marker) => isAtLineStart(state.doc, marker.from))
    case 'ListItem':
      return byName(markers, 'ListMark').length === 1
    case 'Emphasis':
    case 'StrongEmphasis':
      return byName(markers, 'EmphasisMark').length === 2
    case 'Strikethrough':
      return byName(markers, 'StrikethroughMark').length === 2
    default:
      return !isEmptyHost(state.doc, host, markers) && !isBlank(state.doc.sliceString(host.from, host.to))
  }
}

function byName(markers: readonly SyntaxNode[], name: string): SyntaxNode[] {
  return markers.filter((marker) => marker.name === name)
}