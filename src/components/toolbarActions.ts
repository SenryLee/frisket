/**
 * toolbarActions.ts —— 快捷栏动作 → EditorHandle 的映射
 *
 * 在整体中的位置：Toolbar.vue 只发「意图」，由本模块翻译成对
 * EditorHandle 的具体调用。App.vue 负责把handle 传进来。
 *
 * ★ 为什么要独立成文件 ★
 * 一是 App.vue 已经接近 300 行上限；
 * 二是这份映射是「产品决策」而非「布局代码」——
 * 加粗用什么标记符、表格默认几行几列，都该在一个地方能一眼看完。
 *
 * ★ 为什么显式 switch 而不用「方法名字符串动态查找」★
 * `handle[methodName]()` 这种写法在类型上完全失去检查，
 * 内核改名后要到运行时才发现，且报错信息与真实调用点无关。
 */
import type { EditorHandle } from '@/core/interfaces'
import type { ToolbarAction } from './types'

/**
 * 执行一个快捷栏动作。
 *
 * handle 为 null 时静默返回：内核尚未接入时按钮本就是 disabled，
 * 这里只是不让意外的键盘调用抛错。
 *
 * placeholder 的作用：无选区时插入骨架并把光标放进其中，
 * 让用户直接打字就能得到带格式的内容，不必自己补占位文字。
 */
export function runToolbarAction(handle: EditorHandle | null, action: ToolbarAction): void {
  if (handle === null) return

  switch (action) {
    case 'bold':
      handle.wrapSelection('**', '**', '加粗文字')
      break
    case 'italic':
      handle.wrapSelection('*', '*', '斜体文字')
      break
    case 'strike':
      handle.wrapSelection('~~', '~~', '删除线文字')
      break
    case 'code':
      handle.wrapSelection('`', '`', 'code')
      break
    case 'heading':
      handle.wrapSelection('## ', '', '标题')
      break
    case 'quote':
      handle.wrapSelection('> ', '', '引用')
      break
    case 'bulletList':
      handle.wrapSelection('- ', '', '列表项')
      break
    case 'orderedList':
      handle.wrapSelection('1. ', '', '列表项')
      break
    case 'table':
      handle.insertTable(3, 3)
      break
    case 'link':
      handle.insertLink('链接文字', 'https://')
      break
    case 'image':
      handle.insertImage('', '图片描述')
      break
  }
}