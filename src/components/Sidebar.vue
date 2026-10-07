<script setup lang="ts">
/**
 * Sidebar.vue —— 左侧文档历史栏
 *
 * 在整体中的位置：App.vue 三栏布局的左栏，L1 玻璃层。
 * 数据来自 store/docs 的 DocumentMeta 列表（不含正文）。
 *
 * ★ 为什么列表不虚拟化 ★
 * 历史记录上限是本机最近 1000 条，行高固定、无嵌套无图片，
 * 配合 content-visibility 让视口外的行跳过渲染，开销可接受。
 * 虚拟化会引入「滚动时行高跳变」，而行高跳变正是 CLS 门禁要防的。
 *
 * 样式在 src/styles/sidebar.css，不在本文件内 —— 见该文件头注释。
 */
import { loadHistory, useStore } from '@/store'
import { formatCount, formatRelativeTime, shortenPath } from '@/store/format'

const store = useStore()

function openDocument(id: string): void {
  // 切换文档的真实逻辑（先写回上一个、再 setState）由内核接管。
  // M0 阶段内核尚未接入，这里只更新 UI 状态；
  // 内核接入后由它自己 watch currentId，避免两处都写导致状态打架。
  store.docs.setCurrent(id)
}

/**
 * 重新拉取历史。
 *
 * 只调 store，不在组件里写 IPC：组件持有副作用会让它无法被复用，
 * 也让「谁在拉历史」这件事散落在多处。
 */
function retryLoadHistory(): void {
  void loadHistory()
}
</script>

<template>
  <aside class="sidebar glass-l1" aria-label="文档历史">
    <div class="sidebar__header">
      <h2 class="sidebar__heading">文档历史</h2>
    </div>

    <!-- 列表容器。min-height:0 是必需的：flex 子项默认不缩，
         没有它长列表会把头部顶出容器 -->
    <div class="sidebar__body">
      <!-- 加载中：骨架屏而非转圈。转圈在窄列表区里过于刺眼 -->
      <div v-if="store.docs.isHistoryLoading" class="sidebar__skeleton" aria-hidden="true">
        <div v-for="index in 6" :key="index" class="sidebar__skeleton-row" />
      </div>

      <!-- 读取失败：给原因和重试，而不是空白 -->
      <div v-else-if="store.docs.historyError" class="sidebar__empty">
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" class="sidebar__empty-icon">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5" />
          <path d="M12 7.5v5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <circle cx="12" cy="16.2" r="0.9" fill="currentColor" />
        </svg>
        <p class="sidebar__empty-text">{{ store.docs.historyError }}</p>
        <button class="sidebar__empty-action" type="button" @click="retryLoadHistory">
          重新加载
        </button>
      </div>

      <!-- 无历史记录：给出下一步动作，而不是只说「暂无数据」 -->
      <div v-else-if="store.docs.isEmpty" class="sidebar__empty">
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" class="sidebar__empty-icon">
          <path
            d="M5 4.5h9l5 5v10a1.5 1.5 0 01-1.5 1.5h-12A1.5 1.5 0 014 19.5v-13A1.5 1.5 0 015.5 4.5z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linejoin="round"
            opacity="0.55"
          />
          <path
            d="M14 4.5v5h5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linejoin="round"
            opacity="0.55"
          />
        </svg>
        <p class="sidebar__empty-text">还没有打开过文档</p>
        <p class="sidebar__empty-hint">用 ⌘O 打开一个 Markdown 文件</p>
      </div>

      <!-- 正常列表 -->
      <ul v-else class="sidebar__list">
        <li v-for="item in store.docs.list" :key="item.id">
          <button
            class="sidebar__item"
            type="button"
            :class="{ 'is-active': item.id === store.docs.currentId }"
            :title="item.path"
            @click="openDocument(item.id)"
          >
            <!-- 第一行标题+时间（都是「定位信息」），第二行预览（是「内容信息」） -->
            <span class="sidebar__item-top">
              <span class="sidebar__item-title truncate">{{ item.title }}</span>
              <span class="sidebar__item-time">{{ formatRelativeTime(item.openedAt) }}</span>
            </span>
            <span class="sidebar__item-bottom">
              <span class="sidebar__item-preview truncate">{{ item.preview || '空文档' }}</span>
              <span class="sidebar__item-count">{{ formatCount(item.wordCount) }} 字</span>
            </span>
          </button>
        </li>
      </ul>
    </div>

    <!-- 底部：文档总数。只在有内容时显示，空态下这个数字是 0，没有信息量 -->
    <div v-if="!store.docs.isEmpty" class="sidebar__footer">
      共 {{ store.docs.list.length }} 篇
      <span class="sidebar__footer-path truncate">{{
        store.docs.current ? shortenPath(store.docs.current.path) : ''
      }}</span>
    </div>
  </aside>
</template>