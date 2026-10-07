/**
 * 共享接口契约 —— 全项目唯一的类型定义来源
 *
 * 为什么单独一个文件：项目由多个子智能体并行开发，若各自定义 EditorSettings
 * 这类同名类型，会在集成时产生结构性冲突。因此约定：
 *   所有跨模块引用的类型，一律从本文件 import，禁止重复定义。
 *
 * 文件所有权：src/core/interfaces.ts 属于「内核」子智能体，
 * 其他子智能体只读不写，需要新增类型时上报。
 */

// ─────────────────────────────────────────────────────────────
// 文档
// ─────────────────────────────────────────────────────────────

/** 文档在历史记录中的元信息。不含正文，正文由文件路径按需读取。 */
export interface DocumentMeta {
  /** 稳定标识，优先用文件绝对路径的哈希 */
  id: string;
  /** 文件绝对路径 */
  path: string;
  /** 标题，取正文首个 H1，无 H1 则用文件名 */
  title: string;
  /** 去语法后的前 120 字预览 */
  preview: string;
  /** 正文字数（中文按字计） */
  wordCount: number;
  /** ISO 8601 */
  createdAt: string;
  openedAt: string;
}

/** 新建文档时的初始内容 */
export interface NewDocument {
  path: string;
  content: string;
}

// ─────────────────────────────────────────────────────────────
// 编辑器
// ─────────────────────────────────────────────────────────────

/**
 * 编辑器对外能力接口。
 *
 * 快捷栏、AI 面板、命令面板都只依赖这个接口，不接触 CodeMirror。
 * 这是「换掉底层编辑内核」的成本边界。
 */
export interface EditorHandle {
  focus(): void;

  /** 当前正文（纯 Markdown） */
  getDoc(): string;
  setDoc(text: string): void;

  getSelection(): TextRange;
  setSelection(range: TextRange): void;

  /**
   * 替换指定范围。
   * @param origin 标记变更来源，用于撤销分组与「AI 写回」识别。
   *              用户手动编辑传 'user'，AI 写回传 'ai'。
   */
  replaceRange(from: number, to: number, text: string, origin?: ChangeOrigin): void;

  /**
   * 在光标处插入文本。
   * @param cursorOffset 插入后光标相对插入起点的偏移。
   *                    关键用法：插入 `****` 时传 2，光标落在两星号之间。
   */
  insertAtCursor(text: string, cursorOffset?: number): void;

  /**
   * 包裹选区。无选区时插入骨架并把光标放进 placeholder 位置。
   * @param placeholder 仅在无选区时插入，可为空串
   */
  wrapSelection(before: string, after: string, placeholder?: string): void;

  /** 滚动到指定行（0-based） */
  scrollToLine(line: number): void;

  insertTable(rows: number, cols: number): void;
  insertLink(text: string, url: string): void;
  insertImage(path: string, alt?: string): void;

  /** 手动触发 decoration 重算。设置主题等样式变更后需调用。 */
  refresh(): void;

  /** 统计信息，供状态栏显示 */
  getStats(): EditorStats;
}

export type ChangeOrigin = 'user' | 'ai' | 'format' | 'paste' | 'ui';

export interface TextRange {
  from: number;
  to: number;
}

export interface EditorStats {
  /** 正文字数，中文按字计 */
  wordCount: number;
  /** 字符总数 */
  charCount: number;
  /** 行数 */
  lineCount: number;
  /** 光标所在行（1-based），未聚焦时为 null */
  cursorLine: number | null;
  /** 光标所在列（1-based）。按行首起算，未聚焦时为 null */
  cursorColumn: number | null;
  /** 当前选区字数，无选区为 0 */
  selectionLength: number;
}

export interface EditorPrefs {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  /** 编辑区最大宽度（字符数），0 表示不限 */
  maxWidth: number;
  /** 打字机模式：当前行固定在视口垂直中央 */
  typewriterMode: boolean;
  /** 显示行号 */
  showLineNumbers: boolean;
  /** Tab 插入空格数 */
  tabSize: number;
  /** 自动配对括号与引号 */
  autoPair: boolean;
  /** 输入 `##` 自动转标题 */
  autoFormat: boolean;
  /** 滚动线宽，单位 em */
  scrollWidth: number;
}

// ─────────────────────────────────────────────────────────────
// 主题与外观
// ─────────────────────────────────────────────────────────────

/**
 * 玻璃模式。取值由 Rust 侧探测后下发，前端不自行判断。
 *
 * - liquid  : macOS 26+ 原生 NSGlassEffectView
 * - vibrancy: macOS 10+ NSVisualEffectView
 * - none    : 不支持，前端必须降级为不透明表面
 */
export type GlassMode = 'liquid' | 'vibrancy' | 'none'

export interface GlassConfig {
  mode: GlassMode
  /** 圆角，单位 px */
  radius: number
  /** 模糊强度 */
  blur: number
  /** 饱和度 */
  saturate: number
  /** 不透明度 0-1，越低越透 */
  opacity: number
}

export interface Theme {
  id: string
  name: string
  /** 暗色主题需同步切换 CodeMirror 主题 */
  dark: boolean
}

export interface AppearancePrefs {
  theme: string
  glass: GlassConfig
  /** 强制不透明 —— 玻璃异常时的逃生通道 */
  forceOpaque: boolean
  /** 动画时长倍率，0 表示全禁用 */
  motionScale: number
  /** 界面密度 */
  density: 'compact' | 'normal' | 'comfortable'
}

// ─────────────────────────────────────────────────────────────
// AI
// ─────────────────────────────────────────────────────────────

/**
 * 请求体内部表示。
 *
 * 关键设计：Context 与 Target 是两个不同的变体，而非两个不同字符串。
 * 模板必然分栏渲染，物理上无法把「允许改写的部分」和「参考的部分」
 * 混进同一个 prompt 段。这是需求「AI 有且仅对划选部分处理」的结构性保障，
 * 比任何 prompt 工程技巧都可靠。
 */
export type AiPart =
  | { kind: 'text'; text: string }
  /** 只读上下文。prompt 中包 <context>，模型绝对不可修改。 */
  | { kind: 'context'; text: string }
  /** 唯一允许改写的部分。prompt 中包 <target>。 */
  | { kind: 'target'; from: number; to: number; text: string }

export type AiRole = 'system' | 'user' | 'assistant'

export interface AiMessage {
  role: AiRole
  parts: AiPart[]
}

/** AI 面板可触发的动作 */
export type AiAction =
  | 'rewrite'      // 润色
  | 'shorten'      // 精简
  | 'expand'       // 扩写
  | 'continue'     // 续写（行内补全）
  | 'summarize'    // 总结
  | 'translate'    // 翻译
  | 'toTable'      // 转表格
  | 'toList'       // 转列表
  | 'fixGrammar'   // 纠错
  | 'custom'       // 自定义指令

/** 流式事件。Rust 侧通过 Channel 逐个下发。 */
export type AiStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string; usage?: TokenUsage }
  | { type: 'error'; message: string; code?: AiErrorCode }
  | { type: 'cancelled' }

export type AiErrorCode =
  | 'no_key'          // 未配置 key
  | 'network'
  | 'rate_limited'
  | 'not_streaming'   // 服务端返回了非流式响应，不静默降级
  | 'too_long'        // 超出长度护栏
  | 'leak_detected'   // 模型吐了全文
  | 'cancelled'
  | 'unknown'

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
}

export type ProviderProtocol = 'openai' | 'anthropic'

export interface ProviderConfig {
  id: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  /** 默认模型，用户可覆盖（豆包的模型名是 endpoint id） */
  defaultModel: string
  /** 是否需要在 UI 上手填模型名 */
  customModel: boolean
  /** 走本地网络，界面上标注「无云端成本」 */
  local: boolean
}

export interface AiPrefs {
  /** 当前选中的 provider id */
  provider: string
  model: string
  /** 温度，0-2 */
  temperature: number
  maxTokens: number
  /** 上下文取景范围：划选前后各取多少字符 */
  contextRadius: number
  /** 划选后自动送入面板的延迟，0 表示立即 */
  selectionDebounce: number
  /** 成本计量开关 */
  costMeter: boolean
}

// ─────────────────────────────────────────────────────────────
// 快照与撤销
// ─────────────────────────────────────────────────────────────

export interface SnapshotMeta {
  id: string
  documentId: string
  createdAt: string
  /** 触发原因 */
  reason: SnapshotReason
  /** 原始文件路径 */
  path: string
  /** 产生该快照的 AI 动作（若有） */
  aiAction?: AiAction
  /** 该次写回的字数变化 */
  wordDelta?: number
}

export type SnapshotReason = 'manual' | 'first-open' | 'daily-first' | 'ai-write' | 'pre-restore'

export interface DiffHunk {
  /** hunk 起始行（0-based） */
  startLine: number
  removedLines: string[]
  addedLines: string[]
}

// ─────────────────────────────────────────────────────────────
// 设置与杂项
// ─────────────────────────────────────────────────────────────

export interface Settings {
  appearance: AppearancePrefs
  editor: EditorPrefs
  ai: AiPrefs
}

export interface AppInfo {
  version: string
  osVersion: string
  glassMode: GlassMode
  /** 是否在 App Store 版环境（private API 不可用） */
  appStore: boolean
  /** reduce-transparency 系统开关 */
  reduceTransparency: boolean
}
