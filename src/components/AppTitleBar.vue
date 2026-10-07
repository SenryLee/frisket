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
import { computed } from 'vue'
import { useStore } from '@/store'

const store = useStore()

/**
 * 未打开文档时的标题。
 *
 * 用 store 里的 currentTitle（空串表示未打开）而不是 current：
 * 模板里写 `store.docs.current?.title` 需要组件支持可选链的响应式，
 * 而 currentTitle 已经在 store 里把这个判断做好了。
 */
const title = computed(() => store.docs.currentTitle || '未命名文档')

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
  store.appearance.setTheme(target.value)
}
</script>

<template>
  <!-- 不绑 data-dark：暗色判定由 themes.css 的 color-scheme 负责，
在组件里再存一份会出现两处真相，且主题切换时可能不同步 -->
  <header class="title-bar">
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

      <!-- 文档标题。拖拽区的一部分，故不加 pointer-events: none 之外的限制 -->
      <div class="title-bar__title truncate" :title="title">
        {{ title }}
      </div>
    </div>

    <div class="spacer" />

    <!-- 右侧：主题切换 + AI 面板开关 -->
    <div class="title-bar__right">
      <!--
        主题切换器：M0 阶段设置面板尚未实现，
        主题系统必须在这里就可用 —— 否则「四套主题」只是四段没人能切换的 CSS。
        用原生 select 而非自定义下拉：原生控件自带键盘导航、
        屏幕阅读器支持与系统外观，在没有 Popover 组件时是正确选择。
      -->
      <select
        class="title-bar__theme"
        :value="store.appearance.prefs.theme"
        aria-label="切换主题"
        @change="onThemeChange"
      >
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

.title-bar__left,
.title-bar__right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.title-bar__title {
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text-primary);
  /* 留出与红绿灯的间距，同时限制最大宽度，
   * 否则长文件名会把右侧按钮挤出窗口 */
  max-width: 42vw;
}

.title-bar__button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--control-height);
  height: var(--control-height);
  border-radius: var(--radius-sm);
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
  background: var(--accent-muted);
  color: var(--accent);
}

.title-bar__theme {
  height: var(--control-height-sm);
  padding: 0 var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
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