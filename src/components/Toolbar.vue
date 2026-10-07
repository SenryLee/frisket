<script setup lang="ts">
/**
 * Toolbar.vue —— 快捷栏容器
 *
 * 在整体中的位置：编辑区顶部、状态栏之上，是M1 主要工作量所在。
 * M0 只交付容器结构与按钮的视觉规格。
 *
 * ★ 设计原则：M0 的按钮是真的，不是装饰 ★
 * 每个按钮都发出具名意图事件（emit），由 App.vue 转交给内核的
 * EditorHandle执行。这样做的原因：快捷栏、内核、命令面板
 * 都操作同一份文档状态，若各自直接调EditorHandle，
 * 就会出现「同一操作三条路径」，撤销分组与 AI 写回识别都会出错。
 * 统一走事件，调用路径永远只有一条。
 *
 * 内核未接入时按钮是disabled 而不是「点了没反应」——
 * 后者会让用户反复点，是最差的交互。
 */
import { computed, inject } from 'vue'
import { EDITOR_HANDLE, useStore } from '@/store'
import type { ToolbarAction } from './types'

const emit = defineEmits<{
  action: [action: ToolbarAction]
}>()

const store = useStore()

interface ToolbarButton {
  action: ToolbarAction
  label: string
  hint: string
  glyph: string
  /** 分组间隔线：用于视觉分段 */
  separated: boolean
}

/**
 * 按钮清单。
 *
 * 分组顺序按「写作频率」而非功能类别：
 * 粗体/斜体/删除线连在一起是最高频的，
 * 把它们隔开会让每次加粗都变成一次视线搜索。
 */
const buttons: readonly ToolbarButton[] = Object.freeze([
  { action: 'bold', label: '加粗', hint: '⌘B', glyph: 'B', separated: false },
  { action: 'italic', label: '斜体', hint: '⌘I', glyph: 'I', separated: false },
  { action: 'strike', label: '删除线', hint: '', glyph: 'S', separated: false },
  { action: 'heading', label: '标题', hint: '⌘⌥1', glyph: 'H', separated: true },
  { action: 'code', label: '行内代码', hint: '⌘E', glyph: '<>', separated: false },
  { action: 'quote', label: '引用', hint: '⌘⇧9', glyph: '❝', separated: true },
  { action: 'bulletList', label: '无序列表', hint: '⌘⇧8', glyph: '•', separated: false },
  { action: 'orderedList', label: '有序列表', hint: '⌘⇧7', glyph: '1.', separated: false },
  { action: 'table', label: '表格', hint: '', glyph: '▦', separated: true },
  { action: 'link', label: '链接', hint: '⌘K', glyph: '⚯', separated: true },
  { action: 'image', label: '图片', hint: '⌘⇧I', glyph: '▨', separated: false },
])

/**
 * 内核是否已就绪。
 *
 * 直接问内核注入的 EditorHandle 是否存在，而不是维护一个布尔开关：
 * 手写布尔量的必然结果是「内核早已就绪但按钮还是灰的」。
 */
const editorHandleRef = inject(EDITOR_HANDLE, null)

const editorReady = computed(() => {
  const handle = editorHandleRef?.value
  return handle !== null && handle !== undefined
})

/**
 * 按钮的 tooltip 文案。
 *
 * 把快捷键提示拼进 title 而不是单独渲染一列：快捷键标注占位会
 * 让 11 个按钮的宽度膨胀近一倍，而tooltip 在使用时才需要。
 */
function buttonTitle(button: ToolbarButton, ready: boolean): string {
  const name = button.hint === '' ? button.label : `${button.label} ${button.hint}`
  return ready ? name : `${name}（编辑器内核接入后可用）`
}

function trigger(action: ToolbarAction): void {
  emit('action', action)
}
</script>

<template>
  <div class="toolbar glass-l1" role="toolbar" aria-label="格式快捷栏">
    <!-- 按钮组 -->
    <div class="toolbar__group">
      <button
        v-for="button in buttons"
        :key="button.action"
        class="toolbar__button"
        :class="{
          'is-separated': button.separated,
          'is-disabled': !editorReady,
        }"
        type="button"
        :disabled="!editorReady"
        :title="buttonTitle(button, editorReady)"
        :aria-label="button.label"
        @click="trigger(button.action)"
      >
        <span
          class="toolbar__glyph"
          :class="{
            'is-bold': button.action === 'bold',
            'is-italic': button.action === 'italic',
            'is-strike': button.action === 'strike',
          }"
          >{{ button.glyph }}</span
        >
      </button>
    </div>

    <div class="spacer" />

    <!-- 右侧：编辑区偏好开关。
         这里放的是不需要内核就能生效的视觉开关，
         它们立即改变 CSS 变量，是M0 唯一可验证的交互闭环。 -->
    <div class="toolbar__group toolbar__group--trailing">
      <button
        class="toolbar__toggle"
        type="button"
        :class="{ 'is-on': store.editor.typewriterMode }"
        :aria-pressed="store.editor.typewriterMode"
        title="打字机模式：当前行固定在视口垂直中央"
        @click="store.editor.setTypewriterMode(!store.editor.typewriterMode)"
      >
        打字机
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
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  height: var(--toolbar-height);
  padding: 0 var(--space-4);
  gap: var(--space-3);
  /* 工具栏与编辑区同处中栏，只需要下边框；
   * glass-l1 的右边框会与侧栏的边框重叠成双线 */
  border-right: none;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.toolbar__group {
  display: flex;
  align-items: center;
  gap: 1px;
}

.toolbar__button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: var(--control-height);
  height: var(--control-height);
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition:
    background var(--dur-fast-eff) var(--ease-out),
    color var(--dur-fast-eff) var(--ease-out);
}

.toolbar__button:not(:disabled):hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* 分组间隔线：用 border 而非额外元素，省一个 DOM 节点 */
.toolbar__button.is-separated {
  position: relative;
  margin-left: var(--space-4);
}

.toolbar__button.is-separated::before {
  content: '';
  position: absolute;
  left: calc(var(--space-4) / -2 - 1px);
  top: 20%;
  bottom: 20%;
  width: 1px;
  background: var(--border);
}

.toolbar__glyph {
  font-size: var(--text-md);
  line-height: 1;
  /* 字形基线对齐：不同 glyph 的默认行高不一致，
   * 不统一会让按钮里的符号参差不齐 */
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.toolbar__glyph.is-bold {
  font-weight: 700;
}

.toolbar__glyph.is-italic {
  font-style: italic;
  font-family: Georgia, serif;
}

.toolbar__glyph.is-strike {
  text-decoration: line-through;
}

.toolbar__toggle {
  height: var(--control-height-sm);
  padding: 0 var(--space-4);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  background: var(--bg-sunken);
  transition:
    background var(--dur-fast-eff) var(--ease-out),
    color var(--dur-fast-eff) var(--ease-out);
}

.toolbar__toggle:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.toolbar__toggle.is-on {
  background: var(--accent-muted);
  color: var(--accent);
  box-shadow: var(--glow-accent);
}

.toolbar__group--trailing {
  gap: var(--space-3);
}
</style>