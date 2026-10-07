/**
 * IPC 命令名称表 —— 前后端契约的唯一来源
 *
 * 为什么集中定义：命令名是前后端最易失配的接口。若各处自行书写字符串，
 * 改名必然漏改某处，且报错发生在运行时而非编译时。
 *
 * 文件所有权：src/ipc/commands.ts 属于「原生」子智能体，
 * 其他子智能体只读不写，需要新增命令时上报。
 */

export const CMD = {
  // 文档
  docRead: 'doc_read',
  docWrite: 'doc_write',
  docCreate: 'doc_create',
  docRename: 'doc_rename',
  docPickFolder: 'doc_pick_folder',
  docListMarkdown: 'doc_list_markdown',
  docRevealInFinder: 'doc_reveal_in_finder',
  docPickSavePath: 'doc_pick_save_path',
  docPickOpen: 'doc_pick_open',
  docPickSave: 'doc_pick_save',
  docHistoryTouch: 'doc_history_touch',
  docWatch: 'doc_watch',
  docUnwatch: 'doc_unwatch',

  // 历史记录
  docHistory: 'doc_history',
  docHistoryRemove: 'doc_history_remove',
  docHistoryClear: 'doc_history_clear',
  docTakeOpens: 'doc_take_opens',

  // 快照与撤销
  docSnapshot: 'doc_snapshot',
  docSnapshotList: 'doc_snapshot_list',
  docRevert: 'doc_revert',

  // AI
  aiChat: 'ai_chat',
  aiCancel: 'ai_cancel',
  aiListModels: 'ai_list_models',
  aiHasKey: 'ai_has_key',
  aiSetKey: 'ai_set_key',
  aiDeleteKey: 'ai_delete_key',
  aiProviders: 'ai_providers',

  // 外观
  glassProbe: 'glass_probe',
  glassSet: 'glass_set',

  // 设置
  settingsGet: 'settings_get',
  settingsSet: 'settings_set',

  // 图片
  wallpaperPick: 'wallpaper_pick',
  imagePick: 'image_pick',
  /** 读取图片宽高，用于锁定 widget 盒模型 */
  imageSize: 'image_size',
} as const

export type CmdName = (typeof CMD)[keyof typeof CMD]

/**
 * Rust → 前端的事件名（单向通知）。
 *
 * 与命令的区别：命令是请求-响应，事件是 Rust 主动推送。
 */
export const EVENT = {
  /** 外部文件被修改（其他程序或编辑器改动） */
  fileChanged: 'file:changed',
  /** 窗口尺寸变化，供虚拟化重算 */
  resized: 'window:resized',
  /** Rust 探测完玻璃能力后推一次，前端据此切换透明表面 */
  glassMode: 'glass:mode',
  /** Finder 双击了一篇 Markdown。载荷是路径数组，前端再向 Rust 取走队列。 */
  docOpen: 'doc:open',
  /** AI 流式增量。载荷是 { requestId, text } */
  aiDelta: 'ai:delta',
  /** 一轮回复结束，包括用户取消 */
  aiDone: 'ai:done',
} as const

export type EventName = (typeof EVENT)[keyof typeof EVENT]
