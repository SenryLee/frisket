<script setup lang="ts">
/**
 * AiPanelShell.vue —— AI 面板的外壳
 *
 * 在整体中的位置：App.vue 三栏布局的右栏，L1 玻璃层。
 *
 * ★ 文件所有权的边界 ★
 * 面板内部的对话流、动作卡片、Ghost text 由「AI」子智能体实现，
 * 位于 src/components/ai/ 下。那里的一切都不属于本组件。
 *
 * 本组件只负责「外壳」：定位、玻璃层次、折叠动画、头部。
 * 这是刻意的分工 —— 外壳要在内核接入前就能定稿，
 * 而 AI 面板的内部在 M2 才开始做。若把两者写在一个文件里，
 * M2 的 AI 开发会被 M0 的布局需求绑住。
 *
 * 通过默认插槽接入内容：AI 子智能体完成后，
 * App.vue 只需在 <AiPanelShell> 里插入 <AIPanel />，
 * 外壳无需任何改动。
 */
import { useStore } from '@/store'

const store = useStore()

function close(): void {
  store.ai.close()
}
</script>

<template>
  <!--
    侧栏在文档流里，打开时编辑区让出宽度，不再盖住正文。
    收起时宽度为 0，对话草稿仍留在 DOM 里。
  -->
  <aside
    class="ai-shell glass-l1 glass-l1--raised"
    :class="{ 'is-open': store.ai.open }"
    :aria-hidden="!store.ai.open"
    :inert="!store.ai.open"
    aria-label="AI 助手"
  >
    <header class="ai-shell__header">
      <h2 class="ai-shell__heading">AI 助手</h2>

      <button
        class="ai-shell__close"
        type="button"
        aria-label="收起 AI 面板"
        title="收起 ⌘J"
        @click="close"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </button>
    </header>

    <div class="ai-shell__body">
      <!-- AI 子智能体的 AIPanel 挂载点 -->
      <slot>
        <!-- M0 空态：给出可执行的下一步，而不是空白面板。
             文案说明当前处于哪个阶段，避免被当成「加载失败」。 -->
        <div class="ai-shell__placeholder">
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            aria-hidden="true"
            class="ai-shell__placeholder-icon"
          >
            <path
              d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linejoin="round"
            />
            <path
              d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.1"
              stroke-linejoin="round"
              opacity="0.6"
            />
          </svg>
          <p class="ai-shell__placeholder-title">划选正文即可调用 AI</p>
          <p class="ai-shell__placeholder-hint">
            在左侧编辑区选中一段文字，这里会出现润色、精简、扩写等操作。<br />
            AI 只处理你划选的部分，不会改动其他内容。
          </p>
        </div>
      </slot>
    </div>

    <!-- 流式进行中显示进度条。放在底部而非顶部：
         对话内容在上方增长，进度条固定在底部更符合「正在输出」的直觉。 -->
    <footer v-if="store.ai.streaming" class="ai-shell__progress">
      <div class="ai-shell__progress-bar" :style="{ boxShadow: 'var(--glow-accent)' }" />
    </footer>
  </aside>
</template>

<style scoped>
.ai-shell {
  display: flex;
  flex-direction: column;
  width: 0;
  min-width: 0;
  flex-shrink: 0;
  border-radius: 0;
  overflow: hidden;
  border-right: none;
  border-left: 0 solid transparent;
  visibility: hidden;
  pointer-events: none;
  transition:
    width var(--dur-panel-eff) var(--ease-out),
    visibility 0s linear var(--dur-panel-eff);
}

.ai-shell.is-open {
  width: var(--ai-panel-width);
  border-left: 1px solid var(--border-subtle);
  visibility: visible;
  pointer-events: auto;
  transition:
    width var(--dur-panel-eff) var(--ease-out),
    visibility 0s;
}

.ai-shell__header {
  display: flex;
  align-items: center;
  height: var(--toolbar-height);
  padding: 0 var(--space-4) 0 var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.ai-shell__heading {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.02em;
}

.ai-shell__close {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  transition:
    background var(--dur-fast-eff) var(--ease-out),
    color var(--dur-fast-eff) var(--ease-out);
}

.ai-shell__close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.ai-shell__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ai-shell__body > :deep(*) {
  flex: 1;
  min-height: 0;
}

.ai-shell__placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  height: 100%;
  padding: var(--space-8);
  text-align: center;
}

.ai-shell__placeholder-icon {
  color: var(--accent);
  opacity: 0.7;
  /* 发光只在 Neon Glass 主题下有意义，其余主题该变量是透明 */
  filter: drop-shadow(var(--glow-accent));
}

.ai-shell__placeholder-title {
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--text-secondary);
}

.ai-shell__placeholder-hint {
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--text-muted);
  max-width: 26ch;
}

.ai-shell__progress {
  height: 2px;
  flex-shrink: 0;
  background: var(--bg-active);
  overflow: hidden;
}

.ai-shell__progress-bar {
  height: 100%;
  width: 100%;
  background: var(--accent);
  /* 进度条本身没有确定进度，用循环扫描表示「还在流」 */
  animation: ai-shell-scan 1.1s var(--ease-in-out) infinite;
  transform-origin: left center;
}

@keyframes ai-shell-scan {
  0% {
    transform: scaleX(0);
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
  100% {
    transform: scaleX(1);
    opacity: 0.6;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ai-shell__progress-bar {
    animation: none;
    opacity: 0.8;
  }
}
</style>