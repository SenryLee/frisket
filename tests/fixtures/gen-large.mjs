#!/usr/bin/env node
/**
 * 生成 5000 行性能测试文档。
 *
 * 为什么要脚本生成而不是提交一个 5000 行的 .md：
 * 提交后每次改动都会产生巨大的 git diff，review 时无法看清改了什么，
 * 而且行数会随内容微调而漂移，「到底是不是 5000 行」变成一个需要人工核对的事实。
 * 生成器把这个事实变成可执行的代码。
 *
 * 用法：node tests/fixtures/gen-large.mjs
 * 幂等：重复执行结果一致，便于 CI 校验。
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** 目标行数。M0 验收标准是「5000 行滚动 FPS ≥ 55」。 */
const TARGET_LINES = 5000

const here = dirname(fileURLToPath(import.meta.url))
const outPath = join(here, 'large-5k.md')

/**
 * 段落模板。
 *
 * 为什么要混合多种语法：真实文档不是纯文本。
 * 如果全部是纯段落，解析开销会被低估，测出来的 FPS 是虚高的，
 * 等真实文档上线时性能问题才暴露 —— 那时候再回头改解析层就来不及了。
 */
const paragraphTemplates = [
  '这是第 {n} 个普通段落，用于测量纯文本场景下的滚动与解析性能。',
  '第 {n} 段包含 **粗体** 与 *斜体*，用于测量行内装饰的重算开销。',
  '第 {n} 段包含 `行内代码`，行内代码不应触发任何解析。',
  '第 {n} 段包含 [链接](https://example.com/{n})，链接标记应当被隐藏。',
  '第 {n} 段包含 ~~删除线~~，GFM 扩展的解析开销需要被计入。',
  '第 {n} 段是中文段落，测量中文分词与换行处理，字符宽度计算比拉丁文更慢。',
  '第 {n} 段较长，{"填充内容".repeat(6)}，用于制造长短行混合的真实场景。',
]

const lines = []

// 首屏放一个标题，让打开文档时光标有明确落点。
lines.push('# 性能测试文档', '')
lines.push('本文件由 tests/fixtures/gen-large.mjs 生成，请勿手工编辑。', '')

let paragraphIndex = 0

while (lines.length < TARGET_LINES) {
  const template = paragraphTemplates[paragraphIndex % paragraphTemplates.length]
  if (template === undefined) {
    throw new Error('模板数组意外为空，这不该发生')
  }
  const text = template.replaceAll('{n}', String(paragraphIndex + 1))
  paragraphIndex += 1

  lines.push(text)

  // 每 12 段插入一个二级标题与一条水平线。
  // 标题与水平线都会触发不同的 decoration 分支，必须进入性能样本。
  if (paragraphIndex % 12 === 0) {
    lines.push('', `## 第 ${paragraphIndex / 12} 节`, '')
    if (paragraphIndex % 24 === 0) {
      lines.push('---', '')
    }
  }

  // 每 60 段插入一个引用块，每 90 段插入一个围栏代码块。
  if (paragraphIndex % 60 === 0) {
    lines.push('> 第 ' + paragraphIndex + ' 段的引用，包含 **粗体**。', '')
  }
  if (paragraphIndex % 90 === 0) {
    lines.push('```ts', `const n = ${paragraphIndex};`, '```', '')
  }
}

const content = lines.slice(0, TARGET_LINES).join('\n') + '\n'

writeFileSync(outPath, content, 'utf8')

const actualLines = content.split('\n').length - 1
if (actualLines !== TARGET_LINES) {
  throw new Error(`行数不符：期望 ${TARGET_LINES}，实际 ${actualLines}`)
}

process.stdout.write(`已生成 ${outPath}（${actualLines} 行）\n`)