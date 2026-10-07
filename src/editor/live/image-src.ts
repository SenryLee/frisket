/**
 * 图片地址。正文里仍是 Markdown，这里只决定预览时往哪加载。
 *
 * 远程图直接用 https/http。本机文件交给 Tauri 的 asset 协议。
 * 其它协议（例如 javascript:）不预览，源码留在原文里。
 */

let baseDir: string | null = null

/** 当前文档所在目录。相对路径靠它拼。还没落盘时为空。 */
export function setImageBaseDir(dir: string | null): void {
  baseDir = dir
}

export function imageBaseDir(): string | null {
  return baseDir
}

/** `/a/b/c.md` → `/a/b`。没有目录时返回 null。 */
export function directoryOf(path: string): string | null {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (slash <= 0) return null
  return path.slice(0, slash)
}

export interface ResolvedImage {
  readonly href: string
  /** file 表示要走本机文件，浏览器开发态打不开。 */
  readonly kind: 'remote' | 'data' | 'file'
}

/**
 * 把 Markdown 里的目标收成可以塞进 img.src 的地址。
 * 认不出来时返回 null，调用方就不要拿图把源码盖住。
 */
export function resolveImageHref(raw: string, dir: string | null): ResolvedImage | null {
  const url = raw.trim().replace(/^<|>$/g, '')
  if (url === '') return null
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(url)) return { kind: 'data', href: url }
  if (/^https?:\/\//i.test(url)) return { kind: 'remote', href: url }
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null

  const path = url.startsWith('/') ? url : joinRelative(dir, url)
  if (path === null) return null
  const href = assetHref(path)
  if (href === null) return { kind: 'file', href: path }
  return { kind: 'file', href }
}

function joinRelative(dir: string | null, raw: string): string | null {
  if (dir === null || dir === '') return null
  const parts = dir.split('/').filter((part) => part !== '')
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  if (parts.length === 0) return null
  return `/${parts.join('/')}`
}

function assetHref(path: string): string | null {
  if (typeof window === 'undefined') return null
  const internals = (
    window as Window & {
      __TAURI_INTERNALS__?: { convertFileSrc?: (filePath: string, protocol?: string) => string }
    }
  ).__TAURI_INTERNALS__
  if (typeof internals?.convertFileSrc !== 'function') return null
  return internals.convertFileSrc(path, 'asset')
}
