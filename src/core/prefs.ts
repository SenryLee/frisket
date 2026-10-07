/**
 * 默认偏好 —— 设置尚未加载时的兜底值
 *
 * 在整体中的位置：core/editor.ts 在用户设置到位前用它建State。
 * 单独成文件是因为 prefs 的默认值是产品决策（字号、行高、栏宽），
 * 不该埋在编辑器工厂的实现里。
 */

import type { EditorPrefs } from '@/core/interfaces'

/**
 * 默认值。
 *
 * 字号的选取有依据：16px 是中文正文可读性的下限，
 * 再小宋体类字体在 Retina 上会糊。行高 1.7 也是中文排版惯例
 * （1.5 偏挤，2.0 偏散，中文里1.6~1.8 是共识区间）。
 */
export const DEFAULT_PREFS: EditorPrefs = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  fontSize: 16,
  lineHeight: 1.7,
  // 0 表示不限宽。中文长文本不限宽时一行能到 80+ 字，超过舒适阅读区间，
  // 但默认尊重用户选择，要限制在设置里开
  maxWidth: 0,
  typewriterMode: false,
  showLineNumbers: false,
  tabSize: 4,
  autoPair: true,
  autoFormat: true,
  scrollWidth: 36,
}