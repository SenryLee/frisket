<script setup lang="ts">
/**
 * 侧栏的文件夹分页。历史记录不在这里。
 * 每个文件夹和子目录都能折叠。移出只改名单，不删磁盘上的文件。
 */
import { folderLabel, libraryDirectoryKeys, visibleLibraryRows } from '@/core/libraryFolders'
import type { LibraryRow } from '@/core/libraryFolders'
import { useStore } from '@/store'
import { computed, watch } from 'vue'

const emit = defineEmits<{
  notice: [text: string]
  menu: [event: MouseEvent, path: string]
  open: [path: string]
}>()

const store = useStore()

watch(
  () => store.docs.activePath,
  (path) => {
    if (path) store.library.refreshContaining(path)
  },
)

const branchKeys = computed(() => {
  const keys: string[] = []
  for (const folder of store.library.folders) {
    keys.push(folder, ...libraryDirectoryKeys(store.library.files(folder), folder))
  }
  return keys
})

const allOpen = computed(
  () => branchKeys.value.length > 0 && branchKeys.value.every((key) => store.library.isOpen(key)),
)

function rows(folder: string): LibraryRow[] {
  return visibleLibraryRows(store.library.files(folder), new Set(store.library.expandedKeys), folder)
}

function indent(depth: number): string {
  return `${8 + depth * 14}px`
}

function removeFolder(folder: string): void {
  store.library.unpin(folder)
  emit('notice', '已移出，文件还在磁盘上')
}

function toggleAll(): void {
  if (allOpen.value) {
    store.library.collapseAll()
    return
  }
  store.library.expandAll(branchKeys.value)
}

function openFile(path: string): void {
  emit('open', path)
}

function showFileMenu(event: MouseEvent, path: string | null): void {
  if (path === null || path === '') return
  emit('menu', event, path)
}

function isCurrent(path: string | null): boolean {
  const active = store.docs.activePath
  if (active === null || path === null) return false
  return active.normalize('NFC') === path.normalize('NFC')
}
</script>

<template>
  <section class="sidebar__library" aria-label="文件夹">
    <header class="sidebar__library-head">
      <span class="sidebar__header-spacer" />
      <button type="button" :disabled="store.library.folders.length === 0" @click="toggleAll">
        {{ allOpen ? '全部折叠' : '全部展开' }}
      </button>
    </header>

    <p v-if="store.library.folders.length === 0" class="sidebar__library-empty">
      点上方的「打开」选一个文件夹，这里会列出里面的 Markdown。点一下文件夹可以展开。
    </p>

    <div v-for="folder in store.library.folders" :key="folder" class="sidebar__folder">
      <div class="sidebar__folder-head">
        <button
          type="button"
          class="sidebar__folder-toggle"
          :aria-expanded="store.library.isOpen(folder)"
          :title="folder"
          @click="store.library.toggleOpen(folder)"
        >
          <span class="sidebar__chevron" :class="{ 'is-open': store.library.isOpen(folder) }" aria-hidden="true">
            ›
          </span>
          <span class="sidebar__folder-name truncate">{{ folderLabel(folder) }}</span>
          <span v-if="store.library.files(folder).length > 0" class="sidebar__folder-count">
            {{ store.library.files(folder).length }}
          </span>
        </button>
        <button
          type="button"
          class="sidebar__folder-remove"
          :aria-label="`移出 ${folderLabel(folder)}`"
          title="移出列表，不删除文件"
          @click.stop="removeFolder(folder)"
        >
          ×
        </button>
      </div>

      <template v-if="store.library.isOpen(folder)">
        <p v-if="store.library.error(folder)" class="sidebar__folder-note">{{ store.library.error(folder) }}</p>
        <p
          v-else-if="store.library.loading(folder) && store.library.files(folder).length === 0"
          class="sidebar__folder-note"
        >
          正在读取…
        </p>
        <p v-else-if="store.library.files(folder).length === 0" class="sidebar__folder-note">
          这个文件夹里没有 Markdown
        </p>
        <ul v-else class="sidebar__files">
          <li v-for="row in rows(folder)" :key="row.key">
            <button
              v-if="row.filePath"
              type="button"
              class="sidebar__file"
              :class="{ 'is-active': isCurrent(row.filePath) }"
              :title="row.filePath ?? ''"
              :style="{ paddingLeft: indent(row.depth) }"
              @click.stop="openFile(row.filePath ?? '')"
              @contextmenu="showFileMenu($event, row.filePath)"
            >
              <span class="truncate">{{ row.label }}</span>
            </button>
            <button
              v-else
              type="button"
              class="sidebar__folder-toggle"
              :aria-expanded="row.open"
              :style="{ paddingLeft: indent(row.depth) }"
              @click.stop="store.library.toggleOpen(row.key)"
            >
              <span class="sidebar__chevron" :class="{ 'is-open': row.open }" aria-hidden="true">›</span>
              <span class="truncate">{{ row.label }}</span>
            </button>
          </li>
        </ul>
      </template>
    </div>
  </section>
</template>
