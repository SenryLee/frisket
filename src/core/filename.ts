/**
 * 文件名。只接受一个文件名，不接受路径。
 */

const INVALID = /[/\\:\u0000]/

/** 从绝对路径取出不带 .md 的文件名。 */
export function fileStem(path: string): string {
  const base = path.split('/').pop() ?? path
  const stem = base.replace(/\.md$/i, '').trim()
  return stem === '' ? '未命名' : stem
}

/**
 * 把用户输入收成 `名字.md`。
 * 空串、`.`、`..` 和带路径分隔符的输入返回 null。
 */
export function fileNameFromInput(raw: string): string | null {
  const trimmed = raw.trim()
  const stem = trimmed.replace(/\.md$/i, '').trim()
  if (stem === '' || stem === '.' || stem === '..') return null
  if (INVALID.test(stem)) return null
  if ([...stem].length > 180) return null
  return `${stem}.md`
}
