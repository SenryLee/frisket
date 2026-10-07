/**
 * format.ts —— 界面上共用的数字与时间格式化
 *
 * 在整体中的位置：纯函数，无依赖无状态。侧栏（打开时间）
 * 与状态栏（字数）都要用同样的规则，若各写一份必然出现
 * 「侧栏显示 3 天前、状态栏显示 3天」这类不一致。
 */

/** 千分位。中文语境下不显示小数，因为字数本来就是整数 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Math.round(value).toLocaleString('zh-CN')
}

/**
 * 相对时间。超过 7 天改用日期 —— 「43 天前」没有信息量。
 *
 * why不用 toLocaleDateString：那会输出「2026/10/6」这种依赖 locale 的格式，
 * 而中文界面需要「10月6日」这种更紧凑的写法。
 */
export function formatRelativeTime(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''

  const diffMs = Date.now() - then
  const diffMinutes = Math.floor(diffMs / 60_000)

  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} 小时前`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays} 天前`

  const date = new Date(then)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return sameYear ? `${month}-${day}` : `${date.getFullYear()}-${month}-${day}`
}

/**
 * 文件路径的末两段。
 *
 * 侧栏空间有限，全路径既挤又没信息量。取「父目录/文件名」，
 * 既能区分同名文件，又不会把路径拉得过长。
 */
export function shortenPath(fullPath: string): string {
  const segments = fullPath.split('/').filter((segment) => segment.length > 0)
  if (segments.length <= 2) return fullPath
  const fileName = segments[segments.length - 1] ?? ''
  const parent = segments[segments.length - 2] ?? ''
  return `${parent}/${fileName}`
}