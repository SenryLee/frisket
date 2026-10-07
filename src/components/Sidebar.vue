<script setup lang="ts">
/**
 * Sidebar.vue —— 左侧文档历史栏
 *
 * 在整体中的位置：App.vue 三栏布局的左栏，L1 玻璃层。
 * 数据来自 store/docs 的 DocumentMeta 列表（不含正文）。
 *
 * 历史和文件夹分成两页。文件夹文件一多时不再和历史挤在同一条滚动里。
 *
 * 样式在 src/styles/sidebar.css，不在本文件内 —— 见该文件头注释。
 */
import { computed, inject, nextTick, onBeforeUnmount, ref } from 'vue'
import { CMD } from '@/ipc/commands'
import { fileStem } from '@/core/filename'
import { EDITOR_HANDLE, loadHistory, useStore } from '@/store'
import { isTauriRuntime } from '@/store/appearance'
import { formatCount, formatRelativeTime, shortenPath } from '@/store/format'
import LibraryFolders from './LibraryFolders.vue'
import {
  SIDEBAR_NOTICE,
  newMarkdown,
  openFromChrome,
  openFromHistory,
  openMarkdownAt,
  renameDocument,
} from '@/store/session'

const store = useStore()
const editorHandleRef = inject(EDITOR_HANDLE, null)

const menu = ref<{ x: number; y: number; path: string } | null>(null)
const renaming = ref<{ path: string; draft: string } | null>(null)
const renameInput = ref<HTMLInputElement | null>(null)
const notice = ref('')
let noticeTimer = 0

function openMenu(event: MouseEvent, path: string): void {
  event.preventDefault()
  const width = 196
  const height = 148
  const x = Math.min(event.clientX, window.innerWidth - width - 8)
  const y = Math.min(event.clientY, window.innerHeight - height - 8)
  menu.value = { x: Math.max(8, x), y: Math.max(8, y), path }
}

function startRename(path: string): void {
  if (path === '') return
  closeMenu()
  renaming.value = { path, draft: fileStem(path) }
  void nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}

function cancelRename(): void {
  renaming.value = null
}

async function commitRename(): Promise<void> {
  const current = renaming.value
  if (current === null) return
  renaming.value = null
  const ok = await renameDocument(editorHandleRef?.value ?? null, current.path, current.draft)
  if (ok) store.library.refreshContaining(current.path)
  if (!ok && store.docs.saveError) showNotice(store.docs.saveError)
}

function closeMenu(): void {
  menu.value = null
}

function showNotice(text: string, duration = 1600): void {
  notice.value = text
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, duration)
}

async function reveal(path: string): Promise<void> {
  closeMenu()
  if (!isTauriRuntime()) {
    showNotice('要在安装版里才能打开 Finder')
    return
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke(CMD.docRevealInFinder, { path })
  } catch (error: unknown) {
    showNotice(error instanceof Error ? error.message : '无法打开 Finder')
  }
}

async function copyPath(path: string): Promise<void> {
  closeMenu()
  try {
    await navigator.clipboard.writeText(path)
  } catch {
    const area = document.createElement('textarea')
    area.value = path
    area.setAttribute('readonly', 'true')
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
  showNotice('已复制路径')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeMenu()
}

function onSidebarNotice(event: Event): void {
  const detail = event instanceof CustomEvent ? event.detail : ''
  if (typeof detail === 'string' && detail !== '') showNotice(detail, 3200)
}

const openTitle = computed(() =>
  store.library.pane === 'folders' ? '打开文件夹 ⌘O' : '打开 Markdown ⌘O',
)

window.addEventListener('keydown', onKeydown)
window.addEventListener(SIDEBAR_NOTICE, onSidebarNotice)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener(SIDEBAR_NOTICE, onSidebarNotice)
  window.clearTimeout(noticeTimer)
})

function openDocument(id: string): void {
  void openFromHistory(editorHandleRef?.value ?? null, id).then((error) => {
    if (error) showNotice(error, 3200)
  })
}

function openLibraryFile(path: string): void {
  void openMarkdownAt(editorHandleRef?.value ?? null, path).then((error) => {
    if (error) showNotice(error, 3200)
  })
}

function showPane(pane: 'history' | 'folders'): void {
  store.library.setPane(pane)
  if (pane === 'folders') void store.library.refreshAll()
}

function createDocument(): void {
  void newMarkdown(editorHandleRef?.value ?? null)
}

function pickOpen(): void {
  void openFromChrome(editorHandleRef?.value ?? null)
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
  <aside class="sidebar glass-l1" aria-label="侧栏" @contextmenu.prevent>
    <div class="sidebar__header">
      <div class="sidebar__switch" role="tablist" aria-label="侧栏内容">
        <button
          type="button"
          role="tab"
          :aria-selected="store.library.pane === 'history'"
          :class="{ 'is-on': store.library.pane === 'history' }"
          @click="showPane('history')"
        >
          历史
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="store.library.pane === 'folders'"
          :class="{ 'is-on': store.library.pane === 'folders' }"
          @click="showPane('folders')"
        >
          文件夹
        </button>
      </div>
      <span class="sidebar__header-spacer" />
      <button class="sidebar__header-button" type="button" title="新建 ⌘N" @click="createDocument">
        新建
      </button>
      <button class="sidebar__header-button" type="button" :title="openTitle" @click="pickOpen">
        打开
      </button>
    </div>

    <!-- 列表容器。min-height:0 是必需的：flex 子项默认不缩，
         没有它长列表会把头部顶出容器 -->
    <div class="sidebar__body">
      <LibraryFolders
        v-if="store.library.pane === 'folders'"
        @notice="showNotice"
        @menu="openMenu"
        @open="openLibraryFile"
      />

      <template v-else>
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
            @contextmenu="openMenu($event, item.path)"
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
      </template>
    </div>

    <!-- 底部：文档总数。只在有内容时显示，空态下这个数字是 0，没有信息量 -->
    <div v-if="store.library.pane === 'history' && !store.docs.isEmpty" class="sidebar__footer">
      共 {{ store.docs.list.length }} 篇
      <span class="sidebar__footer-path truncate">{{
        store.docs.current ? shortenPath(store.docs.current.path) : ''
      }}</span>
    </div>

    <p v-if="notice" class="sidebar__notice" role="status">{{ notice }}</p>
  </aside>

  <Teleport to="body">
    <div
      v-if="menu"
      class="sidebar__menu-mask"
      @mousedown="closeMenu"
      @contextmenu.prevent="closeMenu"
    >
      <div
        class="sidebar__menu"
        role="menu"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @mousedown.stop
      >
        <button type="button" role="menuitem" :disabled="menu.path === ''" @click="startRename(menu.path)">
          重命名
        </button>
        <button type="button" role="menuitem" :disabled="menu.path === ''" @click="reveal(menu.path)">
          在 Finder 中显示
        </button>
        <button type="button" role="menuitem" :disabled="menu.path === ''" @click="copyPath(menu.path)">
          复制路径
        </button>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div v-if="renaming" class="sidebar__menu-mask" @mousedown="cancelRename">
      <form
        class="sidebar__rename"
        :style="{ left: '50%', top: '28%' }"
        @mousedown.stop
        @submit.prevent="commitRename"
      >
        <label>
          文件名
          <input
            ref="renameInput"
            v-model="renaming.draft"
            @keydown.esc.prevent="cancelRename"
          />
        </label>
        <div class="sidebar__rename-actions">
          <button type="button" @click="cancelRename">取消</button>
          <button type="submit">重命名</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>