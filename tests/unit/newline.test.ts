import { describe, expect, it } from 'vitest'
import { newlineOutsideMarker } from '../../src/core/newline'
import { fileNameFromInput, fileStem } from '../../src/core/filename'
import { normalizeFolder, rememberFolder } from '../../src/core/recentFolders'
import { beginDocumentSession, decideAutoOpen } from '../../src/core/aiSession'
import { frameForAiPane } from '../../src/core/windowFrame'

describe('回车离开标记', () => {
  it('格式选区包住标记内侧时，换行落在标记后面', () => {
    expect(newlineOutsideMarker('**你好**', 2, 4)).toEqual({
      from: 6,
      to: 6,
      insert: '\n',
      cursor: 7,
    })
  })

  it('光标贴在闭合标记前面时，不把换行插进标记', () => {
    expect(newlineOutsideMarker('**你好**', 4, 4)?.from).toBe(6)
  })

  it('光标落在闭合标记两个字符中间时，整段标记留在上一行', () => {
    expect(newlineOutsideMarker('**你好**', 5, 5)?.from).toBe(6)
  })

  it('光标在文字中间时不拦截，普通换行继续生效', () => {
    expect(newlineOutsideMarker('**你好**', 3, 3)).toBeNull()
  })

  it('光标贴在起始标记后面时，换行落在整段标记前面', () => {
    expect(newlineOutsideMarker('**你好**', 2, 2)).toEqual({
      from: 0,
      to: 0,
      insert: '\n',
      cursor: 1,
    })
  })

  it('单星号不会把双星号拆开', () => {
    const edit = newlineOutsideMarker('**重点**', 4, 4)
    expect(edit?.from).toBe(6)
  })

  it('删除线、高亮和行内代码同样留在上一行', () => {
    expect(newlineOutsideMarker('~~删~~', 2, 3)?.from).toBe(5)
    expect(newlineOutsideMarker('==亮==', 2, 3)?.from).toBe(5)
    expect(newlineOutsideMarker('`码`', 1, 2)?.from).toBe(3)
  })

  it('颜色标记包住选区时，换行落在标签后面', () => {
    const doc = '<span style="color:#ff0000">字</span>'
    const from = doc.indexOf('字')
    expect(newlineOutsideMarker(doc, from, from + 1)?.from).toBe(doc.length)
    const both = '<span style="color:#ff0000;background-color:#f3e2a2">字</span>'
    const at = both.indexOf('字')
    expect(newlineOutsideMarker(both, at, at + 1)?.from).toBe(both.length)
  })
})

describe('文件名与最近文件夹', () => {
  it('输入会收成一个 md 文件名', () => {
    expect(fileNameFromInput('  会议纪要.md ')).toBe('会议纪要.md')
    expect(fileNameFromInput('..')).toBeNull()
    expect(fileNameFromInput('a/b')).toBeNull()
    expect(fileStem('/Users/a/会议纪要.md')).toBe('会议纪要')
  })

  it('最近文件夹只留五条绝对路径，新的排在前面', () => {
    const first = rememberFolder([], '/Users/a/docs')
    const second = rememberFolder(first, '/Users/a/docs/')
    expect(second).toEqual(['/Users/a/docs'])
    const many = ['/e', '/d', '/c', '/b', '/a'].reduce(
      (list, folder) => rememberFolder(list, folder),
      [] as string[],
    )
    expect(many).toEqual(['/a', '/b', '/c', '/d', '/e'])
    expect(normalizeFolder('notes')).toBeNull()
    expect(normalizeFolder('/tmp/../etc')).toBeNull()
  })
})

describe('AI 侧栏本次打开', () => {
  it('第一次划选才自动打开', () => {
    expect(decideAutoOpen({ open: false, dismissed: false, autoOpened: false })).toEqual({
      open: true,
      dismissed: false,
      autoOpened: true,
    })
  })

  it('已经打开或手动关闭后不再自动打开', () => {
    expect(decideAutoOpen({ open: true, dismissed: false, autoOpened: true })).toBeNull()
    expect(decideAutoOpen({ open: false, dismissed: true, autoOpened: false })).toBeNull()
  })

  it('换文档后，关着的侧栏可以再自动打开一次', () => {
    expect(beginDocumentSession(false)).toEqual({ dismissed: false, autoOpened: false })
    expect(beginDocumentSession(true)).toEqual({ dismissed: false, autoOpened: true })
  })
})

describe('AI 窗口让位', () => {
  const work = { x: 0, y: 0, width: 1400, height: 900 }

  it('右边有空位时向外加宽', () => {
    const next = frameForAiPane({ x: 40, y: 40, width: 800, height: 700 }, work, 380, 720)
    expect(next).toMatchObject({ x: 40, width: 1180, height: 700 })
  })

  it('贴着屏幕边缘时把整个窗口收进工作区', () => {
    const next = frameForAiPane({ x: 700, y: 40, width: 680, height: 700 }, work, 380, 720)
    expect(next.x + next.width).toBeLessThanOrEqual(1400)
    expect(next.width).toBeGreaterThanOrEqual(720)
    expect(next.y).toBe(40)
    expect(next.height).toBe(700)
  })
})
