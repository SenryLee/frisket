import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { describe, expect, it } from 'vitest'
import { collectImageSpans } from '@/editor/live/field.image'
import { directoryOf, resolveImageHref } from '@/editor/live/image-src'

function stateOf(doc: string, anchor = 0): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [markdown({ addKeymap: false })],
  })
}

describe('图片地址', () => {
  it('认远程图和 data 图，拒绝其它协议', () => {
    expect(resolveImageHref('https://example.com/a.jpg', null)?.kind).toBe('remote')
    expect(resolveImageHref('  <http://example.com/a.png> ', null)?.href).toBe('http://example.com/a.png')
    expect(resolveImageHref('data:image/png;base64,aaaa', null)?.kind).toBe('data')
    expect(resolveImageHref('javascript:alert(1)', null)).toBeNull()
  })

  it('相对路径拼到文档目录上，不越过根', () => {
    expect(directoryOf('/Users/a/note.md')).toBe('/Users/a')
    expect(resolveImageHref('./img/a.png', '/Users/a/docs')?.href).toBe('/Users/a/docs/img/a.png')
    expect(resolveImageHref('../b/a.png', '/Users/a/docs')?.href).toBe('/Users/a/b/a.png')
    expect(resolveImageHref('a.png', null)).toBeNull()
  })
})

describe('图片节点', () => {
  it('独立成行的远程图带说明，句子里的不算整行', () => {
    const block = collectImageSpans(stateOf('![图像](https://example.com/a.jpg)\n'))
    expect(block).toEqual([
      {
        from: 0,
        to: '![图像](https://example.com/a.jpg)'.length,
        alt: '图像',
        url: 'https://example.com/a.jpg',
        block: true,
      },
    ])

    const inline = collectImageSpans(stateOf('见 ![图](https://example.com/a.png) 这里\n'))
    expect(inline).toHaveLength(1)
    expect(inline[0]?.block).toBe(false)
    expect(inline[0]?.alt).toBe('图')

    const photo = collectImageSpans(
      stateOf('![图像](https://pbs.twimg.com/media/HTrHZvSbQAAXrnD?format=jpg&name=large)\n'),
    )
    expect(photo[0]?.url).toBe('https://pbs.twimg.com/media/HTrHZvSbQAAXrnD?format=jpg&name=large')
    expect(photo[0]?.block).toBe(true)
  })

  it('代码块、引用式图片和其它协议不进预览', () => {
    const fenced = collectImageSpans(stateOf('```\n![图](https://example.com/a.png)\n```\n'))
    expect(fenced).toEqual([])
    expect(collectImageSpans(stateOf('![图][id]\n\n[id]: https://example.com/a.png\n'))).toEqual([])
    expect(collectImageSpans(stateOf('![图](javascript:alert(1))\n'))).toEqual([])
  })
})
