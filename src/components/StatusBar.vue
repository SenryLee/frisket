<script setup lang="ts">
/**
 * StatusBar.vue —— 底部状态栏
 *
 * 在整体中的位置：App.vue 三栏布局的最下方通栏，跨侧栏与编辑区。
 *
 * 显示内容全部来自 store/editor，由内核在每次 transaction 后交回。
 * 本组件不读文档正文，因此不需要订阅 docs —— 切换文档时
 * 内核会调 editor.reset()，统计值自然归零。
 */
import { computed } from 'vue'
import { useStore } from '@/store'
import { formatCount } from '@/store/format'

const store = useStore()

/**
 * ★ 不要解构 stats ★
 * `const { stats } = store.editor` 会在 setup 时把 getter 求值一次，
 * 拿到的是当时的快照。内核每次 transaction 都整体替换 stats 对象，
 * 解构出来的引用永远不会更新，状态栏会一直停在 0 字。
 * 必须每次经由 store.editor.stats 读，才能保持响应式追踪。
 */
const wordText = computed(() => `${formatCount(store.editor.stats.wordCount)} 字`)

const charText = computed(() => `${formatCount(store.editor.stats.charCount)} 字符`)

const lineText = computed(() => `${store.editor.stats.lineCount} 行`)

/**
 * 光标位置：行，列。
 *
 * offset→position 的换算属于内核职责（EditorStats 已提供 cursorColumn）。
 * 两者都未聚焦时为 null，此时显示占位符而不是 0 ——
 * 「第 0 行」看起来像一个合法的位置，会误导用户。
 */
const cursorText = computed(() => {
  const { cursorLine, cursorColumn } = store.editor.stats
  if (cursorLine === null) return '第 – 行，第 – 列'
  if (cursorColumn === null) return `第 ${cursorLine} 行，第 – 列`
  return `第 ${cursorLine} 行，第 ${cursorColumn} 列`
})

const selectionText = computed(() =>
  store.editor.hasSelection ? `已选 ${formatCount(store.editor.stats.selectionLength)} 字` : '',
)

/** 模式徽标。设置面板在 M1 之前不可用，状态栏是这些开关的唯一可见出口 */
const modeText = computed(() => {
  const modes: string[] = []
  if (store.editor.typewriterMode) modes.push('行居中')
  if (store.editor.readOnly) modes.push('只读')
  return modes.join(' · ')
})
</script>

<template>
  <footer class="status-bar glass-l1" role="status">
    <div class="status-bar__left">
      <span class="status-bar__item">{{ wordText }}</span>
      <span class="status-bar__divider" aria-hidden="true">·</span>
      <span class="status-bar__item">{{ charText }}</span>
      <span class="status-bar__divider" aria-hidden="true">·</span>
      <span class="status-bar__item">{{ lineText }}</span>
    </div>

    <div class="spacer" />

    <div class="status-bar__right">
      <span v-if="modeText" class="status-bar__badge">{{ modeText }}</span>
      <span v-if="selectionText" class="status-bar__item status-bar__item--accent">
        {{ selectionText }}
      </span>
      <span class="status-bar__item status-bar__item--muted">{{ cursorText }}</span>
      <span
        v-if="store.docs.saveError"
        class="status-bar__badge status-bar__badge--dirty"
        :title="store.docs.saveError"
      >
        保存失败
      </span>
      <span
        v-else-if="store.editor.dirty"
        class="status-bar__badge status-bar__badge--dirty"
        title="有未保存的修改"
      >
        未保存
      </span>
    </div>
  </footer>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  height: var(--statusbar-height);
  padding: 0 var(--space-5);
  /* 状态栏跨三栏通铺，只需要上边框；
   * glass-l1 的右边框在这里会与侧栏边框重叠成双线 */
  border-right: none;
  border-top: 1px solid var(--border-subtle);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  /* 状态栏数字每次按键都在变，任何过渡都会让它看起来在「闪」 */
  transition: none;
  flex-shrink: 0;
}

.status-bar__left,
.status-bar__right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.status-bar__item {
  white-space: nowrap;
  /* 等宽数字：字数变化时后面的字不会左右跳动 */
  font-variant-numeric: tabular-nums;
}

.status-bar__item--muted {
  color: var(--text-muted);
}

.status-bar__item--accent {
  color: var(--accent);
}

.status-bar__divider {
  color: var(--text-muted);
  opacity: 0.5;
}

.status-bar__badge {
  padding: 1px var(--space-3);
  border-radius: var(--radius-full);
  background: var(--bg-active);
  color: var(--text-secondary);
  white-space: nowrap;
}

.status-bar__badge--dirty {
  background: var(--accent-muted);
  color: var(--accent);
}
</style>