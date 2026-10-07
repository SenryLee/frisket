/**
 * 最近保存过的文件夹。最多五条，只要绝对路径。
 */

const MAX_FOLDERS = 5

/** 收下绝对路径。相对路径和带 `..` 的路径丢掉。 */
export function normalizeFolder(path: string): string | null {
  if (!path.startsWith('/')) return null
  if (path.split('/').includes('..')) return null
  if (path.includes('\0')) return null
  const trimmed = path.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/** 把新文件夹放到最前，去掉重复，只留五条。 */
export function rememberFolder(list: readonly string[], folder: string): string[] {
  const next = normalizeFolder(folder)
  const kept = list.filter((item) => normalizeFolder(item) !== null)
  if (next === null) return kept.slice(0, MAX_FOLDERS)
  return [next, ...kept.filter((item) => normalizeFolder(item) !== next)].slice(0, MAX_FOLDERS)
}
