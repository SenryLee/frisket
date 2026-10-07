<script setup lang="ts">
/**
 * App.vue —— 三栏布局的根组件
 *
 * 在整体中的位置：main.ts 挂载的唯一组件，负责三栏的几何关系。
 *
 * ┌──────────────────────────────────────────────┐
 * │AppTitleBar（拖拽区）                            │
 * ├──────────┬───────────────────────┬───────────┤
 * │ Sidebar  │ Toolbar                │ AI 面板│
 * │  240px   │ ───────────────────── │  380px   │
 * │          │ 编辑区（内核挂载点）      │ 折叠态   │
 * │          │                       │ translate │
 * │          ├───────────────────────┤ X(100%)  │
 * │          │ StatusBar              │          │
 * └──────────┴───────────────────────┴───────────┘
 *
 * ★ 为什么侧栏折叠用 width、AI 面板用 translateX ★
 * 侧栏折叠后中栏变宽，编辑区必须重排，width 动画本就必要；
 * AI 面板折叠不改变中栏宽度，若用 width 会让编辑区每帧重排。
 * translateX 只走合成层，编辑区的滚动位置与光标完全不受影响。
 */
import { onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { EDITOR_HANDLE, initStore, loadHistory, useStore } from '@/store'
import { installDevBridge, removeDevBridge } from '@/store/devBridge'
import { SLATE_EVENT, emitSlateEvent, onSlateEvent } from '@/core/protocol'
import type { EditorHandle } from '@/core/interfaces'

import AiPanelShell from './components/AiPanelShell.vue'
import AppTitleBar from './components/AppTitleBar.vue'
import Sidebar from './components/Sidebar.vue'
import StatusBar from './components/StatusBar.vue'
import Toolbar from './components/Toolbar.vue'
import { runToolbarAction } from './components/toolbarActions'
import type { ToolbarAction } from './components/types'

// ★ 必须在第一个组件挂载前把主题写进 <html> ★
// 否则首帧按 tokens.css 的默认主题渲染，用户会看到「白闪一下再变暗色」。
// 在 setup 里同步调用是安全的：setup 早于首次渲染。
initStore()

const store = useStore()

/**
 * 编辑区挂载点。
 *
 * 为什么由 App.vue持有而不是内核组件持有：内核需要的是
 * 「一个 DOM 节点 + 一个 EditorHandle」，把它固定在布局层，
 * 内核就能专注于 CM6 的实现，不必关心自己在三栏里的位置。
 */
const editorHost = ref<HTMLDivElement | null>(null)

/**
 * 内核提供的编辑能力。M0 阶段为 null —— 内核尚未接入。
 * 它同时是 Toolbar 判断按钮是否可用的依据。
 */
const editorHandle = ref<EditorHandle | null>(null)

/** 已建立的全部订阅的解绑函数。集中登记，避免解绑时漏掉某一个 */
let unsubscribers: Array<() => void> = []

/**
 * 把编辑能力发给所有子组件。
 *
 * 直接 provide 这个 ref 本身：消费侧在 setup 里 inject 到的
 * 就是 Ref 本身，读 .value 才能保持响应。
 * 包装成 getter 反而会丢掉追踪。
 */
provide(EDITOR_HANDLE, editorHandle)

/**
 * 通知内核挂载点已就绪。
 *
 * 协议细节见 core/protocol.ts —— 那里是事件名与载荷形状的唯一来源。
 * 这里只负责「在正确时机发出去」。
 */
function notifyHostReady(): void {
  const host = editorHost.value
  if (host === null) return
  emitSlateEvent(SLATE_EVENT.hostReady, host)
}

/**
 * 内核 → 视觉层的全部订阅。
 *
 * 用 onSlateEvent 而非裸 addEventListener：载荷类型由事件名推导，
 * 订阅侧不需要写类型断言，也不会因为内核改了detail 形状而静默失配。
 *
 * ★ 必须整体在 onMounted 里建立，且早于 notifyHostReady ★
 * 内核收到 hostReady 后可能同步创建视图并立刻回传 ready。
 * 顺序颠倒会让 EditorHandle 丢失，且不会报任何错。
 */
function subscribeEditorEvents(): void {
  unsubscribers.push(
    onSlateEvent(SLATE_EVENT.ready, (detail) => {
      editorHandle.value = detail.handle
      // 门禁测试桥：仅 dev 构建挂载，prod 由 import.meta.env.DEV 剔除。
      // 装配细节见 store/devBridge.ts —— 那里也实现了 toggleTheme /
      // toggleAiPanel，因为这两个操作要动视觉层的 store，内核拿不到。
      if (import.meta.env.DEV) {
        installDevBridge(detail)
      }
    }),
    onSlateEvent(SLATE_EVENT.stats, (stats) => store.editor.setStats(stats)),
    onSlateEvent(SLATE_EVENT.selection, (range) => store.editor.setSelection(range)),
    onSlateEvent(SLATE_EVENT.focus, (focused) => store.editor.setFocused(focused)),
    onSlateEvent(SLATE_EVENT.dirty, (dirty) => store.editor.setDirty(dirty)),
  )
}

/** 解除全部订阅。漏掉任何一个都会导致组件重挂载后事件被处理两次 */
function unsubscribeEditorEvents(): void {
  for (const unsubscribe of unsubscribers) unsubscribe()
  unsubscribers = []
  // 测试桥必须一并拆掉：热更新后残留的旧桥会指向已销毁的
  // EditorView，门禁会读到错乱数据且极难定位
  if (import.meta.env.DEV) {
    removeDevBridge()
  }
}

/**
 * 快捷栏意图 → 内核能力。
 *
 * 映射细节见 toolbarActions.ts。
 */
function handleToolbarAction(action: ToolbarAction): void {
  runToolbarAction(editorHandle.value, action)
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  const metaKey = event.metaKey || event.ctrlKey

  // ⌘\ 折叠侧栏
  if (metaKey && event.key === '\\') {
    event.preventDefault()
    store.sidebarCollapsed = !store.sidebarCollapsed
    return
  }

  // ⌘J 开合 AI 面板。用 preventDefault 避免与输入法候选窗冲突
  if (metaKey && event.key.toLowerCase() === 'j') {
    event.preventDefault()
    store.ai.toggle()
  }
}

onMounted(() => {
  // ★ 必须先订阅，再通知内核 ★
  // 内核收到 hostReady 后可能同步创建视图并立刻回传 EditorHandle。
  // 若顺序颠倒，快捷栏按钮会一直是灰的，且不会报任何错。
  subscribeEditorEvents()
  window.addEventListener('keydown', handleGlobalKeydown)
  notifyHostReady()

  // 拉历史放在挂载后而不是 setup 里：它是异步 IO，
  // 放在 setup 会拖慢首帧，而侧栏此时还不需要数据。
  void loadHistory()
})

onBeforeUnmount(() => {
  unsubscribeEditorEvents()
  window.removeEventListener('keydown', handleGlobalKeydown)
})
</script>

<template>
  <div class="app" :class="{ 'is-sidebar-collapsed': store.sidebarCollapsed }">
    <AppTitleBar />

    <!-- 三栏。刻意不显式写 align-items：
         默认的 stretch 正是我们要的，一旦某天被全局样式改成 flex-start，
         三栏会错位且极难定位。改为在 .app__body 上写死 stretch 更安全。 -->
    <div class="app__body">
      <!-- 左栏。用 wrapper 包一层，让侧栏的折叠动画
           不影响编辑区的宽度计算时序 -->
      <div class="app__sidebar-slot">
        <Sidebar />
      </div>

      <!-- 中栏 -->
      <main class="app__main">
        <Toolbar @action="handleToolbarAction" />

        <!-- 编辑区容器。glass-l2：88% 不透明，可读性优先 -->
        <div class="app__editor glass-l2" ref="editorHost" />

        <StatusBar />
      </main>

      <!-- 右栏 -->
      <AiPanelShell />
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  /* 应用根容器必须完全不透明：它是玻璃层「下方」的底色来源，
   * 若这里透明，玻璃面板后面会露出桌面，层次关系就反了 */
  background: var(--bg-base);
  overflow: hidden;
}

.app__body {
  display: flex;
  flex: 1;
  /* min-height:0 是必需的：flex 子项默认 min-height:auto，
   * 不写这行，编辑区内容变多时会把整个三栏撑出窗口 */
  min-height: 0;
  /* 写死 stretch：三栏必须等高，任何外部覆盖都会让底部分层错位 */
  align-items: stretch;
  /* AI 面板用绝对定位悬浮于此，必须有定位上下文 */
  position: relative;
}

/* 侧栏槽位：宽度与过渡在这里，Sidebar 只管内容。
   分开是为了让 Sidebar 内部的滚动容器不受宽度动画影响。 */
.app__sidebar-slot {
  width: var(--sidebar-width);
  flex-shrink: 0;
  overflow: hidden;
  transition: width var(--dur-panel-eff) var(--ease-out);
}

.app.is-sidebar-collapsed .app__sidebar-slot {
  width: var(--sidebar-width-collapsed);
}

.app__main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  /* 中栏是编辑区主体，不加玻璃：它就是 L2 本身，
   * 再套一层玻璃会与内部编辑区背景叠加出浑浊的颜色 */
  background: transparent;
}

.app__editor {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}
</style>