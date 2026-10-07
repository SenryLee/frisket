/**
 * 记号显隐。
 *
 * 无感打字：光标停在正文里时，宿主整段保持折叠。
 * 点击某一行不会把 `#`、`**`、列表符号整组露出来。
 * 光标如果正好落在记号字符中间，由 ime.ts 的 withoutCursorCrossing
 * 单独露出那一个记号，避免光标被替换装饰吞掉。
 */

import type { EditorState } from '@codemirror/state'
import type { TextRange } from '@/core/interfaces'

/** 一条展开指令。当前产品规则下编辑器不再按宿主展开，集合保持为空。 */
export interface RevealRegion extends TextRange {
  /** 宿主节点名，供调试与单测断言 */
  readonly nodeName: string
}

/**
 * 光标落在正文里时不展开任何宿主。
 *
 * 以前会沿着语法树把标题、粗体、列表整段展开，一点进某一行，
 * Markdown 记号就冒出来。无感打字要求这些记号继续藏着。
 */
export function computeRevealRegions(_state: EditorState): readonly RevealRegion[] {
  return []
}

/** 某区间是否落在任一展开区内（含边界，边界重叠是刻意的宽松）。 */
export function isRevealed(regions: readonly RevealRegion[], from: number, to: number): boolean {
  for (const region of regions) {
    if (from < region.to && to > region.from) return true
    if (from === to && from >= region.from && from <= region.to) return true
  }
  return false
}

/**
 * 判断某个记号是否应该保持可见（不折叠）。
 *
 * 记号与展开区是「同宿主即互斥」：只要宿主正在展开，
 * 它的全部记号都要露出来。当前展开区为空，因此这里保持折叠。
 */
export function shouldRevealMarker(
  regions: readonly RevealRegion[],
  marker: TextRange,
  host: TextRange,
): boolean {
  return isRevealed(regions, marker.from, marker.to) || isRevealed(regions, host.from, host.to)
}

/**
 * 行首记号的「行尾贴靠」判断。
 *
 * 标题 `## foo` 里 `##` 后面的空格与 `foo` 属于同一逻辑单元，
 * 只隐藏 `##` 会把 foo 顶到行首导致视觉抖动，因此 `#` 与其后的空白要一起隐藏。
 */
export function expandMarkerEnd(text: string, to: number): number {
  let end = to
  while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end += 1
  return end
}

/** 门禁测试描述嵌套层级用的范围。 */
export interface DepthRange {
  readonly from: number
  readonly to: number
  /** 0 = 最外层，数字越大越内层 */
  readonly depth: number
}

/**
 * 光标在正文内不展开任何标记。
 *
 * 越界时返回空集，不抛错。ranges 仍保留在签名里，
 * 调用方不用为了「不展开」去改测试夹具的形状。
 */
export function computeRevealed(
  doc: string,
  cursor: number,
  _ranges: readonly DepthRange[],
): Set<number> {
  if (cursor < 0 || cursor > doc.length) return new Set()
  return new Set()
}
