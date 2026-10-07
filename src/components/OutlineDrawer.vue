<script setup lang="ts">
/**
 * 当前文档的标题目录。贴在窗口最左边，盖住侧栏，不把正文挤窄。
 *
 * 三个状态：
 * - 收起：左边 8px 和中间的「目录」都能探出。热区不吃点击，底下的按钮照常点。
 * - 探出：指针在热区里停稳约 180ms 才滑入。划过去不打开。
 *   滑入的过程先不接点击，避免盖住侧栏和工具栏按钮。
 *   离开热区和面板 280ms 后再收。这时「目录」仍可点。
 * - 钉住：只有点击「目录」或「钉住」才固定。指针离开也不收。
 *   钉住后目录占左侧一列，右边可以拖，正文跟着让位。
 * 收起的瞬间如果指针还在左边，先不再探出，等指针离开左缘再进来。
 * 探出只用 transform，编辑区宽度不变。
 */
import { retainPointer } from '@/core/reliablePress'
import { EDITOR_HANDLE, useStore } from '@/store'
import {
  activeOutlineKey,
  outlineRows,
  parseOutline,
  type OutlineNode,
  type OutlineRow,
} from '@/core/outline'
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const PIN_KEY = 'slate.outlinePinned'
const WIDTH_KEY = 'slate.outlineWidth'
const PEEK_IN_MS = 180
const PEEK_OUT_MS = 280
const REST_PX = 10
const READY_FALLBACK_MS = 320
const MIN_WIDTH = 180
const MAX_WIDTH = 560

const store = useStore()
const editorHandleRef = inject(EDITOR_HANDLE, null)
const rootEl = ref<HTMLElement | null>(null)

const nodes = ref<OutlineNode[]>([])
const collapsed = ref<ReadonlySet<string>>(new Set())
const pinned = ref(readPinned())
const peeking = ref(false)
const ready = ref(false)
const pointerInside = ref(false)
const width = ref(readWidth())
const resizing = ref(false)

let openTimer = 0
let closeTimer = 0
let readyTimer = 0
let suppressPeek = false
let armX = 0
let armY = 0
let dragOriginX = 0
let dragOriginWidth = 0

const open = computed(() => pinned.value || peeking.value)
const rows = computed(() => outlineRows(nodes.value, collapsed.value))
const activeKey = computed(() =>
  activeOutlineKey(nodes.value, store.editor.selection.from, collapsed.value),
)
const headingCount = computed(() => countNodes(nodes.value))

watch(
  () =>
    [editorHandleRef?.value, store.editor.rev, store.docs.sessionKey, store.editor.stats] as const,
  () => refresh(),
  { immediate: true },
)

watch(activeKey, (key) => {
  if (!key || !open.value || pointerInside.value) return
  void nextTick(() => {
    document.getElementById(`outline-${key}`)?.scrollIntoView({ block: 'nearest' })
  })
})

function refresh(): void {
  const handle = editorHandleRef?.value
  if (!handle) {
    nodes.value = []
    return
  }
  const next = parseOutline(handle.getDoc())
  const live = new Set<string>()
  collectKeys(next, live)
  const kept = new Set<string>()
  for (const key of collapsed.value) {
    if (live.has(key)) kept.add(key)
  }
  collapsed.value = kept
  nodes.value = next
}

function cancelPeekTimer(): void {
  window.clearTimeout(openTimer)
  openTimer = 0
}

function cancelClose(): void {
  window.clearTimeout(closeTimer)
  closeTimer = 0
}

function scheduleClose(): void {
  if (pinned.value || closeTimer !== 0) return
  closeTimer = window.setTimeout(() => {
    closeTimer = 0
    peeking.value = false
  }, PEEK_OUT_MS)
}

function armPeek(x: number, y: number): void {
  if (pinned.value || suppressPeek) return
  cancelClose()
  if (peeking.value) return
  if (openTimer !== 0 && Math.hypot(x - armX, y - armY) < REST_PX) return
  cancelPeekTimer()
  armX = x
  armY = y
  openTimer = window.setTimeout(() => {
    openTimer = 0
    if (pinned.value || suppressPeek) return
    peeking.value = true
  }, PEEK_IN_MS)
}

function pin(): void {
  cancelPeekTimer()
  cancelClose()
  suppressPeek = false
  peeking.value = false
  pinned.value = true
  writePinned(true)
}

function collapse(): void {
  cancelPeekTimer()
  cancelClose()
  pinned.value = false
  peeking.value = false
  suppressPeek = true
  writePinned(false)
}

function onEdgeEnter(event: MouseEvent): void {
  armPeek(event.clientX, event.clientY)
}

function onPanelEnter(): void {
  pointerInside.value = true
  if (pinned.value || suppressPeek) return
  cancelClose()
  cancelPeekTimer()
  peeking.value = true
}

function insidePeekZone(x: number, y: number): boolean {
  const root = rootEl.value
  if (!root) return false
  const rect = root.getBoundingClientRect()
  return x >= rect.left && x <= rect.left + width.value && y >= rect.top && y <= rect.bottom
}

function onRegionLeave(event: MouseEvent): void {
  if (resizing.value) return
  if (peeking.value && insidePeekZone(event.clientX, event.clientY)) return
  pointerInside.value = false
  cancelPeekTimer()
  if (event.clientX > 36) suppressPeek = false
  if (pinned.value) return
  scheduleClose()
}

function eventElement(event: Event): Element | null {
  const target = event.target
  if (target instanceof Element) return target
  if (target instanceof Node) return target.parentElement
  return null
}

function overLaunch(event: Event): boolean {
  return Boolean(eventElement(event)?.closest('.outline__launch'))
}

function inLeftStripAt(x: number, y: number): boolean {
  const root = rootEl.value
  if (!root) return false
  const rect = root.getBoundingClientRect()
  return x >= rect.left && x <= rect.left + 8 && y >= rect.top && y <= rect.bottom
}

function inLeftStrip(event: PointerEvent): boolean {
  return inLeftStripAt(event.clientX, event.clientY)
}

function onPointerMove(event: PointerEvent): void {
  if (resizing.value) return
  if (suppressPeek && event.clientX > 36) suppressPeek = false
  if (pinned.value || suppressPeek) return
  if (peeking.value) {
    if (insidePeekZone(event.clientX, event.clientY)) {
      pointerInside.value = true
      cancelClose()
      return
    }
    pointerInside.value = false
    scheduleClose()
    return
  }
  if (overLaunch(event) || inLeftStrip(event)) {
    armPeek(event.clientX, event.clientY)
    return
  }
  if (!peeking.value) cancelPeekTimer()
}

function onPanelTransitionEnd(event: TransitionEvent): void {
  if (event.target !== event.currentTarget || event.propertyName !== 'transform') return
  if (open.value) ready.value = true
}

function onPointerDown(event: PointerEvent): void {
  if (pinned.value || peeking.value || overLaunch(event)) return
  cancelPeekTimer()
}

function toggleBranch(key: string): void {
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsed.value = next
}

function jump(row: OutlineRow): void {
  const handle = editorHandleRef?.value
  if (!handle) return
  handle.setSelection({ from: row.from, to: row.from })
  handle.scrollToLine(row.line)
  handle.focus()
}

function indent(depth: number): string {
  return `${8 + depth * 14}px`
}

function onResizeStart(event: PointerEvent): void {
  if (!open.value) return
  event.preventDefault()
  event.stopPropagation()
  resizing.value = true
  dragOriginX = event.clientX
  dragOriginWidth = width.value
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd)
  window.addEventListener('pointercancel', onResizeEnd)
}

function onResizeMove(event: PointerEvent): void {
  if (!resizing.value) return
  width.value = clampWidth(dragOriginWidth + (event.clientX - dragOriginX))
}

function onResizeEnd(): void {
  if (!resizing.value) return
  resizing.value = false
  writeWidth(width.value)
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
  window.removeEventListener('pointercancel', onResizeEnd)
}

function clampWidth(value: number): number {
  const cap = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.46)))
  if (!Number.isFinite(value)) return MIN_WIDTH
  return Math.min(cap, Math.max(MIN_WIDTH, Math.round(value)))
}

function readWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY)
    if (raw === null || raw === '') return 232
    return clampWidth(Number(raw))
  } catch {
    return 232
  }
}

function writeWidth(value: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(value))
  } catch {
    // 记不住宽度时，这一次拖动仍然留在界面上。
  }
}

function readPinned(): boolean {
  try {
    return localStorage.getItem(PIN_KEY) === '1'
  } catch {
    return false
  }
}

function writePinned(value: boolean): void {
  try {
    localStorage.setItem(PIN_KEY, value ? '1' : '0')
  } catch {
    // 记不住时，这一次展开仍然留在界面上。
  }
}

function collectKeys(list: readonly OutlineNode[], into: Set<string>): void {
  for (const node of list) {
    into.add(node.key)
    collectKeys(node.children, into)
  }
}

function countNodes(list: readonly OutlineNode[]): number {
  let count = 0
  for (const node of list) count += 1 + countNodes(node.children)
  return count
}

watch(
  pinned,
  (value) => {
    document.documentElement.dataset.outlineDock = value ? '1' : '0'
  },
  { immediate: true },
)

watch(open, (value) => {
  window.clearTimeout(readyTimer)
  ready.value = false
  if (!value || pinned.value) return
  readyTimer = window.setTimeout(() => {
    if (open.value) ready.value = true
  }, READY_FALLBACK_MS)
})

window.addEventListener('pointermove', onPointerMove)
window.addEventListener('pointerdown', onPointerDown, true)
onBeforeUnmount(() => {
  cancelPeekTimer()
  cancelClose()
  window.clearTimeout(readyTimer)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
  window.removeEventListener('pointercancel', onResizeEnd)
  delete document.documentElement.dataset.outlineDock
})
</script>

<template>
  <div
    ref="rootEl"
    class="outline"
    :class="{ 'is-open': open, 'is-pinned': pinned, 'is-ready': ready, 'is-resizing': resizing }"
    :style="{ '--outline-width': `${width}px` }"
    @mouseleave="onRegionLeave"
  >
    <div class="outline__edge" />
    <button
      class="outline__launch"
      type="button"
      title="移入查看，点击固定"
      :aria-expanded="open"
      :aria-hidden="pinned ? 'true' : undefined"
      :tabindex="pinned ? -1 : 0"
      @mouseenter="onEdgeEnter"
      @click="pin"
    >
      目录
    </button>
    <aside
      class="outline__panel"
      aria-label="目录"
      :inert="open ? undefined : true"
      @mouseenter="onPanelEnter"
      @mousemove="onPanelEnter"
      @mousedown="retainPointer"
      @transitionend="onPanelTransitionEnd"
    >
      <header class="outline__head">
        <h2>目录</h2>
        <span v-if="headingCount > 0">{{ headingCount }}</span>
        <button type="button" :title="pinned ? '收起目录' : '钉住目录'" @click="pinned ? collapse() : pin()">
          {{ pinned ? '收起' : '钉住' }}
        </button>
      </header>
      <p v-if="rows.length === 0" class="outline__empty">这篇还没有标题。用 # 写出层级。</p>
      <ul v-else class="outline__list" role="tree">
        <li v-for="row in rows" :key="row.key" role="none">
          <div
            :id="`outline-${row.key}`"
            class="outline__row"
            role="treeitem"
            :class="{ 'is-active': row.key === activeKey }"
            :aria-expanded="row.hasChildren ? row.open : undefined"
            :aria-level="row.depth + 1"
            :style="{ paddingLeft: indent(row.depth) }"
          >
            <button
              v-if="row.hasChildren"
              type="button"
              class="outline__chevron"
              :class="{ 'is-open': row.open }"
              :aria-label="row.open ? '折叠' : '展开'"
              @click.stop="toggleBranch(row.key)"
            >
              ›
            </button>
            <span v-else class="outline__chevron" aria-hidden="true" />
            <button type="button" class="outline__jump" :title="row.text" @click="jump(row)">
              <span class="truncate">{{ row.text }}</span>
            </button>
          </div>
        </li>
      </ul>
      <div
        v-if="open"
        class="outline__resize"
        title="拖动调整目录宽度"
        @pointerdown="onResizeStart"
      />
    </aside>
  </div>
</template>
