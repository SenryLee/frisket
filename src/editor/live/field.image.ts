/**
 * 图片预览。独立成行的图片画成一张带窗框的图；夹在句子里的缩进同一行。
 *
 * 替换挂在 StateField 上：图片高度要进高度图，不能等视口算完再补。
 * 光标落进这张图的源码时不替换，地址露出来才能改。点回正文重新显示。
 * 源码本身不改。
 */

import { StateField, RangeSetBuilder } from '@codemirror/state'
import type { EditorState, Transaction } from '@codemirror/state'
import { EditorView, Decoration, WidgetType } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { syntaxTree } from '@codemirror/language'
import { hasRefreshEffect } from '../effects'
import { shouldDeferRebuild, withoutCursorCrossing } from './ime'
import { imageBaseDir, resolveImageHref } from './image-src'

export interface ImageSpan {
  readonly from: number
  readonly to: number
  readonly alt: string
  readonly url: string
  /** 这一行除了图片没有别的字。 */
  readonly block: boolean
}

class ImageWidget extends WidgetType {
  constructor(
    private readonly url: string,
    private readonly alt: string,
    private readonly block: boolean,
    private readonly dir: string | null,
  ) {
    super()
  }

  override eq(other: ImageWidget): boolean {
    return (
      other.url === this.url &&
      other.alt === this.alt &&
      other.block === this.block &&
      other.dir === this.dir
    )
  }

  override get estimatedHeight(): number {
    return this.block ? 220 : -1
  }

  override toDOM(view: EditorView): HTMLElement {
    const figure = document.createElement('span')
    figure.className = this.block ? 'cm-md-figure' : 'cm-md-figure is-inline'
    figure.title = this.alt === '' ? '图片' : this.alt

    if (this.block) {
      const chrome = document.createElement('span')
      chrome.className = 'cm-md-figure__chrome'
      chrome.setAttribute('aria-hidden', 'true')
      const dots = document.createElement('span')
      dots.className = 'cm-md-figure__dots'
      chrome.append(dots)
      if (this.alt !== '') {
        const title = document.createElement('span')
        title.className = 'cm-md-figure__title'
        title.textContent = this.alt
        chrome.append(title)
      }
      figure.append(chrome)
    }

    const img = document.createElement('img')
    img.className = 'cm-md-figure__img'
    img.alt = this.alt
    img.draggable = false
    img.decoding = 'async'
    img.addEventListener('load', () => view.requestMeasure())
    img.addEventListener('error', () => {
      figure.classList.add('is-broken')
      view.requestMeasure()
    })

    const resolved = resolveImageHref(this.url, this.dir)
    if (resolved === null) {
      figure.classList.add('is-broken')
    } else if (resolved.kind === 'file' && !resolved.href.startsWith('http') && !resolved.href.startsWith('asset:')) {
      figure.classList.add('is-local')
    } else {
      img.src = resolved.href
    }
    figure.append(img)

    const note = document.createElement('span')
    note.className = 'cm-md-figure__note'
    note.textContent = figure.classList.contains('is-local') ? '本地图片要在安装版里看' : '图片打不开'
    figure.append(note)
    return figure
  }

  override ignoreEvent(): boolean {
    return false
  }
}

/** 语法树里的图片。代码块里不会有 Image 节点。 */
export function collectImageSpans(state: EditorState): ImageSpan[] {
  const spans: ImageSpan[] = []
  syntaxTree(state).iterate({
    enter(ref) {
      if (ref.name !== 'Image') return true
      const node = ref.node
      const span = readImage(state, node)
      if (span !== null) spans.push(span)
      return false
    },
  })
  return spans
}

function readImage(state: EditorState, node: SyntaxNode): ImageSpan | null {
  const urlNode = node.getChild('URL')
  if (urlNode === null) return null
  const url = state.doc.sliceString(urlNode.from, urlNode.to).trim().replace(/^<|>$/g, '')
  if (!canPreview(url)) return null

  const alt = readAlt(state, node, urlNode.from)
  const line = state.doc.lineAt(node.from)
  const block = line.from === node.from && line.to === node.to
  return { from: node.from, to: node.to, alt, url, block }
}

/** 远程图、data 图、以及本机路径可以预览。别的协议留在源码里。 */
function canPreview(url: string): boolean {
  if (url === '') return false
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(url)) return true
  if (/^https?:\/\//i.test(url)) return true
  return !/^[a-z][a-z0-9+.-]*:/i.test(url)
}

function readAlt(state: EditorState, node: SyntaxNode, urlFrom: number): string {
  let openEnd = node.from
  let closeStart = urlFrom
  const cursor = node.cursor()
  if (!cursor.firstChild()) return ''
  if (cursor.name === 'LinkMark') openEnd = cursor.to
  do {
    if (cursor.name === 'LinkMark' && cursor.from >= openEnd && cursor.to <= urlFrom) {
      closeStart = cursor.from
      break
    }
  } while (cursor.nextSibling())
  return state.doc.sliceString(openEnd, closeStart).trim()
}

function buildImages(state: EditorState): DecorationSet {
  const dir = imageBaseDir()
  const spans = withoutCursorCrossing(state, collectImageSpans(state))
  const builder = new RangeSetBuilder<Decoration>()
  for (const span of spans) {
    builder.add(
      span.from,
      span.to,
      Decoration.replace({
        widget: new ImageWidget(span.url, span.alt, span.block, dir),
        block: span.block,
      }),
    )
  }
  return builder.finish()
}

function shouldRebuild(transaction: Transaction): boolean {
  return (
    transaction.docChanged ||
    transaction.selection !== undefined ||
    hasRefreshEffect(transaction.effects)
  )
}

export const imageField = StateField.define<DecorationSet>({
  create: buildImages,
  update(current: DecorationSet, transaction: Transaction) {
    if (!shouldRebuild(transaction)) return current
    if (shouldDeferRebuild(transaction)) return current.map(transaction.changes)
    return buildImages(transaction.state)
  },
  provide: (field) => EditorView.decorations.from(field),
})
