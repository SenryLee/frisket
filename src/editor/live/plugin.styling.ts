/**
 * 样式层 ViewPlugin —— 给可见区域内的行内元素打 class
 *
 * 在整体中的位置：field.inline.ts 决定「看不见什么」，
 * field.layout.ts 决定「每行多高」，本文件只决定「字是什么颜色粗细」。
 * 三者严格分离的意义：折叠是布局问题（CLS），行高是布局问题，字色是观感问题。
 * 混在一起意味着改个颜色就会触发一次布局重算。
 *
 * 为什么只扫 visibleRanges：本层纯 CSS 上色，不改任何盒模型，
 * 扫全文在 5k 行文档上纯属浪费。
 *
 * 为什么用 ViewPlugin 而不是 StateField：本层无状态、纯派生，
 * 放 StateField 会让每次事务都多跑一遍全量扫描。
 *
 * ── 纪律：这里绝不能出现 Decoration.line ──────────────────────
 * 函数式提供的 decoration set 在视口计算之后才被调用，
 * 带高度的行装饰会让编辑器算错高度图。本文件只产出 mark 装饰。
 * 行级 class 由 field.layout.ts 的 StateField 提供。
 */

import { ViewPlugin, Decoration } from '@codemirror/view'
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view'
import type { Range } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

/** 节点名 → 内容区间上的 class。全部为行内样式，不影响行高。 */
const MARK_CLASS: Readonly<Record<string, string>> = {
  StrongEmphasis: 'cm-md-strong',
  Emphasis: 'cm-md-em',
  Strikethrough: 'cm-md-strike',
  InlineCode: 'cm-md-code-inline',
  Link: 'cm-md-link',
  FencedCode: 'cm-md-code-block',
  Blockquote: 'cm-md-quote-text',
  ListItem: 'cm-md-list-text',
  ATXHeading1: 'cm-md-h1-text',
  ATXHeading2: 'cm-md-h2-text',
  ATXHeading3: 'cm-md-h3-text',
  ATXHeading4: 'cm-md-h4-text',
  ATXHeading5: 'cm-md-h5-text',
  ATXHeading6: 'cm-md-h6-text',
}

function buildStyling(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const tree = syntaxTree(view.state)

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        const className = MARK_CLASS[node.name]
        // 跳过记号本身：记号已被 field.inline 折叠，
        // 但折叠只影响渲染，语法节点区间仍含记号，class 会连带记号一起上色
        if (className !== undefined && node.to > node.from) {
          ranges.push(
            Decoration.mark({ class: className }).range(node.from, node.to),
          )
        }
        return true
      },
    })
  }

  // 多段 visibleRanges 的遍历顺序不保证全局有序，交给 Decoration.set 排序
  return Decoration.set(ranges, true)
}

/**
 * 编辑器视图插件。
 *
 * 重建时机只看「内容或视口真的变了」：选区变化不重建 ——
 * 样式不依赖光标，让它跟着光标跑纯属浪费。
 */
class StylingPlugin {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = buildStyling(view)
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildStyling(update.view)
    }
  }
}

export const stylingPlugin = ViewPlugin.fromClass(StylingPlugin, {
  decorations: (plugin) => plugin.decorations,
})