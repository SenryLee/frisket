<script setup lang="ts">
/**
 * 新建或第一次保存时选择文件夹。最近五次可以直接点。
 */
import { CMD } from '@/ipc/commands'
import { useStore } from '@/store'
import { isTauriRuntime } from '@/store/appearance'
import { shortenPath } from '@/store/format'
import { ref } from 'vue'

const store = useStore()
const picking = ref(false)
const error = ref('')

function choose(folder: string): void {
  error.value = ''
  store.folders.choose(folder)
}

function cancel(): void {
  error.value = ''
  store.folders.choose(null)
}

async function pickOther(): Promise<void> {
  if (!isTauriRuntime()) {
    error.value = '要在安装版里才能选择文件夹'
    return
  }
  picking.value = true
  error.value = ''
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const picked = await invoke<string | null>(CMD.docPickFolder, { title: '选择保存位置' })
    if (picked !== null && picked !== '') store.folders.choose(picked)
  } catch (caught: unknown) {
    error.value = caught instanceof Error ? caught.message : '无法打开文件夹'
  } finally {
    picking.value = false
  }
}
</script>

<template>
  <div v-if="store.folders.open" class="folder-mask" @mousedown.self="cancel">
    <section class="folder-sheet" role="dialog" aria-label="选择保存位置" aria-modal="true">
      <header class="folder-sheet__head">
        <div>
          <p class="folder-sheet__kicker">保存到</p>
          <h2>选一个文件夹</h2>
        </div>
        <button type="button" class="folder-sheet__close" @click="cancel">取消</button>
      </header>
      <p class="folder-sheet__hint">文档会自动保存在这里。最近用过的五个文件夹可以直接选。</p>
      <ul v-if="store.folders.recent.length > 0" class="folder-sheet__list">
        <li v-for="folder in store.folders.recent" :key="folder">
          <button type="button" class="folder-sheet__row" :title="folder" @click="choose(folder)">
            <span class="folder-sheet__name">{{ shortenPath(folder) }}</span>
            <span class="folder-sheet__path">{{ folder }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="folder-sheet__empty">还没有保存过。先选一个文件夹。</p>
      <p v-if="error" class="folder-sheet__error">{{ error }}</p>
      <button type="button" class="folder-sheet__other" :disabled="picking" @click="pickOther">
        {{ picking ? '正在打开…' : '其他文件夹…' }}
      </button>
    </section>
  </div>
</template>

<style scoped>
.folder-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(18 18 23 / 28%);
}

.folder-sheet {
  width: min(440px, calc(100vw - 48px));
  padding: 22px;
  border-radius: 24px;
  background: #fff;
  color: #121217;
  box-shadow:
    0 1px 2px rgb(18 18 23 / 6%),
    0 18px 48px rgb(18 18 23 / 16%);
}

.folder-sheet__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.folder-sheet__kicker {
  margin: 0 0 4px;
  color: #3cb1e6;
  font-size: 12px;
  font-weight: 650;
}

.folder-sheet h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 650;
}

.folder-sheet__close,
.folder-sheet__other,
.folder-sheet__row {
  border-radius: 12px;
}

.folder-sheet__close {
  height: 32px;
  padding: 0 12px;
  color: #5c5c6e;
}

.folder-sheet__close:hover,
.folder-sheet__row:hover {
  background: #f6f7fa;
}

.folder-sheet__hint,
.folder-sheet__empty {
  margin: 14px 0;
  color: #5c5c6e;
  font-size: 13px;
  line-height: 1.6;
}

.folder-sheet__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 0 14px;
  padding: 0;
  list-style: none;
}

.folder-sheet__row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  padding: 10px 12px;
  text-align: left;
}

.folder-sheet__name {
  font-size: 14px;
  font-weight: 600;
}

.folder-sheet__path {
  max-width: 100%;
  color: #8a8a9a;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-sheet__error {
  margin: 0 0 10px;
  color: #c24141;
  font-size: 12px;
}

.folder-sheet__other {
  width: 100%;
  height: 40px;
  background: #3cb1e6;
  color: #121217;
  font-weight: 650;
}

.folder-sheet__other:disabled {
  opacity: 0.6;
}
</style>
