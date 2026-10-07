<script setup lang="ts">
/**
 * 顶部格式栏。参考 Obsidian Editing Toolbar 的 top 模式：
 * 一组常驻按钮，标题、颜色、链接、图片、表格走弹出层。
 * 宽度不够时横向滚动，不换行。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { retainPointer } from '@/core/reliablePress'
import { EDITOR_HANDLE, useStore } from '@/store'
import { sameHex, useSelectionInk } from './inkPreview'
import { cancelPainter, painterArmed } from './toolbarActions'
import { BACKGROUND_COLORS, TEXT_COLORS } from './types'
import type { ToolbarAction } from './types'
import type { AlignMode } from '@/core/format'

const emit = defineEmits<{
  action: [action: ToolbarAction]
}>()

const store = useStore()
const editorHandleRef = inject(EDITOR_HANDLE, null)
const editorReady = computed(() => editorHandleRef?.value != null)
const { ink, textStyle, highlightStyle } = useSelectionInk()

type PopoverKind = 'heading' | 'link' | 'image' | 'table' | 'textColor' | 'bgColor' | 'align'

const popover = ref<{ kind: PopoverKind; top: number; left: number } | null>(null)
const linkText = ref('')
const linkUrl = ref('https://')
const imageAlt = ref('')
const imageSrc = ref('')
const tableRows = ref(3)
const tableCols = ref(3)

interface ButtonSpec {
  action: ToolbarAction
  label: string
  hint: string
  glyph: string
  tone?: 'bold' | 'italic' | 'strike' | 'code'
}

const historyButtons: readonly ButtonSpec[] = [
  { action: { id: 'undo' }, label: '撤销', hint: '⌘Z', glyph: '↩' },
  { action: { id: 'redo' }, label: '重做', hint: '⇧⌘Z', glyph: '↪' },
]

const markButtons: readonly ButtonSpec[] = [
  { action: { id: 'bold' }, label: '加粗', hint: '⌘B', glyph: 'B', tone: 'bold' },
  { action: { id: 'italic' }, label: '斜体', hint: '⌘I', glyph: 'I', tone: 'italic' },
  { action: { id: 'strike' }, label: '删除线', hint: '⇧⌘X', glyph: 'S', tone: 'strike' },
  { action: { id: 'code' }, label: '行内代码', hint: '⌘E', glyph: '</>', tone: 'code' },
]

const blockButtons: readonly ButtonSpec[] = [
  { action: { id: 'quote' }, label: '引用', hint: '⇧⌘9', glyph: '❝' },
  { action: { id: 'bullet' }, label: '无序列表', hint: '⇧⌘8', glyph: '•' },
  { action: { id: 'ordered' }, label: '有序列表', hint: '⇧⌘7', glyph: '1.' },
  { action: { id: 'task' }, label: '任务', hint: '', glyph: '☑' },
  { action: { id: 'outdent' }, label: '减少缩进', hint: '', glyph: '⇤' },
  { action: { id: 'indent' }, label: '增加缩进', hint: '', glyph: '⇥' },
]

const insertButtons: readonly ButtonSpec[] = [
  { action: { id: 'hr' }, label: '分割线', hint: '', glyph: '—' },
  { action: { id: 'hardBreak' }, label: '硬换行', hint: '', glyph: '↵' },
  { action: { id: 'clear' }, label: '清除格式', hint: '', glyph: '⌫' },
]

const aligns: readonly { align: AlignMode; label: string; glyph: string }[] = [
  { align: 'left', label: '左对齐', glyph: '左' },
  { align: 'center', label: '居中', glyph: '中' },
  { align: 'right', label: '右对齐', glyph: '右' },
  { align: 'justify', label: '两端对齐', glyph: '齐' },
]

function titleOf(label: string, hint: string): string {
  return hint === '' ? label : `${label}  ${hint}`
}

function fire(action: ToolbarAction): void {
  popover.value = null
  emit('action', action)
}

function openPopover(kind: PopoverKind, event: MouseEvent): void {
  const button = event.currentTarget
  if (!(button instanceof HTMLElement)) return
  if (popover.value?.kind === kind) {
    popover.value = null
    return
  }
  const rect = button.getBoundingClientRect()
  const width = kind === 'link' || kind === 'image' ? 244 : 210
  popover.value = {
    kind,
    top: rect.bottom + 6,
    left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
  }
  if (kind === 'link') {
    const handle = editorHandleRef?.value
    const selection = handle?.getSelection()
    const selected =
      handle && selection && selection.from !== selection.to
        ? handle.getDoc().slice(selection.from, selection.to)
        : ''
    linkText.value = selected
    linkUrl.value = 'https://'
  }
  if (kind === 'image') {
    imageAlt.value = ''
    imageSrc.value = ''
  }
}

function keepSelection(event: MouseEvent): void {
  retainPointer(event)
}

function submitLink(): void {
  fire({ id: 'link', text: linkText.value.trim() || '链接', url: linkUrl.value.trim() })
}

function submitImage(): void {
  fire({ id: 'image', alt: imageAlt.value.trim() || '图片', src: imageSrc.value.trim() })
}

function pickTable(rows: number, cols: number): void {
  fire({ id: 'table', rows, cols })
}

function hoverTable(rows: number, cols: number): void {
  tableRows.value = rows
  tableCols.value = cols
}

function keepPopover(event: MouseEvent): void {
  retainPointer(event)
}

function onCustomColor(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || popover.value === null) return
  const kind = popover.value.kind === 'bgColor' ? 'background' : 'text'
  if (!/^#[0-9a-fA-F]{6}$/.test(target.value)) return
  fire({ id: 'color', kind, color: target.value })
}

function onDocumentPointer(event: Event): void {
  const target = event.target
  if (!(target instanceof Node)) return
  if (target instanceof Element && target.closest('.toolbar, .popover')) return
  popover.value = null
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') popover.value = null
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointer)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointer)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="toolbar glass-l1" role="toolbar" aria-label="格式快捷栏" @mousedown="keepSelection">
    <div class="toolbar__scroll">
      <div class="toolbar__group">
        <button
          v-for="button in historyButtons"
          :key="button.label"
          class="toolbar__button"
          type="button"
          :disabled="!editorReady"
          :title="titleOf(button.label, button.hint)"
          :aria-label="button.label"
          @click="fire(button.action)"
        >
          <span class="toolbar__glyph">{{ button.glyph }}</span>
        </button>
      </div>

      <span class="toolbar__sep" />

      <div class="toolbar__group">
        <button
          class="toolbar__button toolbar__button--menu"
          type="button"
          :disabled="!editorReady"
          title="标题"
          aria-label="标题"
          @click="openPopover('heading', $event)"
        >
          <span class="toolbar__glyph is-bold">H</span>
          <span class="toolbar__caret">▾</span>
        </button>
        <button
          v-for="level in [1, 2, 3]"
          :key="level"
          class="toolbar__button"
          type="button"
          :disabled="!editorReady"
          :title="`标题 ${level}  ⌥⌘${level}`"
          :aria-label="`标题 ${level}`"
          @click="fire({ id: 'heading', level })"
        >
          <span class="toolbar__glyph">H{{ level }}</span>
        </button>
      </div>

      <span class="toolbar__sep" />

      <div class="toolbar__group">
        <button
          v-for="button in markButtons"
          :key="button.label"
          class="toolbar__button"
          type="button"
          :disabled="!editorReady"
          :title="titleOf(button.label, button.hint)"
          :aria-label="button.label"
          @click="fire(button.action)"
        >
          <span class="toolbar__glyph" :class="button.tone ? `is-${button.tone}` : ''">{{ button.glyph }}</span>
        </button>
        <button
          class="toolbar__button"
          type="button"
          :disabled="!editorReady"
          :title="ink.color ? `文字颜色 ${ink.color}` : '文字颜色'"
          aria-label="文字颜色"
          @click="openPopover('textColor', $event)"
        >
          <span class="toolbar__glyph is-color" :style="textStyle">
            A
            <span class="toolbar__ink-bar" />
          </span>
        </button>
        <button
          class="toolbar__button"
          type="button"
          :disabled="!editorReady"
          :title="ink.background ? `高亮 ${ink.background}` : '高亮'"
          aria-label="高亮"
          @click="openPopover('bgColor', $event)"
        >
          <span class="toolbar__glyph is-bg" :style="highlightStyle">高</span>
        </button>
        <button
          class="toolbar__button"
          type="button"
          :disabled="!editorReady"
          :class="{ 'is-on': painterArmed }"
          :title="painterArmed ? '格式刷已拿起，选中目标后再点一次。右键取消' : '格式刷：先选中带格式的文字'"
          aria-label="格式刷"
          @click="fire({ id: 'painter' })"
          @contextmenu.prevent="cancelPainter()"
        >
          <span class="toolbar__glyph">刷</span>
        </button>
      </div>

      <span class="toolbar__sep" />

      <div class="toolbar__group">
        <button
          v-for="button in blockButtons"
          :key="button.label"
          class="toolbar__button"
          type="button"
          :disabled="!editorReady"
          :title="titleOf(button.label, button.hint)"
          :aria-label="button.label"
          @click="fire(button.action)"
        >
          <span class="toolbar__glyph">{{ button.glyph }}</span>
        </button>
      </div>

      <span class="toolbar__sep" />

      <div class="toolbar__group">
        <button
          class="toolbar__button"
          type="button"
          :disabled="!editorReady"
          title="链接"
          aria-label="链接"
          @click="openPopover('link', $event)"
        >
          <span class="toolbar__glyph">链</span>
        </button>
        <button
          class="toolbar__button"
          type="button"
          :disabled="!editorReady"
          title="图片"
          aria-label="图片"
          @click="openPopover('image', $event)"
        >
          <span class="toolbar__glyph">图</span>
        </button>
        <button
          class="toolbar__button"
          type="button"
          :disabled="!editorReady"
          title="表格"
          aria-label="表格"
          @click="openPopover('table', $event)"
        >
          <span class="toolbar__glyph">表</span>
        </button>
        <button
          class="toolbar__button"
          type="button"
          :disabled="!editorReady"
          title="对齐"
          aria-label="对齐"
          @click="openPopover('align', $event)"
        >
          <span class="toolbar__glyph">齐</span>
        </button>
      </div>

      <span class="toolbar__sep" />

      <div class="toolbar__group">
        <button
          v-for="button in insertButtons"
          :key="button.label"
          class="toolbar__button"
          type="button"
          :disabled="!editorReady"
          :title="button.label"
          :aria-label="button.label"
          @click="fire(button.action)"
        >
          <span class="toolbar__glyph">{{ button.glyph }}</span>
        </button>
      </div>
    </div>

    <div class="toolbar__group toolbar__group--trailing">
      <button
        class="toolbar__toggle"
        type="button"
        :class="{ 'is-on': store.editor.typewriterMode }"
        :aria-pressed="store.editor.typewriterMode"
        title="打字机模式：正在写的这一行保持在画面正中，文档往下滚。不改动 Markdown。"
        @click="store.editor.setTypewriterMode(!store.editor.typewriterMode)"
      >
        行居中
      </button>
      <button
        class="toolbar__toggle"
        type="button"
        :class="{ 'is-on': store.editor.prefs.showLineNumbers }"
        :aria-pressed="store.editor.prefs.showLineNumbers"
        title="显示行号"
        @click="store.editor.setPref('showLineNumbers', !store.editor.prefs.showLineNumbers)"
      >
        行号
      </button>
    </div>

    <Teleport to="body">
    <div
      v-if="popover"
      class="popover glass-l3"
      :style="{ top: `${popover.top}px`, left: `${popover.left}px` }"
      @mousedown="keepPopover"
      @pointerdown.stop
    >
      <div v-if="popover.kind === 'heading'" class="popover__list" role="menu">
        <button
          v-for="level in 6"
          :key="level"
          type="button"
          class="popover__item"
          :style="{ fontSize: `${18 - level}px` }"
          @click="fire({ id: 'heading', level })"
        >
          标题 {{ level }}
        </button>
      </div>

      <form v-else-if="popover.kind === 'link'" class="popover__form" @submit.prevent="submitLink">
        <label class="popover__label">显示文字<input v-model="linkText" class="popover__input" /></label>
        <label class="popover__label">链接<input v-model="linkUrl" class="popover__input" /></label>
        <button class="popover__submit" type="submit">插入链接</button>
      </form>

      <form v-else-if="popover.kind === 'image'" class="popover__form" @submit.prevent="submitImage">
        <label class="popover__label">描述<input v-model="imageAlt" class="popover__input" /></label>
        <label class="popover__label">地址或本地路径<input v-model="imageSrc" class="popover__input" /></label>
        <button class="popover__submit" type="submit">插入图片</button>
      </form>

      <div v-else-if="popover.kind === 'table'" class="popover__table">
        <p class="popover__caption">{{ tableRows }} × {{ tableCols }}</p>
        <div class="popover__grid">
          <button
            v-for="cell in 36"
            :key="cell"
            type="button"
            class="popover__cell"
            :class="{ 'is-hot': Math.ceil(cell / 6) <= tableRows && ((cell - 1) % 6) + 1 <= tableCols }"
            @mouseenter="hoverTable(Math.ceil(cell / 6), ((cell - 1) % 6) + 1)"
            @click="pickTable(Math.ceil(cell / 6), ((cell - 1) % 6) + 1)"
          />
        </div>
      </div>

      <div v-else-if="popover.kind === 'textColor' || popover.kind === 'bgColor'" class="popover__palette">
        <p class="popover__caption">{{ popover.kind === 'textColor' ? '文字颜色' : '高亮' }}</p>
        <div class="popover__colors">
          <button
            v-for="color in popover.kind === 'textColor' ? TEXT_COLORS : BACKGROUND_COLORS"
            :key="color"
            type="button"
            class="popover__swatch"
            :class="{ 'is-current': sameHex(popover.kind === 'textColor' ? ink.color : ink.background, color) }"
            :style="{ background: color }"
            :aria-label="color"
            @click="fire({ id: 'color', kind: popover.kind === 'textColor' ? 'text' : 'background', color })"
          />
        </div>
        <label class="popover__custom">
          自定义
          <input
            :key="popover.kind"
            type="color"
            :value="popover.kind === 'textColor' ? (ink.color ?? '#c0392b') : (ink.background ?? '#f3e2a2')"
            @change="onCustomColor"
          />
        </label>
      </div>

      <div v-else class="popover__list">
        <button
          v-for="item in aligns"
          :key="item.align"
          type="button"
          class="popover__item"
          @click="fire({ id: 'align', align: item.align })"
        >
          {{ item.label }}
        </button>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<style scoped>
.toolbar {
  position: relative;
  display: flex;
  align-items: center;
  height: var(--toolbar-height);
  padding: 0 var(--space-3);
  gap: var(--space-2);
  border-right: none;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.toolbar__scroll {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.toolbar__scroll::-webkit-scrollbar {
  display: none;
}

.toolbar__group {
  display: flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
}

.toolbar__sep {
  width: 1px;
  height: 14px;
  background: var(--border);
  flex-shrink: 0;
}

.toolbar__button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 30px;
  padding: 0 var(--space-2);
  border-radius: 10px;
  color: var(--text-secondary);
  transition:
    background var(--dur-fast-eff) var(--ease-out),
    color var(--dur-fast-eff) var(--ease-out);
}

.toolbar__button--menu {
  gap: 1px;
  padding-right: var(--space-1);
}

.toolbar__button:not(:disabled):hover,
.toolbar__button.is-on {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.toolbar__button.is-on {
  background: var(--accent-muted);
  color: var(--accent);
}

.toolbar__button:disabled {
  opacity: 0.4;
}

.toolbar__glyph {
  font-size: var(--text-sm);
  line-height: 1;
}

.toolbar__glyph.is-bold { font-weight: 700; }
.toolbar__glyph.is-italic { font-style: italic; font-family: Georgia, serif; }
.toolbar__glyph.is-strike { text-decoration: line-through; }
.toolbar__glyph.is-code { font-family: var(--font-mono); font-size: 11px; }
.toolbar__glyph.is-color {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  color: var(--accent);
  font-weight: 700;
  line-height: 1;
}
.toolbar__ink-bar {
  width: 11px;
  height: 2px;
  border-radius: 1px;
  background: currentColor;
  box-shadow: 0 0 0 1px var(--border-strong);
}
.toolbar__glyph.is-bg {
  background: #f3e2a2;
  color: #1a1a1a;
  border-radius: 2px;
  padding: 0 2px;
  font-weight: 700;
}

.toolbar__caret {
  font-size: 8px;
  opacity: 0.7;
}

.toolbar__toggle {
  height: var(--control-height-sm);
  padding: 0 var(--space-3);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  background: var(--bg-sunken);
  flex-shrink: 0;
}

.toolbar__toggle.is-on {
  background: var(--accent-muted);
  color: var(--accent);
}

.toolbar__group--trailing {
  gap: var(--space-2);
}

.popover {
  position: fixed;
  z-index: var(--z-float);
  min-width: 168px;
  padding: var(--space-3);
  background: var(--bg-overlay);
}

.popover__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.popover__item,
.popover__submit {
  text-align: left;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
}

.popover__item:hover,
.popover__submit:hover {
  background: var(--bg-hover);
}

.popover__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 220px;
}

.popover__label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.popover__input {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-raised);
  color: var(--text-primary);
  user-select: text;
  -webkit-user-select: text;
}

.popover__submit {
  background: var(--accent);
  color: var(--accent-contrast);
  text-align: center;
}

.popover__caption {
  margin-bottom: 6px;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.popover__grid {
  display: grid;
  grid-template-columns: repeat(6, 16px);
  gap: 3px;
}

.popover__cell {
  width: 16px;
  height: 16px;
  border: 1px solid var(--border-strong);
  border-radius: 2px;
  background: var(--bg-sunken);
}

.popover__cell.is-hot {
  background: var(--accent);
  border-color: var(--accent);
}

.popover__palette {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 188px;
}

.popover__colors {
  display: flex;
  gap: 6px;
}

.popover__swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 35%);
}

.popover__swatch:hover {
  transform: scale(1.08);
}

.popover__swatch.is-current {
  outline: 2px solid var(--text-primary);
  outline-offset: 2px;
}

.popover__custom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
