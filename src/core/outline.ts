/**
 * 从纯 Markdown 抽出标题树。
 * 只认井号标题。代码块里的井号不当成标题。
 */

export interface OutlineNode {
  key: string
  level: number
  text: string
  /** 0-based，交给编辑器滚动。 */
  line: number
  from: number
  children: OutlineNode[]
}

export interface OutlineRow {
  key: string
  text: string
  line: number
  from: number
  /** 相对本篇最浅的标题。一篇从二级标题写起时，二级就是最左。 */
  depth: number
  hasChildren: boolean
  open: boolean
}

const ATX = /^( {0,3})(#{1,6})(?:[ \t]+(.*))?$/

/** 把标题行收成目录上能读的一句。 */
export function outlineLabel(raw: string): string {
  const withoutClose = raw.replace(/[ \t]+#+\s*$/, '')
  return withoutClose
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*_~]+/g, '')
    .trim()
}

export function parseOutline(markdown: string): OutlineNode[] {
  const flat: OutlineNode[] = []
  const lines = markdown.split('\n')
  let offset = 0
  let fenceChar = ''
  let fenceLen = 0

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const line = lines[lineNo] ?? ''
    const body = line.endsWith('\r') ? line.slice(0, -1) : line
    if (fenceChar !== '') {
      const close = new RegExp(`^ {0,3}${fenceChar}{${fenceLen},}\\s*$`)
      if (close.test(body)) {
        fenceChar = ''
        fenceLen = 0
      }
    } else {
      const fence = /^( {0,3})(`{3,}|~{3,})/.exec(body)
      if (fence?.[2]) {
        fenceChar = fence[2][0] ?? ''
        fenceLen = fence[2].length
      } else {
        const heading = readAtx(body, lineNo, offset)
        if (heading) flat.push(heading)
      }
    }
    offset += line.length + 1
  }

  return nest(flat)
}

/** 光标落在哪一节。折叠起来的子标题，算到还能看见的那一层。 */
export function activeOutlineKey(
  nodes: readonly OutlineNode[],
  cursor: number,
  collapsed: ReadonlySet<string>,
): string | null {
  let active: string | null = null
  const visit = (list: readonly OutlineNode[], hidden: boolean): void => {
    for (const node of list) {
      if (!hidden && node.from <= cursor) active = node.key
      visit(node.children, hidden || collapsed.has(node.key))
    }
  }
  visit(nodes, false)
  return active
}

export function outlineRows(
  nodes: readonly OutlineNode[],
  collapsed: ReadonlySet<string>,
): OutlineRow[] {
  if (nodes.length === 0) return []
  const shallow = shallowest(nodes)
  const rows: OutlineRow[] = []
  const visit = (list: readonly OutlineNode[]): void => {
    for (const node of list) {
      const open = !collapsed.has(node.key)
      rows.push({
        key: node.key,
        text: node.text,
        line: node.line,
        from: node.from,
        depth: node.level - shallow,
        hasChildren: node.children.length > 0,
        open,
      })
      if (open) visit(node.children)
    }
  }
  visit(nodes)
  return rows
}

function readAtx(body: string, line: number, from: number): OutlineNode | null {
  const match = ATX.exec(body)
  if (!match?.[2]) return null
  if (match[3] === undefined) return null
  const text = outlineLabel(match[3])
  if (text === '') return null
  return {
    key: String(from),
    level: match[2].length,
    text,
    line,
    from,
    children: [],
  }
}

function nest(flat: readonly OutlineNode[]): OutlineNode[] {
  const roots: OutlineNode[] = []
  const stack: OutlineNode[] = []
  for (const item of flat) {
    const node: OutlineNode = { ...item, children: [] }
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= node.level) {
      stack.pop()
    }
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(node)
    else roots.push(node)
    stack.push(node)
  }
  return roots
}

function shallowest(nodes: readonly OutlineNode[]): number {
  let level = 6
  const visit = (list: readonly OutlineNode[]): void => {
    for (const node of list) {
      if (node.level < level) level = node.level
      visit(node.children)
    }
  }
  visit(nodes)
  return level
}
