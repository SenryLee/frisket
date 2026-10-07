/**
 * Markdown 语言扩展装配 —— M0 语法集成的唯一入口
 *
 * 在整体中的位置：core/editor.config.ts 拿这里的产物组装编辑器。
 * 单独成文件的原因：GFM 扩展需要动态 import（包体压到 12MB 的关键），
 * 静态 import 会让300KB 的语法包无条件进主 bundle。
 *
 * ── 一个容易踩的坑 ────────────────────────────────────────────
 * GFM 扩展不在 @codemirror/lang-markdown 里，而在 @lezer/markdown 里。
 * lang-markdown 只负责把 MarkdownConfig 接到 CodeMirror 的语言管线，
 * 真正扩展语法的是 lezer 层的 MarkdownExtension。
 * 写成 import { GFM } from '@codemirror/lang-markdown' 会静默得到 undefined，
 * 表现为「删除线不解析」且没有任何报错 —— 极难排查。
 *
 * M1 的表格 / 图片 / 任务列表 / frontmatter / 脚注都在本文件挂载，
 * 不散落到其他模块 —— 语法支持范围是单一事实来源。
 */

import type { Extension } from '@codemirror/state'

/**
 * 动态模块的最小结构声明。
 *
 * 动态 import 的返回值类型在编译期无法保证（模块解析失败、版本漂移都会抛），
 * 但绝不能用 any 蒙混：用 unknown 收口，再由 parse 逐字段校验，
 * 失败时降级为「纯文本编辑器」而不是整页崩溃。
 */
interface MarkdownModule {
  readonly markdown: (config?: MarkdownOptions) => LanguageSupport
}

/** @codemirror/lang-markdown 的 markdown() 配置项（只声明我们用到的）。 */
interface MarkdownOptions {
  readonly addKeymap?: boolean
  readonly extensions?: readonly unknown[]
  readonly completeHTMLTags?: boolean
}

interface LanguageSupport {
  readonly extension: Extension
}

/** 语法包加载成功后的产物。 */
export type LanguageBundle = Extension

/**
 * 校验动态模块的结构。
 *
 * 只认markdown 一个符号：GFM 缺失不致命（少了删除线），
 * markdown 缺失才致命。两者都要区分对待，否则会把「降级」误判成「崩溃」。
 */
function parseModule(raw: unknown): MarkdownModule | null {
  if (typeof raw !== 'object' || raw === null) return null
  const markdown = (raw as Record<string, unknown>)['markdown']
  return typeof markdown === 'function'
    ? { markdown: markdown as MarkdownModule['markdown'] }
    : null
}

/**
 * 加载 Markdown 语言支持（含 GFM）。
 *
 * 返回 null 表示降级：调用方应继续用纯文本模式启动，
 * 并把语言能力标记为不可用（状态栏可提示语法高亮未启用）。
 * 绝不 throw —— 语言包缺失不该让编辑器打不开。
 */
export async function loadMarkdownSupport(): Promise<LanguageBundle | null> {
  try {
    const [markdownRaw, gfmRaw] = await Promise.all([
      import('@codemirror/lang-markdown'),
      import('@lezer/markdown'),
    ])

    const module = parseModule(markdownRaw)
    if (module === null) return null

    // GFM 是 MarkdownConfig[]，直接展开成扩展数组传给 markdown()
    const gfm = (gfmRaw as { GFM?: unknown }).GFM
    const extensions = Array.isArray(gfm) ? gfm : []

    return module.markdown({
      addKeymap: false, // 键位由 editor/keys.ts 统一管理，避免两处重复绑定 Enter
      completeHTMLTags: false, // M0 不做 HTML 补全，它会在每次输入 < 时跑匹配
      extensions,
    }).extension
  } catch {
    return null
  }
}

/**
 * 语法元素注册位 —— 供outline / 大纲 / 状态栏查询支持范围。
 *
 * 之所以做成数据而非散落的常量判断：M1 加表格时大纲要显示表头行，
 * 届时需要一个统一查询「哪些元素会产生大纲节点」的地方。
 */
export const SYNTAX_ELEMENTS = {
  heading: true,
  emphasis: true,
  strikethrough: true,
  inlineCode: true,
  link: true,
  fencedCode: true,
  blockquote: true,
  list: true,
  horizontalRule: true,
  // M1 待实现，此处仅占位以明确边界
  table: false,
  image: false,
  taskList: false,
  frontmatter: false,
  footnote: false,
} as const

export type SyntaxElement = keyof typeof SYNTAX_ELEMENTS