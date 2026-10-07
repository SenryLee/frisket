/**
 * 颜色 / 高亮 / 对齐的视图装饰。
 *
 * 工具栏写入的是普通 Markdown 或一行内的 HTML。这里只负责画出来。
 * 标记折叠限制在同一行，不改字号，因此不改行高。
 */

import { StateField } from '@codemirror/state'
import type { Range } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'

const HIGHLIGHT = /==([^=\n]+)==/g
const TEXT_COLOR = /<span style="color:(#[0-9a-fA-F]{6})">([^<\n]*)<\/span>/g
const TEXT_AND_BG =
  /<span style="color:(#[0-9a-fA-F]{6});background-color:(#[0-9a-fA-F]{6})">([^<\n]*)<\/span>/g
const BACKGROUND = /<mark style="background-color:(#[0-9a-fA-F]{6})">([^<\n]*)<\/mark>/g
const ALIGN_OPEN = /^<p align="(left|center|right|justify)">$/
const ALIGN_CLOSE = /^<\/p>$/

function build(doc: { lines: number; line(index: number): { from: number; text: string } }): DecorationSet {
  const ranges: Range<Decoration>[] = []
  let align: string | null = null

  for (let index = 1; index <= doc.lines; index += 1) {
    const line = doc.line(index)
    const open = ALIGN_OPEN.exec(line.text)
    if (open?.[1]) {
      align = open[1]
      ranges.push(Decoration.mark({ class: 'cm-align-tag' }).range(line.from, line.from + line.text.length))
      continue
    }
    if (ALIGN_CLOSE.test(line.text)) {
      align = null
      ranges.push(Decoration.mark({ class: 'cm-align-tag' }).range(line.from, line.from + line.text.length))
      continue
    }
    if (align && line.text.length > 0) {
      ranges.push(Decoration.line({ class: `cm-align-${align}` }).range(line.from))
    }
    collectInline(line.text, line.from, ranges)
  }

  ranges.sort((left, right) => left.from - right.from || left.to - right.to)
  // 颜色是 mark，高亮的 == 也是 mark，两段会叠在同一段文字上。
  // 只丢掉互相覆盖的替换（标签折叠），mark 必须留下，否则字色会被高亮吃掉。
  const safe: Range<Decoration>[] = []
  let hiddenUntil = 0
  for (const range of ranges) {
    if (hidesText(range) && range.from < hiddenUntil) continue
    safe.push(range)
    if (hidesText(range)) hiddenUntil = Math.max(hiddenUntil, range.to)
  }
  return Decoration.set(safe, true)
}

function hidesText(range: Range<Decoration>): boolean {
  const value = range.value as Decoration & { point?: boolean; isReplace?: boolean }
  return value.point === true && value.isReplace === true && range.to > range.from
}

function collectInline(text: string, base: number, ranges: Range<Decoration>[]): void {
  HIGHLIGHT.lastIndex = 0
  let highlight = HIGHLIGHT.exec(text)
  while (highlight) {
    const whole = highlight[0]
    const inner = highlight[1] ?? ''
    if (inner !== '') {
      const from = base + highlight.index
      const innerFrom = from + 2
      const innerTo = from + whole.length - 2
      ranges.push(Decoration.replace({}).range(from, innerFrom))
      ranges.push(Decoration.mark({ class: 'cm-color-highlight' }).range(innerFrom, innerTo))
      ranges.push(Decoration.replace({}).range(innerTo, from + whole.length))
    }
    highlight = HIGHLIGHT.exec(text)
  }

  paintCombined(text, base, ranges)
  paintTag(text, base, TEXT_COLOR, '</span>', ranges, (color, from, to) => {
    ranges.push(
      Decoration.mark({
        class: 'cm-ink',
        attributes: { style: `--slate-ink:${color}` },
      }).range(from, to),
    )
  })
  paintTag(text, base, BACKGROUND, '</mark>', ranges, (color, from, to) => {
    ranges.push(
      Decoration.mark({
        class: 'cm-ink-bg',
        attributes: { style: `--slate-paper:${color}` },
      }).range(from, to),
    )
  })
}

function paintCombined(text: string, base: number, ranges: Range<Decoration>[]): void {
  TEXT_AND_BG.lastIndex = 0
  let match = TEXT_AND_BG.exec(text)
  while (match) {
    const color = match[1] ?? ''
    const background = match[2] ?? ''
    const inner = match[3] ?? ''
    const whole = match[0]
    if (color !== '' && background !== '') {
      const from = base + match.index
      const innerFrom = from + (whole.length - inner.length - '</span>'.length)
      const innerTo = innerFrom + inner.length
      ranges.push(Decoration.replace({}).range(from, innerFrom))
      if (inner !== '') {
        ranges.push(
          Decoration.mark({
            class: 'cm-ink cm-ink-bg',
            attributes: { style: `--slate-ink:${color};--slate-paper:${background}` },
          }).range(innerFrom, innerTo),
        )
      }
      ranges.push(Decoration.replace({}).range(innerTo, from + whole.length))
    }
    match = TEXT_AND_BG.exec(text)
  }
}

function paintTag(
  text: string,
  base: number,
  pattern: RegExp,
  closing: string,
  ranges: Range<Decoration>[],
  paint: (color: string, from: number, to: number) => void,
): void {
  pattern.lastIndex = 0
  let match = pattern.exec(text)
  while (match) {
    const whole = match[0]
    const color = match[1] ?? ''
    const inner = match[2] ?? ''
    if (color !== '') {
      const from = base + match.index
      const innerFrom = from + (whole.length - inner.length - closing.length)
      const innerTo = innerFrom + inner.length
      ranges.push(Decoration.replace({}).range(from, innerFrom))
      if (inner !== '') paint(color, innerFrom, innerTo)
      ranges.push(Decoration.replace({}).range(innerTo, from + whole.length))
    }
    match = pattern.exec(text)
  }
}

export const colorField = StateField.define<DecorationSet>({
  create(state) {
    return build(state.doc)
  },
  update(value, transaction) {
    if (!transaction.docChanged) return value
    return build(transaction.state.doc)
  },
  provide(field) {
    return EditorView.decorations.from(field)
  },
})

export const colorTheme = EditorView.baseTheme({
  // 加粗、删除线、代码、链接自己写了 color。字色标在外层时会被它们盖住。
  // 用变量加 !important，里外两层都能压过那些 class。
  // WebKit 在透明窗口里有时不认 color，只认 -webkit-text-fill-color。
  '.cm-ink, .cm-ink .cm-md-strong, .cm-ink .cm-md-em, .cm-ink .cm-md-strike, .cm-ink .cm-md-code-inline, .cm-ink .cm-md-link, .cm-ink .cm-color-highlight':
    {
      color: 'var(--slate-ink) !important',
      WebkitTextFillColor: 'var(--slate-ink) !important',
    },
  '.cm-ink::selection, .cm-ink *::selection': {
    color: 'var(--slate-ink) !important',
    WebkitTextFillColor: 'var(--slate-ink) !important',
  },
  '.cm-ink-bg': {
    backgroundColor: 'var(--slate-paper)',
    borderRadius: '2px',
  },
  '.cm-color-highlight': {
    backgroundColor: '#f3e2a2',
    borderRadius: '2px',
  },
  '.cm-align-tag': {
    color: 'var(--text-muted)',
  },
  '.cm-align-left': { textAlign: 'left' },
  '.cm-align-center': { textAlign: 'center' },
  '.cm-align-right': { textAlign: 'right' },
  '.cm-align-justify': { textAlign: 'justify' },
})
