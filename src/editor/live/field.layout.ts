/**
 * 布局层 StateField —— 行级 class 与块级 widget（纵向布局的唯一所有者）
 *
 * 在整体中的位置：三层里只有本层允许改变行的纵向尺寸。
 * field.inline.ts 折叠记号、plugin.styling.ts 上色，都不碰盒模型。
 *
 * ── 为什么行高必须由本层用 StateField 提供 ────────────────────
 * CodeMirror 明确规定：作为「函数」提供的 decoration set 在视口计算之后才被调用。
 * 若这类集合里含 block widget 或行装饰，编辑器在调用它之前就已经算好了高度图，
 * 于是滚动条长度、命中测试、scrollIntoView 全部基于错误的高度。
 * 行高恰恰是这三者的输入，因此它只能来自 StateField（值随 state 一起提交）。
 *
 * ── CLS 纪律第一条 ────────────────────────────────────────────
 * 行高只取决于所在行的 CSS class，与语法标记是否可见无关。
 * `.cm-md-h1` 的 font-size 与 line-height 是常量，写在 theme.ts 里，
 * `#` 显不显示都不改变这两个值。本层只负责挂 class，不负责度量。
 */

import { StateField, RangeSetBuilder } from '@codemirror/state'
import type { EditorState, Transaction } from '@codemirror/state'
import { EditorView, Decoration } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { hasRefreshEffect } from '../effects'

/**
 * 节点名 → 整行 class。
 *
 * 这张表是「行高由 class 决定」纪律的执行点：新增语法元素若会改变行高，
 * 必须在这里登记，让它的行高来自 CSS 常量而不是来自内容。
 */
const LINE_CLASS: Readonly<Record<string, string>> = {
  ATXHeading1: 'cm-md-h1',
  ATXHeading2: 'cm-md-h2',
  ATXHeading3: 'cm-md-h3',
  ATXHeading4: 'cm-md-h4',
  ATXHeading5: 'cm-md-h5',
  ATXHeading6: 'cm-md-h6',
  Blockquote: 'cm-md-quote',
  ListItem: 'cm-md-list',
  FencedCode: 'cm-md-fence',
  HorizontalRule: 'cm-md-rule-line',
}

/**
 * 展开态会让标题记号重新出现，此时行 class 不变、行高不变。
 * 换句话说：光标进出标题行，下方内容一个像素都不会动。
 */
function buildLayout(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const seen = new Set<number>()

  syntaxTree(state).iterate({
    enter(node) {
      const className = LINE_CLASS[node.name]
      if (className === undefined) return true
      addLineClass(state, node.from, node.to, className, seen, builder)
      return true
    },
  })
  return builder.finish()
}

/**
 * 给节点覆盖的每一行挂 class。
 *
 * 引用块与围栏代码跨多行，必须逐行挂；同一行可能被多个节点命中
 * （如引用块里的列表项），seen 集合负责去重，避免 RangeSetBuilder 抛重复位置错。
 */
function addLineClass(
  state: EditorState,
  from: number,
  to: number,
  className: string,
  seen: Set<number>,
  builder: RangeSetBuilder<Decoration>,
): void {
  let pos = from
  while (pos <= to) {
    const line = state.doc.lineAt(pos)
    if (!seen.has(line.from)) {
      seen.add(line.from)
      builder.add(line.from, line.from, Decoration.line({ class: className }))
    }
    if (line.to >= to) break
    pos = line.to + 1
  }
}

function shouldRebuild(transaction: Transaction): boolean {
  return transaction.docChanged || hasRefreshEffect(transaction.effects)
}

export const layoutField = StateField.define<DecorationSet>({
  create: buildLayout,
  update(current: DecorationSet, transaction: Transaction) {
    // 选区变化不重建：行 class 与光标无关，这是本层能保持廉价的根本原因
    if (!shouldRebuild(transaction)) return current
    return buildLayout(transaction.state)
  },
  provide: (field) => EditorView.decorations.from(field),
})