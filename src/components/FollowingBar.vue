<script setup lang="ts">
/**
 * 跟随选区的小工具栏。对应 Editing Toolbar 的 following 模式：
 * 选中文字后出现在选区上方，常用格式不用把鼠标移回顶栏。
 * 高亮和顶栏是同一块底色色板，不再另放一个 == 按钮。
 */
import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EDITOR_HANDLE, useStore } from '@/store'
import { sameHex, useSelectionInk } from './inkPreview'
import { BACKGROUND_COLORS } from './types'
import type { ToolbarAction } from './types'

const emit = defineEmits<{
  action: [action: ToolbarAction]
}>()

const store = useStore()
const editorHandleRef = inject(EDITOR_HANDLE, null)
const { ink, highlightStyle } = useSelectionInk()
const bar = ref<HTMLElement | null>(null)
const visible = ref(false)
const top = ref(0)
const left = ref(0)
const palette = ref<{ top: number; left: number } | null>(null)

const leadButtons: readonly { action: ToolbarAction; label: string; glyph: string }[] = [
  { action: { id: 'bold' }, label: '加粗', glyph: 'B' },
  { action: { id: 'italic' }, label: '斜体', glyph: 'I' },
  { action: { id: 'strike' }, label: '删除线', glyph: 'S' },
  { action: { id: 'code' }, label: '代码', glyph: '</>' },
]

const tailButtons: readonly { action: ToolbarAction; label: string; glyph: string }[] = [
  { action: { id: 'link', text: '', url: 'https://' }, label: '链接', glyph: '链' },
  { action: { id: 'quote' }, label: '引用', glyph: '❝' },
  { action: { id: 'clear' }, label: '清除', glyph: '⌫' },
]

function place(): void {
  const handle = editorHandleRef?.value
  const selection = store.editor.selection
  if (!handle || selection.from === selection.to || !store.editor.focused) {
    visible.value = false
    return
  }
  const rect = handle.selectionRect()
  if (rect === null) {
    visible.value = false
    return
  }
  const width = bar.value?.offsetWidth ?? 280
  const nextTop = rect.top - 40
  top.value = nextTop < 48 ? rect.bottom + 8 : nextTop
  left.value = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
  visible.value = true
}

function fire(action: ToolbarAction): void {
  palette.value = null
  emit('action', action)
}

function openHighlight(event: MouseEvent): void {
  const button = event.currentTarget
  if (!(button instanceof HTMLElement)) return
  if (palette.value) {
    palette.value = null
    return
  }
  const rect = button.getBoundingClientRect()
  const width = 210
  const height = 96
  let nextTop = rect.bottom + 6
  if (nextTop + height > window.innerHeight - 8) nextTop = Math.max(8, rect.top - height - 6)
  palette.value = {
    top: nextTop,
    left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
  }
}

function keepPopover(event: MouseEvent): void {
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
  event.preventDefault()
}

function onCustomColor(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  if (!/^#[0-9a-fA-F]{6}$/.test(target.value)) return
  fire({ id: 'color', kind: 'background', color: target.value })
}

function onDocumentPointer(event: Event): void {
  const target = event.target
  if (!(target instanceof Node)) return
  if (target instanceof Element && target.closest('.following, .popover')) return
  palette.value = null
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') palette.value = null
}

watch(() => [store.editor.selection.from, store.editor.selection.to, store.editor.focused], place)

watch(visible, (shown) => {
  if (!shown) palette.value = null
})

function onScroll(): void {
  palette.value = null
  place()
}

onMounted(() => {
  document.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', place)
  document.addEventListener('pointerdown', onDocumentPointer)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', place)
  document.removeEventListener('pointerdown', onDocumentPointer)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    v-show="visible"
    ref="bar"
    class="following glass-l3"
    role="toolbar"
    aria-label="选区格式"
    :style="{ top: `${top}px`, left: `${left}px` }"
    @mousedown.prevent
  >
    <button
      v-for="button in leadButtons"
      :key="button.label"
      type="button"
      class="following__button"
      :title="button.label"
      :aria-label="button.label"
      @click="fire(button.action)"
    >
      {{ button.glyph }}
    </button>
    <button
      type="button"
      class="following__button"
      :title="ink.background ? `高亮 ${ink.background}` : '高亮'"
      aria-label="高亮"
      @click="openHighlight"
    >
      <span class="following__mark" :style="highlightStyle">高</span>
    </button>
    <button
      v-for="button in tailButtons"
      :key="button.label"
      type="button"
      class="following__button"
      :title="button.label"
      :aria-label="button.label"
      @click="fire(button.action)"
    >
      {{ button.glyph }}
    </button>
  </div>
  <Teleport to="body">
    <div
      v-if="palette"
      class="popover glass-l3"
      :style="{ top: `${palette.top}px`, left: `${palette.left}px` }"
      @mousedown="keepPopover"
      @pointerdown.stop
    >
      <p class="popover__caption">高亮</p>
      <div class="popover__colors">
        <button
          v-for="color in BACKGROUND_COLORS"
          :key="color"
          type="button"
          class="popover__swatch"
          :class="{ 'is-current': sameHex(ink.background, color) }"
          :style="{ background: color }"
          :aria-label="color"
          @click="fire({ id: 'color', kind: 'background', color })"
        />
      </div>
      <label class="popover__custom">
        自定义
        <input type="color" :value="ink.background ?? '#f3e2a2'" @change="onCustomColor" />
      </label>
    </div>
  </Teleport>
</template>

<style scoped>
.following {
  position: fixed;
  z-index: var(--z-float);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
}

.following__button {
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.following__button:hover {
  background: var(--bg-hover);
}

.following__mark {
  background: #f3e2a2;
  color: #1a1a1a;
  border-radius: 2px;
  padding: 0 2px;
  font-weight: 700;
}

.popover {
  position: fixed;
  z-index: var(--z-float);
  min-width: 188px;
  padding: var(--space-3);
  background: var(--bg-overlay);
}

.popover__caption {
  margin: 0 0 6px;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.popover__colors {
  display: flex;
  gap: 6px;
}

.popover__swatch.is-current {
  outline: 2px solid var(--text-primary);
  outline-offset: 2px;
}

.popover__swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 35%);
}

.popover__custom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.popover__custom input[type='color'] {
  width: 32px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}
</style>
