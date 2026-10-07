import type { SyntaxCase } from './corpus-commonmark'

/**
 * GFM 语法语料（60 条）
 *
 * 位置：门禁层数据。渲染快照的输入。
 *
 * GFM 在 CommonMark 之上扩展了五类语法：
 * 删除线（§6.5）· 任务列表（§5.3）· 自动链接（§6.9）·
 * 表格（§4.10）· 禁用语法（§7）
 *
 * 另有若干条属于「必须退化为纯文本」的防御用例 ——
 * 它们与正确渲染同样重要。竞品的已知缺陷正是在这一类上翻车：
 * 把用户随手写的方括号当成链接、隐藏 `[]`，用户回头完全看不见自己写了什么。
 */

/** GFM 表格单元格内的内容需要独立描述，故允许表格语料自带期望。 */
export interface TableCase extends SyntaxCase {
  /** 表头单元格的可见文本 */
  headerCells?: readonly string[]
  /** 表格总行数（含表头与分隔行） */
  tableRows?: number
}

export const GFM_CASES: readonly TableCase[] = [
  // ── 删除线 §6.5 ──
  { name: '删除线-基本', spec: 'GFM 6.5', source: '~~Hi~~ Hello, world!\n', visibleText: 'Hi Hello, world!', hiddenMarkers: ['~~'], lineCount: 1 },
  { name: '删除线-中文', spec: 'GFM 6.5', source: '这是~~被删除~~的文字\n', visibleText: '这是被删除的文字', hiddenMarkers: ['~~'], lineCount: 1 },
  { name: '删除线-三个波浪号', spec: 'GFM 6.5', source: '~~~foo~~~\n', visibleText: 'foo', hiddenMarkers: ['~~~'], lineCount: 1 },
  { name: '删除线-单波浪号不解析', spec: 'GFM 6.5', source: '~foo~\n', visibleText: '~foo~', shownMarkers: ['~'], lineCount: 1 },
  { name: '删除线-内含粗体', spec: 'GFM 6.5', source: '~~**粗体**被删~~\n', visibleText: '粗体被删', hiddenMarkers: ['~~', '**'], lineCount: 1 },
  { name: '删除线-内含粗斜体', spec: 'GFM 6.5', source: '~~***abc***~~\n', visibleText: 'abc', hiddenMarkers: ['~~', '***'], lineCount: 1 },
  { name: '删除线-未闭合不隐藏', spec: 'GFM 6.5', source: '~~未闭合\n', visibleText: '~~未闭合', shownMarkers: ['~~'], lineCount: 1 },
  { name: '删除线-跨行', spec: 'GFM 6.5', source: '~~foo\nbar~~\n', visibleText: 'foo\nbar', hiddenMarkers: ['~~'], lineCount: 2 },
  { name: '删除线-与强调区别', spec: 'GFM 6.5', source: '*foo* vs ~~bar~~\n', visibleText: 'foo vs bar', hiddenMarkers: ['*', '~~'], lineCount: 1 },
  { name: '删除线-整行', spec: 'GFM 6.5', source: '~~整行删除~~\n', visibleText: '整行删除', hiddenMarkers: ['~~'], lineCount: 1 },

  // ── 任务列表 §5.3 ──
  { name: '任务列表-未勾选', spec: 'GFM 5.3', source: '- [ ] task\n', visibleText: 'task', hiddenMarkers: ['- [ ]'], lineCount: 1 },
  { name: '任务列表-已勾选', spec: 'GFM 5.3', source: '- [x] task\n', visibleText: 'task', hiddenMarkers: ['- [x]'], lineCount: 1 },
  { name: '任务列表-大写X', spec: 'GFM 5.3', source: '- [X] task\n', visibleText: 'task', hiddenMarkers: ['- [X]'], lineCount: 1 },
  { name: '任务列表-多行混合', spec: 'GFM 5.3', source: '- [x] done\n- [ ] todo\n', visibleText: 'done\ntodo', hiddenMarkers: ['[x]', '[ ]'], lineCount: 2 },
  { name: '任务列表-有序', spec: 'GFM 5.3', source: '1. [ ] task\n', visibleText: 'task', hiddenMarkers: ['[ ]'], lineCount: 1 },
  { name: '任务列表-带粗体', spec: 'GFM 5.3', source: '- [x] **完成**了\n', visibleText: '完成了', hiddenMarkers: ['[x]', '**'], lineCount: 1 },
  { name: '任务列表-中文', spec: 'GFM 5.3', source: '- [ ] 待办事项\n', visibleText: '待办事项', hiddenMarkers: ['[ ]'], lineCount: 1 },
  { name: '任务列表-方括号不完整', spec: 'GFM 5.3', source: '- [ ]task\n', visibleText: '[ ]task', shownMarkers: ['[ ]'], lineCount: 1 },
  { name: '任务列表-多空格', spec: 'GFM 5.3', source: '-   [ ]   task\n', visibleText: 'task', hiddenMarkers: ['[ ]'], lineCount: 1 },
  { name: '任务列表-普通列表项不受影响', spec: 'GFM 5.3', source: '- 普通项\n', visibleText: '普通项', hiddenMarkers: ['-'], lineCount: 1 },

  // ── 自动链接 §6.9 ──
  { name: '扩展自动链接-www', spec: 'GFM 6.9', source: 'www.commonmark.org\n', visibleText: 'www.commonmark.org', lineCount: 1 },
  { name: '扩展自动链接-http', spec: 'GFM 6.9', source: 'http://commonmark.org\n', visibleText: 'http://commonmark.org', lineCount: 1 },
  { name: '扩展自动链接-https', spec: 'GFM 6.9', source: 'https://commonmark.org\n', visibleText: 'https://commonmark.org', lineCount: 1 },
  { name: '扩展自动链接-带www前缀', spec: 'GFM 6.9', source: 'Visit www.commonmark.org/help for more information.\n', visibleText: 'Visit www.commonmark.org/help for more information.', lineCount: 1 },
  { name: '扩展自动链接-句内', spec: 'GFM 6.9', source: 'Visit www.commonmark.org.\n', visibleText: 'Visit www.commonmark.org.', lineCount: 1 },
  { name: '扩展自动链接-带协议与查询', spec: 'GFM 6.9', source: 'https://example.com/?a=1&b=2\n', visibleText: 'https://example.com/?a=1&b=2', lineCount: 1 },

  // ── 表格 §4.10 ──
  { name: '表格-基本两列', spec: 'GFM 4.10', source: '| a | b |\n| - | - |\n| 1 | 2 |\n', visibleText: null, headerCells: ['a', 'b'], tableRows: 3, lineCount: 3 },
  { name: '表格-含对齐', spec: 'GFM 4.10', source: '| a | b | c |\n| :- | :-: | -: |\n| 1 | 2 | 3 |\n', visibleText: null, headerCells: ['a', 'b', 'c'], tableRows: 3, lineCount: 3 },
  { name: '表格-中文表头', spec: 'GFM 4.10', source: '| 姓名 | 年龄 |\n| --- | --- |\n| 张三 | 30 |\n', visibleText: null, headerCells: ['姓名', '年龄'], tableRows: 3, lineCount: 3 },
  { name: '表格-单元格含粗体', spec: 'GFM 4.10', source: '| a | b |\n| - | - |\n| **x** | y |\n', visibleText: null, hiddenMarkers: ['**'], lineCount: 3 },
  { name: '表格-仅表头', spec: 'GFM 4.10', source: '| a | b |\n| - | - |\n', visibleText: null, headerCells: ['a', 'b'], tableRows: 2, lineCount: 2 },
  { name: '表格-多行', spec: 'GFM 4.10', source: '| a |\n| - |\n| 1 |\n| 2 |\n| 3 |\n', visibleText: null, headerCells: ['a'], tableRows: 5, lineCount: 5 },
  { name: '表格-转义管道', spec: 'GFM 4.10', source: '| a | b |\n| - | - |\n| x \\| y | z |\n', visibleText: null, headerCells: ['a', 'b'], tableRows: 3, lineCount: 3 },
  { name: '表格-空单元格', spec: 'GFM 4.10', source: '| a | b |\n| - | - |\n|   |   |\n', visibleText: null, headerCells: ['a', 'b'], tableRows: 3, lineCount: 3 },
  { name: '表格-行内代码', spec: 'GFM 4.10', source: '| a | b |\n| - | - |\n| `x` | y |\n', visibleText: null, hiddenMarkers: ['`'], lineCount: 3 },
  { name: '表格-缺少分隔行则不是表格', spec: 'GFM 4.10', source: '| a | b |\n| 1 | 2 |\n', visibleText: 'a b 1 2', shownMarkers: ['|'], lineCount: 2 },

  // ── 禁用语法 §7 ──
  { name: '禁用-内联HTML标签', spec: 'GFM 7', source: '<del>foo</del>\n', visibleText: null, shownMarkers: ['<', '>'], lineCount: 1 },
  { name: '禁用-纯HTML标签名', spec: 'GFM 7', source: '<title>foo</title>\n', visibleText: null, shownMarkers: ['<', '>'], lineCount: 1 },
  { name: '禁用-中文标签不解析', spec: 'GFM 7', source: '<中文标签>\n', visibleText: '<中文标签>', shownMarkers: ['<', '>'], lineCount: 1 },

  // ── 组合与嵌套 ──
  { name: '组合-引用内任务列表', spec: 'GFM 组合', source: '> - [x] done\n', visibleText: 'done', hiddenMarkers: ['>', '[x]'], lineCount: 1 },
  { name: '组合-引用内删除线', spec: 'GFM 组合', source: '> ~~del~~\n', visibleText: 'del', hiddenMarkers: ['>', '~~'], lineCount: 1 },
  { name: '组合-删除线内链接', spec: 'GFM 组合', source: '~~[link](/url)~~\n', visibleText: 'link', hiddenMarkers: ['~~', '[', ']'], lineCount: 1 },
  { name: '组合-删除线内图片', spec: 'GFM 组合', source: '~~![alt](/img)~~\n', visibleText: null, hiddenMarkers: ['~~', '!['], lineCount: 1 },
  { name: '组合-列表项内删除线', spec: 'GFM 组合', source: '- ~~del~~\n', visibleText: 'del', hiddenMarkers: ['-', '~~'], lineCount: 1 },
  { name: '组合-表格单元格内删除线', spec: 'GFM 组合', source: '| a |\n| - |\n| ~~x~~ |\n', visibleText: null, headerCells: ['a'], hiddenMarkers: ['~~'], tableRows: 3, lineCount: 3 },
  { name: '组合-四级强调', spec: 'GFM 组合', source: '***a *b* c***\n', visibleText: 'a b c', hiddenMarkers: ['***', '*'], lineCount: 1 },
  { name: '组合-粗体内代码', spec: 'GFM 组合', source: '**`code`**\n', visibleText: 'code', hiddenMarkers: ['**', '`'], lineCount: 1 },
  { name: '组合-代码内删除线不解析', spec: 'GFM 组合', source: '`~~not del~~`\n', visibleText: '~~not del~~', shownMarkers: ['~~', '`'], lineCount: 1 },
  { name: '组合-围栏内任务列表不解析', spec: 'GFM 组合', source: '```\n- [ ] x\n```\n', visibleText: '- [ ] x', shownMarkers: ['[ ]'], lineCount: 1 },
  { name: '组合-删除线跨列表项', spec: 'GFM 组合', source: '~~a\nb~~\n', visibleText: 'a\nb', hiddenMarkers: ['~~'], lineCount: 2 },
  { name: '组合-自动链接在粗体内', spec: 'GFM 组合', source: '**www.example.com**\n', visibleText: 'www.example.com', hiddenMarkers: ['**'], lineCount: 1 },

  // ── 中文场景（项目主语言，必须覆盖） ──
  { name: '中文-标题', spec: 'GFM 中文', source: '## 中文标题\n', visibleText: '中文标题', hiddenMarkers: ['##'], lineCount: 1 },
  { name: '中文-粗体与标点', spec: 'GFM 中文', source: '这是**重要的**，注意。\n', visibleText: '这是重要的，注意。', hiddenMarkers: ['**'], lineCount: 1 },
  { name: '中文-删除线', spec: 'GFM 中文', source: '~~废弃的方案~~\n', visibleText: '废弃的方案', hiddenMarkers: ['~~'], lineCount: 1 },
  { name: '中文-行内代码', spec: 'GFM 中文', source: '调用 `函数()` 完成\n', visibleText: '调用 函数() 完成', hiddenMarkers: ['`'], lineCount: 1 },
  { name: '中文-引用', spec: 'GFM 中文', source: '> 引用一段中文。\n', visibleText: '引用一段中文。', hiddenMarkers: ['>'], lineCount: 1 },
  { name: '中文-无序列表', spec: 'GFM 中文', source: '- 第一项\n- 第二项\n', visibleText: '第一项\n第二项', hiddenMarkers: ['-'], lineCount: 2 },
  { name: '中文-有序列表', spec: 'GFM 中文', source: '1. 一\n2. 二\n', visibleText: '一\n二', hiddenMarkers: ['1.', '2.'], lineCount: 2 },
  { name: '中文-任务列表', spec: 'GFM 中文', source: '- [x] 已完成\n- [ ] 待完成\n', visibleText: '已完成\n待完成', hiddenMarkers: ['[x]', '[ ]'], lineCount: 2 },
  { name: '中文-表格', spec: 'GFM 中文', source: '| 名称 | 值 |\n| --- | --- |\n| 甲 | 一 |\n', visibleText: null, headerCells: ['名称', '值'], tableRows: 3, lineCount: 3 },
  { name: '中文-中英混排加粗', spec: 'GFM 中文', source: '使用 **TypeScript** 编写\n', visibleText: '使用 TypeScript 编写', hiddenMarkers: ['**'], lineCount: 1 },
  { name: '中文-全角括号不退化', spec: 'GFM 中文', source: '这是（中文括号）不是链接\n', visibleText: '这是（中文括号）不是链接', shownMarkers: ['（', '）'], lineCount: 1 },
  { name: '中文-书名号不退化', spec: 'GFM 中文', source: '《书名》保持原样\n', visibleText: '《书名》保持原样', shownMarkers: ['《', '》'], lineCount: 1 },

  // ── 退化防御（已知竞品缺陷所在） ──
  { name: '防御-裸方括号不隐藏', spec: '防御', source: '数组索引 a[0] 的用法\n', visibleText: '数组索引 a[0] 的用法', shownMarkers: ['[', ']'], lineCount: 1 },
  { name: '防御-单独方括号', spec: '防御', source: '这是 [ 单独方括号 ]\n', visibleText: '这是 [ 单独方括号 ]', shownMarkers: ['[', ']'], lineCount: 1 },
  { name: '防御-空括号对', spec: '防御', source: '空括号对 []\n', visibleText: '空括号对 []', shownMarkers: ['[', ']'], lineCount: 1 },
  { name: '防御-多个空括号对', spec: '防御', source: '多个 [] [] []\n', visibleText: '多个 [] [] []', shownMarkers: ['[', ']'], lineCount: 1 },
  { name: '防御-空链接目标', spec: '防御', source: '[文字]()\n', visibleText: '[文字]()', shownMarkers: ['[', ']'], lineCount: 1 },
  { name: '防御-引用式无定义', spec: '防御', source: '[文字][未定义]\n', visibleText: '[文字][未定义]', shownMarkers: ['[', ']'], lineCount: 1 },
  { name: '防御-行内代码内的方括号不退化', spec: '防御', source: '`[数组]`\n', visibleText: '[数组]', shownMarkers: ['['], lineCount: 1 },
  { name: '防御-链接定义行本身', spec: '防御', source: '[ref]: https://example.com\n', visibleText: null, shownMarkers: ['ref', ':'], lineCount: 1 },
  { name: '防御-未闭合的粗体标记', spec: '防御', source: '**未闭合粗体\n', visibleText: '**未闭合粗体', shownMarkers: ['**'], lineCount: 1 },
  { name: '防御-未闭合的删除线', spec: '防御', source: '~~未闭合删除线\n', visibleText: '~~未闭合删除线', shownMarkers: ['~~'], lineCount: 1 },
]