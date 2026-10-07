<script setup lang="ts">
/**
 * AI 面板。
 * 划选走改写：Rust 把上下文和目标拆开，写回前过长度、泄漏和位置锁。
 * 自由对话不写正文。密钥不进这个组件。
 */
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { captureSelection, countChars, prepareReplacement, type GuardResult, type RewriteSnapshot } from '@/core/aiGuard'
import { CMD, EVENT } from '@/ipc/commands'
import type { AiErrorCode } from '@/core/interfaces'
import { EDITOR_HANDLE, useStore } from '@/store'
import { isTauriRuntime } from '@/store/appearance'

interface Bubble {
  role: 'user' | 'assistant'
  content: string
}

interface RewriteCard {
  action: string
  label: string
  instruction: string
  raw: string
  snapshot: RewriteSnapshot
  done: boolean
}

const emit = defineEmits<{ openSettings: [] }>()
const store = useStore()
const editorHandleRef = inject(EDITOR_HANDLE, null)

const messages = ref<Bubble[]>([])
const draft = ref('')
const listEl = ref<HTMLElement | null>(null)
const localError = ref('')
const snapshot = ref<RewriteSnapshot | null>(null)
const result = ref<RewriteCard | null>(null)
const verdict = ref<GuardResult | null>(null)

let stopListen: (() => void) | null = null
let requestId = ''
let receivedPending = 0
let receivedTimer = 0
let selectionTimer = 0
let shiftSelect = false
let mode: 'chat' | 'rewrite' = 'chat'

const actions = [
  { id: 'rewrite', label: '润色' },
  { id: 'shorten', label: '精简' },
  { id: 'continue', label: '续写' },
] as const

const running = computed(() => store.ai.streaming)
const selectionCount = computed(() => (snapshot.value === null ? 0 : countChars(snapshot.value.target)))
const selectionPreview = computed(() => {
  const text = snapshot.value?.target.replace(/\s+/g, ' ').trim() ?? ''
  return text.length > 96 ? `${text.slice(0, 96)}…` : text
})

function onKeyDown(event: KeyboardEvent): void {
  if (event.shiftKey && event.key.startsWith('Arrow')) shiftSelect = true
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.clearTimeout(selectionTimer)
  detach()
  flushReceived()
})

watch(
  () => [store.editor.selection.from, store.editor.selection.to] as const,
  ([from, to]) => {
    window.clearTimeout(selectionTimer)
    if (running.value || result.value !== null) return
    if (from === to) {
      snapshot.value = null
      return
    }
    const delay = shiftSelect ? 0 : 220
    shiftSelect = false
    selectionTimer = window.setTimeout(() => {
      const handle = editorHandleRef?.value
      if (handle === null || handle === undefined) return
      const next = captureSelection(handle.getDoc(), from, to)
      if (next === null) return
      snapshot.value = next
      store.ai.requestAutoOpen()
    }, delay)
  },
)

function currentSnapshot(): RewriteSnapshot | null {
  if (snapshot.value !== null) return snapshot.value
  const handle = editorHandleRef?.value
  if (handle === null || handle === undefined) return null
  const range = handle.getSelection()
  return captureSelection(handle.getDoc(), range.from, range.to)
}

function run(action: string, label: string, instruction = ''): void {
  const next = currentSnapshot()
  if (next === null) {
    localError.value = '先在正文里选中一段。'
    return
  }
  snapshot.value = next
  localError.value = ''
  store.ai.clearError()
  store.ai.show()
  result.value = {
    action,
    label,
    instruction,
    raw: '',
    snapshot: next,
    done: false,
  }
  verdict.value = null
  mode = 'rewrite'
  void stream()
}

function retry(): void {
  const card = result.value
  if (card === null || running.value) return
  run(card.action, card.label, card.instruction)
}

function discard(): void {
  result.value = null
  verdict.value = null
  localError.value = ''
}

function accept(): void {
  const card = result.value
  const handle = editorHandleRef?.value
  if (card === null || !card.done || handle === null || handle === undefined) return
  const checked = prepareReplacement(card.snapshot, card.raw, handle.getDoc())
  verdict.value = checked
  if (!checked.ok) return
  handle.replaceRange(card.snapshot.from, card.snapshot.to, checked.text, 'ai')
  result.value = null
  verdict.value = null
  snapshot.value = null
  handle.focus()
}

async function send(): Promise<void> {
  const text = draft.value.trim()
  if (text === '' || running.value) return
  const selected = currentSnapshot()
  if (selected !== null) {
    draft.value = ''
    run('custom', '按要求改写', text)
    return
  }
  if (!isTauriRuntime()) {
    localError.value = '对话需要在安装版里使用。'
    return
  }
  localError.value = ''
  store.ai.clearError()
  messages.value = [...messages.value, { role: 'user', content: text }, { role: 'assistant', content: '' }]
  draft.value = ''
  mode = 'chat'
  await stream()
}

async function stream(): Promise<void> {
  if (!isTauriRuntime()) {
    localError.value = '改写和对话需要在安装版里使用。'
    if (result.value !== null && mode === 'rewrite') {
      result.value = { ...result.value, done: true }
    }
    return
  }
  store.ai.startStream(mode === 'rewrite' ? 'rewrite' : null)
  requestId = crypto.randomUUID()
  await scrollDown()
  await attach(requestId)
  let failed = false
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const card = result.value
    await invoke(CMD.aiChat, {
      requestId,
      messages: mode === 'chat' ? wireMessages() : [],
      rewrite:
        mode === 'rewrite' && card !== null
          ? {
              action: card.action,
              target: card.snapshot.target,
              context: card.snapshot.context,
              instruction: card.instruction,
            }
          : null,
    })
  } catch (error: unknown) {
    const raw = error instanceof Error ? error.message : String(error)
    fail(raw)
    failed = true
  } finally {
    flushReceived()
    if (result.value !== null && mode === 'rewrite') {
      result.value = { ...result.value, done: true }
      const handle = editorHandleRef?.value
      verdict.value =
        failed || handle === null || handle === undefined
          ? null
          : prepareReplacement(result.value.snapshot, result.value.raw, handle.getDoc())
    }
    store.ai.endStream()
    detach()
    await scrollDown()
  }
}

function wireMessages(): { role: string; content: string }[] {
  return messages.value
    .filter((message) => message.content.trim() !== '')
    .map((message) => ({ role: message.role, content: message.content }))
}

async function attach(id: string): Promise<void> {
  detach()
  const { listen } = await import('@tauri-apps/api/event')
  const unDelta = await listen<{ requestId: string; text: string }>(EVENT.aiDelta, (event) => {
    if (event.payload.requestId !== id) return
    append(event.payload.text)
  })
  const unDone = await listen<{ requestId: string }>(EVENT.aiDone, (event) => {
    if (event.payload.requestId !== id) return
    flushReceived()
  })
  stopListen = () => {
    unDelta()
    unDone()
  }
}

function detach(): void {
  stopListen?.()
  stopListen = null
}

function append(text: string): void {
  if (mode === 'rewrite') {
    const card = result.value
    if (card === null) return
    result.value = { ...card, raw: card.raw + text }
  } else {
    const next = messages.value.slice()
    const last = next[next.length - 1]
    if (last === undefined || last.role !== 'assistant') return
    next[next.length - 1] = { role: 'assistant', content: last.content + text }
    messages.value = next
  }
  receivedPending += text.length
  if (receivedTimer === 0) {
    receivedTimer = window.setTimeout(() => {
      flushReceived()
    }, 200)
  }
  void scrollDown()
}

function flushReceived(): void {
  if (receivedTimer !== 0) {
    window.clearTimeout(receivedTimer)
    receivedTimer = 0
  }
  if (receivedPending > 0) {
    store.ai.addReceivedChars(receivedPending)
    receivedPending = 0
  }
}

function asErrorCode(code: string): AiErrorCode {
  switch (code) {
    case 'no_key':
    case 'network':
    case 'rate_limited':
    case 'not_streaming':
    case 'too_long':
    case 'leak_detected':
    case 'cancelled':
    case 'unknown':
      return code
    default:
      return 'unknown'
  }
}

function fail(raw: string): void {
  const split = raw.indexOf('|')
  const code = asErrorCode(split === -1 ? 'unknown' : raw.slice(0, split))
  const message = split === -1 ? raw : raw.slice(split + 1)
  store.ai.setError(message || raw, code)
  if (mode === 'chat') {
    const next = messages.value.slice()
    const last = next[next.length - 1]
    if (last !== undefined && last.role === 'assistant' && last.content === '') {
      messages.value = next.slice(0, -1)
    }
  }
}

async function stop(): Promise<void> {
  if (!isTauriRuntime() || requestId === '') return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke(CMD.aiCancel, { requestId })
}

async function scrollDown(): Promise<void> {
  await nextTick()
  const list = listEl.value
  if (list !== null) list.scrollTop = list.scrollHeight
}

function onComposerKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void send()
  }
}
</script>

<template>
  <div class="ai">
    <div ref="listEl" class="ai__list">
      <section v-if="snapshot && result === null" class="card">
        <p class="card__kicker">已选 {{ selectionCount }} 字</p>
        <p class="card__quote">{{ selectionPreview }}</p>
        <div class="pills">
          <button v-for="action in actions" :key="action.id" type="button" :disabled="running" @click="run(action.id, action.label)">
            {{ action.label }}
          </button>
        </div>
      </section>

      <section v-if="result" class="card card--live">
        <header class="card__top">
          <span>{{ result.label }}</span>
          <span v-if="verdict?.ok" class="card__count">{{ verdict.before }} → {{ verdict.after }} 字</span>
          <span v-else-if="running" class="card__count">正在写</span>
        </header>
        <p v-if="result.raw !== ''" class="card__body">{{ result.raw }}</p>
        <p v-else-if="running" class="typing" aria-live="polite">
          <span /><span /><span />
          正在生成
        </p>
        <p v-if="verdict && !verdict.ok" class="card__block">{{ verdict.message }}</p>
        <div v-if="result.done" class="card__row">
          <button type="button" class="primary" :disabled="verdict === null || !verdict.ok" @click="accept">采纳</button>
          <button type="button" class="pill" :disabled="running" @click="retry">重试</button>
          <button type="button" class="text" @click="discard">丢弃</button>
        </div>
      </section>

      <div v-if="messages.length === 0 && snapshot === null && result === null" class="ai__empty">
        <p class="ai__empty-title">划选一段，再让它改这一段</p>
        <p class="ai__empty-hint">润色、精简、续写都只替换选中的文字。没有选区时，下面是自由对话，不会写入正文。</p>
      </div>

      <article v-for="(message, index) in messages" :key="index" class="bubble" :class="`is-${message.role}`">
        <p v-if="message.content !== ''" class="bubble__text">{{ message.content }}</p>
        <p v-else-if="message.role === 'assistant' && running" class="typing" aria-live="polite">
          <span /><span /><span />
          正在回复
        </p>
      </article>
    </div>

    <p v-if="localError || store.ai.error" class="ai__error">
      {{ localError || store.ai.error?.message }}
      <button v-if="store.ai.error?.code === 'no_key'" type="button" class="text" @click="emit('openSettings')">
        去设置
      </button>
    </p>

    <form class="composer" @submit.prevent="send">
      <textarea
        v-model="draft"
        rows="2"
        :placeholder="snapshot ? '给这次改写补一句要求' : '没有选区时，在这里自由对话'"
        :disabled="running"
        @keydown="onComposerKeydown"
      />
      <button v-if="running" type="button" class="primary" @click="stop">停止</button>
      <button v-else type="submit" class="primary" :disabled="draft.trim() === ''">发送</button>
    </form>
  </div>
</template>

<style scoped>
.ai {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 16px;
  gap: 12px;
  color: var(--text-primary);
}

.ai__list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ai__empty {
  margin: auto 12px;
  text-align: center;
}

.ai__empty-title {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 650;
}

.ai__empty-hint,
.ai__error {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 20px;
  background: #fff;
  color: #121217;
  box-shadow:
    0 1px 2px rgb(18 18 23 / 6%),
    0 10px 28px rgb(18 18 23 / 8%);
}

.card__kicker,
.card__count {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: #6e6f84;
}

.card__quote,
.card__body {
  margin: 0;
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
}

.card__quote {
  color: #30303f;
}

.card__top,
.card__row,
.pills {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card__top span:first-child {
  font-size: 14px;
  font-weight: 650;
}

.card__count {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.card__block {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: #b62b2b;
}

.pills {
  flex-wrap: wrap;
}

.pill,
.text,
.primary {
  font: inherit;
}

.pill,
.pills button {
  height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  background: #f6f7fa;
  color: #121217;
  font-size: 13px;
  font-weight: 600;
}

.pill:hover,
.pills button:hover:not(:disabled) {
  background: #e3f4fd;
}

.primary {
  height: 36px;
  padding: 0 16px;
  border-radius: 999px;
  background: #3cb1e6;
  color: #121217;
  font-weight: 650;
}

.text {
  height: 32px;
  padding: 0 8px;
  color: #6e6f84;
  background: transparent;
}

.bubble {
  max-width: 100%;
  padding: 10px 12px;
  border-radius: 16px;
  background: var(--bg-raised);
}

.bubble.is-user {
  align-self: flex-end;
  background: #121217;
  color: #fff;
}

.bubble__text {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.6;
  font-size: 13px;
}

.typing {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  color: #6e6f84;
  font-size: 12px;
}

.typing span {
  width: 6px;
  height: 6px;
  border-radius: 99px;
  background: #3cb1e6;
  animation: ai-dot 1s infinite ease-in-out;
}

.typing span:nth-child(2) {
  animation-delay: 0.15s;
}

.typing span:nth-child(3) {
  animation-delay: 0.3s;
}

.composer {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 8px;
  border-radius: 20px;
  background: var(--bg-base);
  border: 1px solid var(--border-subtle);
}

.composer textarea {
  flex: 1;
  resize: none;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  line-height: 1.5;
  min-height: 44px;
}

.ai__error {
  color: var(--danger, #b62b2b);
}

button:disabled {
  opacity: 0.45;
}

@keyframes ai-dot {
  0%,
  80%,
  100% {
    opacity: 0.25;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .typing span {
    animation: none;
    opacity: 0.7;
  }
}
</style>
