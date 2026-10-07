import { describe, expect, it } from 'vitest'
import {
  folderContainsPath,
  folderLabel,
  libraryDirectoryKeys,
  markdownLabel,
  pinFolder,
  pruneExpanded,
  readExpanded,
  readLibraryPane,
  toggleKey,
  unpinFolder,
  visibleLibraryRows,
} from '../../src/core/libraryFolders'

describe('常用文件夹', () => {
  it('只收绝对路径，新的排在前面，最多十二条', () => {
    expect(pinFolder([], 'notes')).toEqual([])
    expect(pinFolder(['/ok'], '/tmp/../etc')).toEqual(['/ok'])
    expect(pinFolder([], '/Users/a/docs/')).toEqual(['/Users/a/docs'])
    const full = Array.from({ length: 12 }, (_, index) => `/f${index}`)
    const pinned = full.reduce((list, folder) => pinFolder(list, folder), [] as string[])
    expect(pinned).toHaveLength(12)
    expect(pinned[0]).toBe('/f11')
    const added = pinFolder(pinned, '/new')
    expect(added).toHaveLength(12)
    expect(added[0]).toBe('/new')
    expect(added).not.toContain('/f0')
  })

  it('移出只改名单', () => {
    expect(unpinFolder(['/a', '/b'], '/a/')).toEqual(['/b'])
    expect(unpinFolder(['/a'], '/missing')).toEqual(['/a'])
  })

  it('显示名去掉后缀，并且能判断文件落在哪个文件夹', () => {
    expect(markdownLabel('子/乙.markdown')).toBe('子/乙')
    expect(markdownLabel('甲.MD')).toBe('甲')
    expect(folderLabel('/Users/a/笔记')).toBe('笔记')
    expect(folderContainsPath('/Users/a/docs', '/Users/a/docs/子/乙.md')).toBe(true)
    expect(folderContainsPath('/Users/a/docs', '/Users/a/docs.md')).toBe(false)
    expect(folderContainsPath('/Users/a/docs', '/Users/a/docs')).toBe(false)
  })

  it('侧栏分页和展开状态能认出来', () => {
    expect(readLibraryPane('folders')).toBe('folders')
    expect(readLibraryPane('history')).toBe('history')
    expect(readLibraryPane('nope')).toBe('history')
    expect(readExpanded(['/a', '', 1, '/a'])).toEqual(['/a'])
    expect(toggleKey(['/a'], '/b')).toEqual(['/a', '/b'])
    expect(toggleKey(['/a', '/b'], '/a')).toEqual(['/b'])
    expect(pruneExpanded(['/a', '/a/子', '/b/子'], ['/a'])).toEqual(['/a', '/a/子'])
  })

  it('目录默认折叠，展开后才列出里面的文件', () => {
    const files = [
      { path: '/n/甲.md', name: '甲.md' },
      { path: '/n/子/乙.md', name: '子/乙.md' },
      { path: '/n/子/丙/丁.markdown', name: '子/丙/丁.markdown' },
    ]
    const collapsed = visibleLibraryRows(files, new Set(), '/n')
    expect(collapsed.map((row) => row.label)).toEqual(['子', '甲'])
    expect(collapsed[0]?.filePath).toBeNull()
    expect(collapsed[1]?.filePath).toBe('/n/甲.md')

    const open = visibleLibraryRows(files, new Set(['/n/子']), '/n')
    expect(open.map((row) => [row.label, row.depth, row.filePath])).toEqual([
      ['子', 0, null],
      ['丙', 1, null],
      ['乙', 1, '/n/子/乙.md'],
      ['甲', 0, '/n/甲.md'],
    ])

    const nested = visibleLibraryRows(files, new Set(['/n/子', '/n/子/丙']), '/n')
    expect(nested.map((row) => row.label)).toEqual(['子', '丙', '丁', '乙', '甲'])
    expect(nested[2]?.filePath).toBe('/n/子/丙/丁.markdown')
    expect(libraryDirectoryKeys(files, '/n')).toEqual(['/n/子', '/n/子/丙'])
  })
})
