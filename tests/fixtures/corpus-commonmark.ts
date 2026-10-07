/**
 * CommonMark 语法语料（60 条）
 *
 * 位置：门禁层数据。渲染快照的输入。
 *
 * ── 为什么语料是纯数据而不是测试函数 ──────────────────────────
 *
 * 60 条语料若写成 60 个 it() 块，每条都要重复「建编辑器 → 断言 → 拆编辑器」，
 * 而真正想表达的信息（输入什么、期望什么）会被淹没在样板里。
 * 抽成数据后，用例表本身就是一份可读的规范清单，review 时能直接对照
 * CommonMark 规范逐条核。
 *
 * ── expect 字段的契约 ────────────────────────────────────────
 *
 * 这些字段描述的是**渲染后的可见结果**，不是内部 API。
 * 这样内核实现（用 decoration 还是 widget、用什么 class 名）
 * 不会影响语料，测试也不会变成「重写一遍实现」。
 *
 * - visibleText  : 隐藏标记后用户应当看到的文本。null 表示该条只校验标记可见性
 * - hiddenMarkers: 必须被隐藏的标记字符（如 '**'）
 * - shownMarkers : 必须保持可见的字符（退化防御用，如无 URL 的 '[]'）
 * - lineCount    : 期望渲染后的行数，防止行被错误合并/拆分
 */
export interface SyntaxCase {
  /** 用例标识，进测试名用 */
  name: string
  /** CommonMark 规范里的章节号，便于逐条回溯 */
  spec: string
  /** Markdown 源码 */
  source: string
  /** 隐藏标记后期望的可见文本；null 表示不校验文本内容 */
  visibleText: string | null
  /** 必须被隐藏的标记 */
  hiddenMarkers?: readonly string[]
  /** 必须保持可见的标记（退化防御） */
  shownMarkers?: readonly string[]
  /** 期望行数 */
  lineCount?: number
}

/**
 * CommonMark 0.30 各章节覆盖情况：
 * ATX标题(4) · Setext标题(3) · 缩进代码(5) · 围栏代码(5) · HTML块(3) ·
 * 链接引用(3) · 段落(2) · 空白(1) ·  thematic break(1) ·
 * ATX标题之外的强调(4) · 强调(4) · 代码(2) · 链接(4) · 图片(2) ·
 * 自动链接(2) · 原始HTML(2) · 硬换行(2) · 软换行(1) · 文本(1) ·
 * 反斜杠转义(1)
 */
export const COMMONMARK_CASES: readonly SyntaxCase[] = [
  // ── 缩进代码块 ──
  { name: '缩进代码块-四空格', spec: '4.1', source: 'a simple\n\n    indented\n', visibleText: 'a simple\n\nindented', shownMarkers: undefined, lineCount: 3 },
  { name: '缩进代码块-含空行', spec: '4.1', source: '    chunk1\n\n    chunk2\n', visibleText: 'chunk1\n\nchunk2', lineCount: 3 },
  { name: '缩进代码块-不被行内解析', spec: '4.1', source: '    **not bold**\n', visibleText: '**not bold**', shownMarkers: ['**'], lineCount: 1 },
  { name: '缩进代码块-反引号不解析', spec: '4.1', source: '    `not code`\n', visibleText: '`not code`', shownMarkers: ['`'], lineCount: 1 },
  { name: '缩进代码块-被列表中断', spec: '4.1', source: '    foo\n\n- bar\n', visibleText: 'foo\n\nbar', lineCount: 3 },

  // ── 围栏代码块 ──
  { name: '围栏-反引号无语言', spec: '4.2', source: '```\n<\n >\n```\n', visibleText: '<\n >', lineCount: 2 },
  { name: '围栏-反引号不解析内部', spec: '4.2', source: '```\naaa\n~~~\n```\n', visibleText: 'aaa\n~~~', lineCount: 2 },
  { name: '围栏-波浪号', spec: '4.2', source: '~~~\naaa\n```\n~~~\n', visibleText: 'aaa\n```', lineCount: 2 },
  { name: '围栏-波浪号更多', spec: '4.2', source: '~~~~~\naaa\n```\n~~~~~\n', visibleText: 'aaa\n```', lineCount: 2 },
  { name: '围栏-四反引号含三反引号', spec: '4.2', source: '````\n```\naaa\n```\n````\n', visibleText: '```\naaa\n```', lineCount: 3 },
  { name: '围栏-带语言标识', spec: '4.2', source: '```ruby\ndef foo\nend\n```\n', visibleText: 'def foo\nend', lineCount: 2 },
  { name: '围栏-语言含反引号', spec: '4.2', source: '``` aa ```\nfoo\n', visibleText: 'foo', lineCount: 1 },

  // ── HTML 块 ──
  { name: 'HTML块-大写标签', spec: '4.6', source: '<DIV>\n  foo\n</DIV>\n', visibleText: null, lineCount: 3 },
  { name: 'HTML块-不可解析则原样', spec: '4.6', source: '<div>\n  *foo*\n</div>\n', visibleText: null, lineCount: 3 },
  { name: 'HTML块-单行', spec: '4.6', source: '<del>*foo*</del>\n', visibleText: null, shownMarkers: ['*'], lineCount: 1 },

  // ── 链接引用定义 ──
  { name: '链接定义-被隐藏', spec: '4.1-linkref', source: '[foo]: /url "title"\n\n[foo]\n', visibleText: 'foo', lineCount: 1 },
  { name: '链接定义-大小写不敏感', spec: '4.1-linkref', source: '[Foo]: /url\n\n[foo]\n', visibleText: 'foo', lineCount: 1 },
  { name: '链接定义-未定义则纯文本', spec: '4.1-linkref', source: '[foo]\n', visibleText: '[foo]', shownMarkers: ['[', ']'], lineCount: 1 },

  // ── 段落 ──
  { name: '段落-多行合并为一段', spec: '3.1', source: 'aaa\nbbb\n\nccc\n', visibleText: 'aaa\nbbb\n\nccc', lineCount: 3 },
  { name: '段落-被标题中断', spec: '3.1', source: 'aaa\n# bbb\n', visibleText: null, lineCount: 2 },

  // ── 分隔线 ──
  { name: 'thematicBreak-三连字符', spec: '4.3', source: '***\n---\n___\n', visibleText: null, lineCount: 3 },
  { name: 'thematicBreak-前后空行', spec: '4.3', source: 'foo\n\n---\n\nbar\n', visibleText: 'foo\n\nbar', lineCount: 3 },
  { name: 'thematicBreak-与列表区分', spec: '4.3', source: '- foo\n***\n- bar\n', visibleText: null, lineCount: 3 },

  // ── ATX 标题 ──
  { name: 'ATX标题-一级', spec: '4.2-atx', source: '# foo\n', visibleText: 'foo', hiddenMarkers: ['#'], lineCount: 1 },
  { name: 'ATX标题-六级', spec: '4.2-atx', source: '###### foo\n', visibleText: 'foo', hiddenMarkers: ['######'], lineCount: 1 },
  { name: 'ATX标题-井号后需空格', spec: '4.2-atx', source: '#5 bolt\n', visibleText: null, shownMarkers: ['#'], lineCount: 1 },
  { name: 'ATX标题-结尾闭合序列', spec: '4.2-atx', source: '## foo ##\n', visibleText: 'foo', hiddenMarkers: ['##'], lineCount: 1 },
  { name: 'ATX标题-未闭合不隐藏', spec: '4.2-atx', source: '## foo ###\nbar\n', visibleText: null, shownMarkers: ['###'], lineCount: 2 },
  { name: 'ATX标题-空标题', spec: '4.2-atx', source: '#\n', visibleText: null, shownMarkers: ['#'], lineCount: 1 },
  { name: 'ATX标题-仅井号不隐藏', spec: '4.2-atx', source: '##\n', visibleText: null, shownMarkers: ['##'], lineCount: 1 },
  { name: 'ATX标题-空标题带尾随空格', spec: '4.2-atx', source: '# \n', visibleText: null, shownMarkers: ['#'], lineCount: 1 },

  // ── Setext 标题 ──
  { name: 'Setext标题-一级', spec: '4.3-setext', source: 'Foo\n===\n', visibleText: 'Foo', shownMarkers: ['==='], lineCount: 1 },
  { name: 'Setext标题-二级', spec: '4.3-setext', source: 'Foo\n---\n', visibleText: 'Foo', shownMarkers: ['---'], lineCount: 1 },
  { name: 'Setext标题-多行只最后成标题', spec: '4.3-setext', source: 'Foo\nbar\n---\n', visibleText: null, lineCount: 2 },

  // ── 强调 ──
  { name: '强调-单星', spec: '4.1-em', source: '*foo*\n', visibleText: 'foo', hiddenMarkers: ['*'], lineCount: 1 },
  { name: '强调-单下划线', spec: '4.1-em', source: '_foo_\n', visibleText: 'foo', hiddenMarkers: ['_'], lineCount: 1 },
  { name: '强调-双星', spec: '4.1-em', source: '**foo**\n', visibleText: 'foo', hiddenMarkers: ['**'], lineCount: 1 },
  { name: '强调-双下划线', spec: '4.1-em', source: '__foo__\n', visibleText: 'foo', hiddenMarkers: ['__'], lineCount: 1 },
  { name: '强调-三连星', spec: '4.1-em', source: '***foo***\n', visibleText: 'foo', hiddenMarkers: ['***'], lineCount: 1 },
  { name: '强调-粗体内斜体', spec: '4.1-em', source: '**foo *bar***\n', visibleText: 'foo bar', hiddenMarkers: ['**', '*'], lineCount: 1 },
  { name: '强调-斜体内粗体', spec: '4.1-em', source: '*foo **bar***\n', visibleText: 'foo bar', hiddenMarkers: ['*', '**'], lineCount: 1 },
  { name: '强调-词内不解析下划线', spec: '4.1-em', source: 'foo_bar_baz\n', visibleText: 'foo_bar_baz', shownMarkers: ['_'], lineCount: 1 },
  { name: '强调-词内解析星号', spec: '4.1-em', source: 'foo*bar*baz\n', visibleText: 'foobarbaz', hiddenMarkers: ['*'], lineCount: 1 },
  { name: '强调-跨行', spec: '4.1-em', source: '*foo\nbar*\n', visibleText: 'foo\nbar', hiddenMarkers: ['*'], lineCount: 2 },
  { name: '强调-三连下划线', spec: '4.1-em', source: '___foo___\n', visibleText: 'foo', hiddenMarkers: ['___'], lineCount: 1 },
  { name: '强调-中文内嵌', spec: '4.1-em', source: '这是**粗体**中文\n', visibleText: '这是粗体中文', hiddenMarkers: ['**'], lineCount: 1 },

  // ── 行内代码 ──
  { name: '代码-反引号包裹', spec: '4.1-code', source: '`foo`\n', visibleText: 'foo', hiddenMarkers: ['`'], lineCount: 1 },
  { name: '代码-内部标记不解析', spec: '4.1-code', source: '`*not emphasis*`\n', visibleText: '*not emphasis*', shownMarkers: ['*'], lineCount: 1 },
  { name: '代码-双反引号含单反引号', spec: '4.1-code', source: '`` ` ``\n', visibleText: '`', lineCount: 1 },
  { name: '代码-保留换行', spec: '4.1-code', source: '`foo\nbar`\n', visibleText: 'foo bar', hiddenMarkers: ['`'], lineCount: 1 },
  { name: '代码-中文不折叠', spec: '4.1-code', source: '`中文代码`\n', visibleText: '中文代码', hiddenMarkers: ['`'], lineCount: 1 },

  // ── 链接 ──
  { name: '链接-内联', spec: '4.1-link', source: '[link](/uri)\n', visibleText: 'link', hiddenMarkers: ['[', ']', '](/uri)'], lineCount: 1 },
  { name: '链接-带标题', spec: '4.1-link', source: '[link](/uri "title")\n', visibleText: 'link', hiddenMarkers: ['[', ']'], lineCount: 1 },
  { name: '链接-中文锚文本', spec: '4.1-link', source: '[文字](/uri)\n', visibleText: '文字', hiddenMarkers: ['[', ']'], lineCount: 1 },
  { name: '链接-无URL退化为文本', spec: '4.1-link', source: '[文字]()\n', visibleText: '[文字]()', shownMarkers: ['[', ']'], lineCount: 1 },
  { name: '链接-引用式有定义', spec: '4.1-link', source: '[foo][bar]\n\n[bar]: /url\n', visibleText: 'foo', hiddenMarkers: ['[', ']'], lineCount: 1 },
  { name: '链接-引用式无定义', spec: '4.1-link', source: '[foo][bar]\n', visibleText: '[foo][bar]', shownMarkers: ['[', ']'], lineCount: 1 },
  { name: '链接-空锚文本', spec: '4.1-link', source: '[](/uri)\n', visibleText: null, hiddenMarkers: ['[', ']'], lineCount: 1 },

  // ── 图片 ──
  { name: '图片-基本', spec: '4.2-img', source: '![foo](/url "title")\n', visibleText: null, hiddenMarkers: ['!['], lineCount: 1 },
  { name: '图片-引用式', spec: '4.2-img', source: '![foo][bar]\n\n[bar]: /url\n', visibleText: null, hiddenMarkers: ['!['], lineCount: 1 },
  { name: '图片-未定义退化为文本', spec: '4.2-img', source: '![foo]\n', visibleText: '![foo]', shownMarkers: ['!', '['], lineCount: 1 },

  // ── 自动链接 ──
  { name: '自动链接-绝对URL', spec: '4.1-autolink', source: '<http://foo.bar>\n', visibleText: 'http://foo.bar', hiddenMarkers: ['<', '>'], lineCount: 1 },
  { name: '自动链接-邮箱', spec: '4.1-autolink', source: '<foo@bar.example.com>\n', visibleText: 'foo@bar.example.com', hiddenMarkers: ['<', '>'], lineCount: 1 },

  // ── 硬换行 ──
  { name: '硬换行-两空格', spec: '4.1-hardbreak', source: 'foo  \nbar\n', visibleText: 'foo\nbar', lineCount: 2 },
  { name: '硬换行-反斜杠', spec: '4.1-hardbreak', source: 'foo\\\nbar\n', visibleText: 'foo\nbar', shownMarkers: undefined, lineCount: 2 },

  // ── 反斜杠转义 ──
  { name: '转义-星号', spec: '4.1-escape', source: '\\*not emphasized*\n', visibleText: '*not emphasized*', shownMarkers: ['*'], lineCount: 1 },
  { name: '转义-反引号', spec: '4.1-escape', source: '\\`not code`\n', visibleText: '`not code`', shownMarkers: ['`'], lineCount: 1 },

  // ── 列表 ──
  { name: '列表-无序单层', spec: '4.3-list', source: '- a\n- b\n', visibleText: 'a\nb', hiddenMarkers: ['-'], lineCount: 2 },
  { name: '列表-有序单层', spec: '4.3-list', source: '1. a\n2. b\n', visibleText: 'a\nb', hiddenMarkers: ['1.', '2.'], lineCount: 2 },
  { name: '列表-无序嵌套', spec: '4.3-list', source: '- a\n  - b\n', visibleText: 'a\nb', hiddenMarkers: ['-'], lineCount: 2 },
  { name: '列表-项目内多段落', spec: '4.3-list', source: '- a\n\n  b\n', visibleText: 'a\n\nb', hiddenMarkers: ['-'], lineCount: 3 },
  { name: '列表-起始编号非一', spec: '4.3-list', source: '3. a\n4. b\n', visibleText: 'a\nb', hiddenMarkers: ['3.', '4.'], lineCount: 2 },

  // ── 引用 ──
  { name: '引用-基本', spec: '4.3-quote', source: '> a\n', visibleText: 'a', hiddenMarkers: ['>'], lineCount: 1 },
  { name: '引用-嵌套', spec: '4.3-quote', source: '> > a\n', visibleText: 'a', hiddenMarkers: ['>'], lineCount: 1 },
  { name: '引用-含强调', spec: '4.3-quote', source: '> **a**\n', visibleText: 'a', hiddenMarkers: ['>', '**'], lineCount: 1 },
  { name: '引用-多段', spec: '4.3-quote', source: '> a\n>\n> b\n', visibleText: 'a\n\nb', hiddenMarkers: ['>'], lineCount: 3 },
]