<script setup lang="ts">
/**
 * AppTitleBar.vue —— macOS 透明标题栏的拖拽区
 *
 * 在整体中的位置：App.vue 最顶部的通栏，位于三栏之上。
 * macOS 红绿灯按钮浮在它左侧，所以左侧留出 traffic-light 的宽度。
 *
 * ★ 为什么标题栏自己不发事件 ★
 * 拖拽区必须整块可拖，但按钮区域必须可点。
 * 两者靠 CSS 的 -webkit-app-region 完成：
 * 父级 drag、按钮 no-drag。不需要在 JS 里判断鼠标位置 ——
 * 那种实现在快速拖拽时会出现「按钮点不动」的边缘情况。
 */
import { computed, inject, nextTick, ref } from 'vue'
import { CMD } from '@/ipc/commands'
import { EDITOR_HANDLE, useStore } from '@/store'
import { isTauriRuntime } from '@/store/appearance'
import { renameDocument } from '@/store/session'

defineProps<{ glass: boolean }>()

const emit = defineEmits<{ toggleSettings: [] }>()

const store = useStore()
const editorHandleRef = inject(EDITOR_HANDLE, null)
const editing = ref(false)
const draft = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const menu = ref<{ x: number; y: number } | null>(null)

/** Overlay 标题栏没有系统拖动条。按下时要已经拿到窗口对象，不能临时 import。 */
let startDragging: (() => Promise<void>) | null = null

if (isTauriRuntime()) {
  void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
    const current = getCurrentWindow()
    startDragging = () => current.startDragging()
  })
}

function onTitleMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest('button, select, input, textarea, a, option, label')) return
  // 标题和空白弹簧已经标了 data-tauri-drag-region，交给系统拖，避免拖两次。
  if (target.closest('[data-tauri-drag-region]')) return
  const drag = startDragging
  if (drag === null) return
  void drag().catch(() => undefined)
}

/**
 * 未打开文档时的标题。
 *
 * 用 store 里的 currentTitle（空串表示未打开）而不是 current：
 * 模板里写 `store.docs.current?.title` 需要组件支持可选链的响应式，
 * 而 currentTitle 已经在 store 里把这个判断做好了。
 */
const title = computed(() => store.docs.fileLabel || '未命名')

function beginRename(): void {
  menu.value = null
  draft.value = title.value
  editing.value = true
  void nextTick(() => {
    nameInput.value?.focus()
    nameInput.value?.select()
  })
}

function cancelRename(): void {
  editing.value = false
}

async function commitRename(): Promise<void> {
  if (!editing.value) return
  const next = draft.value
  editing.value = false
  await renameDocument(editorHandleRef?.value ?? null, store.docs.activePath, next)
}

function openTitleMenu(event: MouseEvent): void {
  event.preventDefault()
  if (editing.value) return
  const width = 180
  const height = 132
  menu.value = {
    x: Math.min(event.clientX, window.innerWidth - width - 8),
    y: Math.min(event.clientY, window.innerHeight - height - 8),
  }
}

function closeTitleMenu(): void {
  menu.value = null
}

async function revealCurrent(): Promise<void> {
  const path = store.docs.activePath
  closeTitleMenu()
  if (path === null || !isTauriRuntime()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke(CMD.docRevealInFinder, { path }).catch(() => undefined)
}

async function copyCurrentPath(): Promise<void> {
  const path = store.docs.activePath
  closeTitleMenu()
  if (path === null) return
  await navigator.clipboard.writeText(path).catch(() => undefined)
}

function toggleSidebar(): void {
  store.sidebarCollapsed = !store.sidebarCollapsed
}

function toggleAiPanel(): void {
  store.ai.toggle()
}

/**
 * 从 select 的 change 事件取主题 id。
 *
 * 显式收窄类型：event.target 在 DOM 类型里是 EventTarget，
 * 不做类型守卫就得用 as 强转，而 as 会连类型检查一起关掉。
 */
function onThemeChange(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  if (target.value === 'system') {
    store.appearance.setFollowSystem(true)
    return
  }
  store.appearance.setTheme(target.value)
}
</script>

<template>
  <!-- 不绑 data-dark：暗色判定由 themes.css 的 color-scheme 负责，
在组件里再存一份会出现两处真相，且主题切换时可能不同步 -->
  <header class="title-bar" :class="{ 'is-glass': glass }" @mousedown="onTitleMouseDown">
    <!-- 左侧：红绿灯占位 + 侧栏开关 -->
    <div class="title-bar__left">
      <button
        class="title-bar__button"
        type="button"
        :aria-label="store.sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
        :title="store.sidebarCollapsed ? '展开侧栏 ⌘\\' : '收起侧栏 ⌘\\'"
        @click="toggleSidebar"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.2" />
          <line
            x1="6"
            y1="2.5"
            x2="6"
            y2="13.5"
            stroke="currentColor"
            stroke-width="1.2"
            :opacity="store.sidebarCollapsed ? 0.25 : 1"
          />
        </svg>
      </button>

      <button
        v-if="!editing"
        class="title-bar__name truncate"
        type="button"
        :title="`${title} · 点击重命名`"
        @click="beginRename"
        @contextmenu="openTitleMenu"
        @mousedown.stop
      >
        {{ title }}
      </button>
      <input
        v-else
        ref="nameInput"
        v-model="draft"
        class="title-bar__name-input"
        aria-label="文件名"
        @mousedown.stop
        @keydown.enter.prevent="commitRename"
        @keydown.esc.prevent="cancelRename"
        @blur="commitRename"
      />
    </div>

    <div class="spacer" data-tauri-drag-region />

    <!-- 右侧：主题切换 + AI 面板开关 -->
    <div class="title-bar__right">
      <!--
        主题切换器：M0 阶段设置面板尚未实现，
        主题系统必须在这里就可用 —— 否则「四套主题」只是四段没人能切换的 CSS。
        用原生 select 而非自定义下拉：原生控件自带键盘导航、
        屏幕阅读器支持与系统外观，在没有 Popover 组件时是正确选择。
      -->
      <button
        class="title-bar__button title-bar__button--text"
        type="button"
        title="玻璃、壁纸和接口"
        aria-label="打开设置"
        @click="emit('toggleSettings')"
      >
        设置
      </button>

      <select
        class="title-bar__theme"
        :value="store.appearance.followSystem ? 'system' : store.appearance.prefs.theme"
        aria-label="切换主题"
        @change="onThemeChange"
      >
        <option value="system">跟随系统</option>
        <option v-for="theme in store.appearance.themes" :key="theme.id" :value="theme.id">
          {{ theme.name }}
        </option>
      </select>

      <button
        class="title-bar__button"
        type="button"
        :class="{ 'is-active': store.ai.open }"
        :aria-pressed="store.ai.open"
        :aria-label="store.ai.open ? '收起 AI 面板' : '展开 AI 面板'"
        :title="store.ai.open ? '收起 AI 面板' : '展开 AI 面板 ⌘J'"
        @click="toggleAiPanel"
      >
        <span class="title-bar__ai-label">AI</span>
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M8 1.5l1.6 4.2 4.4.4-3.3 2.9 1 4.3L8 11.2l-3.7 2.1 1-4.3L2 6.1l4.4-.4z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
  </header>

  <Teleport to="body">
    <div
      v-if="menu"
      class="sidebar__menu-mask"
      @mousedown="closeTitleMenu"
      @contextmenu.prevent="closeTitleMenu"
    >
      <div
        class="sidebar__menu"
        role="menu"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @mousedown.stop
      >
        <button type="button" role="menuitem" @click="beginRename">重命名</button>
        <button type="button" role="menuitem" :disabled="store.docs.activePath === null" @click="revealCurrent">
          在 Finder 中显示
        </button>
        <button type="button" role="menuitem" :disabled="store.docs.activePath === null" @click="copyCurrentPath">
          复制路径
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.title-bar {
  display: flex;
  align-items: center;
  height: var(--titlebar-height);
  /* 红绿灯按钮浮在左侧，为它让出空间。
   * 78px 是 macOS Big Sur+ 的标准宽度。 */
  padding: 0 var(--space-4) 0 78px;
  /* ★ 拖拽区 ★ 整块可拖动窗口 */
  -webkit-app-region: drag;
  app-region: drag;
  /* 标题栏本身不参与玻璃模糊：它的内容极少，
   * 模糊带来的视觉收益抵不上多一次合成层的开销 */
  background: var(--bg-base);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  /* 红绿灯切换动画期间高度不变，避免下方三栏抖动 */
  transition: height var(--dur-base-eff) var(--ease-out);
  user-select: none;
  -webkit-user-select: none;
}

.title-bar.is-glass {
  /* 红绿灯叠在这一条上。不能用全透，否则看起来像桌面，一点就点出窗口。 */
  background: rgb(var(--c-bg-rgb) / var(--titlebar-alpha, 0.94));
  backdrop-filter: blur(22px) saturate(160%);
  -webkit-backdrop-filter: blur(22px) saturate(160%);
}

.title-bar__left,
.title-bar__right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.title-bar__name,
.title-bar__name-input {
  max-width: 42vw;
  height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text-primary);
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.title-bar__name:hover {
  background: var(--bg-hover);
}

.title-bar__name-input {
  width: 240px;
  border: 1px solid var(--border-strong);
  background: var(--bg-raised);
  outline: none;
}

.title-bar__button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: var(--control-height);
  height: var(--control-height);
  padding: 0 8px;
  border-radius: var(--radius-full);
  color: var(--text-secondary);
  /* ★ 关键：按钮必须从父级的 drag 中脱离出来，否则点不动 ★ */
  -webkit-app-region: no-drag;
  app-region: no-drag;
  transition:
    background var(--dur-fast-eff) var(--ease-out),
    color var(--dur-fast-eff) var(--ease-out);
}

.title-bar__button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.title-bar__button.is-active {
  background: var(--text-primary);
  color: var(--bg-base);
  border-radius: var(--radius-full);
}

.title-bar__ai-label {
  font-size: var(--text-xs);
  font-weight: 650;
}

.title-bar__theme {
  height: var(--control-height-sm);
  padding: 0 var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--bg-raised);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  cursor: default;
  /* ★ 必须从父级 drag 中脱离，否则在拖拽区里点不动 ★ */
  -webkit-app-region: no-drag;
  app-region: no-drag;
  transition:
    border-color var(--dur-fast-eff) var(--ease-out),
    color var(--dur-fast-eff) var(--ease-out);
}

.title-bar__theme:hover {
  border-color: var(--border-strong);
  color: var(--text-primary);
}
</style>