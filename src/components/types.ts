/**
 * types.ts —— 组件间共享的 UI 类型
 *
 * 在整体中的位置：只放跨组件传递的类型，不含任何实现。
 * 为什么单独成文件：`<script setup>` 不能写 export 语句，
 * 而 App.vue 与 Toolbar.vue 都需要 ToolbarAction 这个联合类型。
 * 放进 store 会让组件依赖状态层，破坏分层，故独立成文件。
 */

/**
 * 快捷栏能触发的编辑动作。
 *
 * 取值与 EditorHandle 的方法一一对应：加粗走 wrapSelection，
 * 表格走 insertTable。组件只表达「意图」，
 * 具体怎么实现由内核决定。
 */
export type ToolbarAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'heading'
  | 'code'
  | 'bulletList'
  | 'orderedList'
  | 'quote'
  | 'table'
  | 'link'
  | 'image'