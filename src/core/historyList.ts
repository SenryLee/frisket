/**
 * 历史列表的纯筛选。只决定哪些记录还留在列表里，不碰磁盘上的文件。
 */

export interface HistoryRef {
  id: string
  path: string
}

function sameKey(left: string, right: string): boolean {
  if (left === right) return true
  return left.normalize('NFC') === right.normalize('NFC')
}

/** 去掉 id 或 path 命中的记录。空名单原样返回一份新数组。 */
export function omitHistory<T extends HistoryRef>(items: readonly T[], ids: readonly string[]): T[] {
  const drop = ids.filter((id) => id !== '')
  if (drop.length === 0) return [...items]
  return items.filter(
    (item) => !drop.some((id) => sameKey(id, item.id) || sameKey(id, item.path)),
  )
}
