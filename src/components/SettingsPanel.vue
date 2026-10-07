<script setup lang="ts">
/**
 * 设置。外观沿用现有主题和皮肤；接口按厂商表配置。
 * 密钥提交后立刻清空输入框，前端只记住有没有密钥。
 */
import { computed, onMounted, ref } from 'vue'
import { CMD } from '@/ipc/commands'
import { providerById, PROVIDERS, type ProviderProtocol } from '@/core/providers'
import { useStore } from '@/store'
import { isTauriRuntime } from '@/store/appearance'
import {
  applySkin,
  clearSkin,
  exportSkin,
  fontChoices,
  importSkin,
  loadSkin,
  saveSkin,
} from '@/store/skin'
import type { SkinDraft } from '@/store/skin'
import markUrl from '../../brand/frisket-mark.svg'

const emit = defineEmits<{ close: [] }>()
const store = useStore()
const draft = ref<SkinDraft>(loadSkin())
const tab = ref<'look' | 'api'>('look')
const importText = ref('')
const importError = ref('')
const fonts = fontChoices()

const provider = ref('xai')
const protocol = ref<ProviderProtocol>('openai')
const baseUrl = ref('https://api.x.ai/v1')
const model = ref('grok-4.7')
const apiKey = ref('')
const hasKey = ref(false)
const keyStorage = ref<'keyring' | 'file' | 'none'>('none')
const apiMessage = ref('')
const apiError = ref('')
const savingApi = ref(false)
const modelChoices = ref<string[]>([])
const listingModels = ref(false)

const selected = computed(() => providerById(provider.value))
const showProtocolSwitch = computed(() => provider.value === 'custom')

onMounted(() => {
  applySkin(draft.value)
  void loadApi()
})

function commit(): void {
  saveSkin(draft.value)
}

function setHex(key: 'accent' | 'background' | 'foreground', event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  draft.value = { ...draft.value, [key]: target.value }
  commit()
}

function setRadius(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  draft.value = { ...draft.value, radius: Number(target.value) }
  commit()
}

function setBlur(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  draft.value = { ...draft.value, glassBlur: Number(target.value) }
  commit()
}

function setOpacity(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  draft.value = { ...draft.value, glassOpacity: Number(target.value) / 100 }
  commit()
}

function setFont(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  draft.value = { ...draft.value, fontFamily: target.value === '' ? null : target.value }
  commit()
}

function setTheme(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  if (target.value === 'system') {
    store.appearance.setFollowSystem(true)
    return
  }
  store.appearance.setTheme(target.value)
}

function setFontSize(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  store.editor.setPref('fontSize', Number(target.value))
}

function setDim(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  store.wallpaper.setDim(Number(target.value) / 100)
}

function reset(): void {
  draft.value = clearSkin()
  importError.value = ''
}

function download(): void {
  const blob = new Blob([exportSkin(draft.value, store.appearance.prefs.theme)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'frisket-skin.json'
  link.click()
  URL.revokeObjectURL(url)
}

function applyImport(): void {
  const parsed = importSkin(importText.value)
  if (parsed === null) {
    importError.value = '这份 JSON 读不出来'
    return
  }
  importError.value = ''
  draft.value = parsed.skin
  saveSkin(parsed.skin)
  if (parsed.theme) store.appearance.setTheme(parsed.theme)
}

function pickProvider(id: string): void {
  const option = providerById(id)
  provider.value = option.id
  protocol.value = option.protocol
  modelChoices.value = []
  if (option.id === 'custom') return
  baseUrl.value = option.baseUrl
  if (option.defaultModel !== '') model.value = option.defaultModel
}

function setProtocol(next: ProviderProtocol): void {
  protocol.value = next
}

async function loadApi(): Promise<void> {
  if (!isTauriRuntime()) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const view = await invoke<{
      baseUrl: string
      model: string
      provider: string
      protocol: string
      hasKey: boolean
      keyStorage: 'keyring' | 'file' | 'none'
    }>(CMD.settingsGet)
    baseUrl.value = view.baseUrl
    model.value = view.model
    provider.value = view.provider || 'xai'
    protocol.value = view.protocol === 'anthropic' ? 'anthropic' : 'openai'
    hasKey.value = view.hasKey
    keyStorage.value = view.keyStorage
  } catch (error: unknown) {
    apiError.value = error instanceof Error ? error.message : '读不到接口设置'
  }
}

async function saveApi(clearKey: boolean): Promise<void> {
  if (!isTauriRuntime()) {
    apiError.value = '接口要在安装版里保存'
    return
  }
  savingApi.value = true
  apiError.value = ''
  apiMessage.value = ''
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const typed = apiKey.value.trim()
    await invoke(CMD.settingsSet, {
      baseUrl: baseUrl.value,
      model: model.value,
      provider: provider.value,
      protocol: protocol.value,
      apiKey: clearKey ? '' : typed === '' ? null : typed,
    })
    apiKey.value = ''
    await loadApi()
    apiMessage.value = clearKey ? '密钥已清除' : '接口已保存'
  } catch (error: unknown) {
    apiError.value = error instanceof Error ? error.message : '保存失败'
  } finally {
    savingApi.value = false
  }
}

async function listModels(): Promise<void> {
  if (!isTauriRuntime()) {
    apiError.value = '读取模型要在安装版里进行'
    return
  }
  listingModels.value = true
  apiError.value = ''
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    modelChoices.value = await invoke<string[]>(CMD.aiListModels)
  } catch (error: unknown) {
    apiError.value = error instanceof Error ? error.message : '没有读到模型'
  } finally {
    listingModels.value = false
  }
}
</script>

<template>
  <div class="mask" @mousedown.self="emit('close')">
    <section class="sheet" role="dialog" aria-label="设置" aria-modal="true">
      <header class="sheet__head">
        <div>
          <p class="sheet__kicker"><img class="sheet__mark" :src="markUrl" alt="" />Frisket</p>
          <h2>设置</h2>
        </div>
        <button type="button" class="sheet__close" aria-label="关闭" @click="emit('close')">关闭</button>
      </header>

      <div class="tabs" role="tablist">
        <button type="button" :class="{ 'is-on': tab === 'look' }" @click="tab = 'look'">外观</button>
        <button type="button" :class="{ 'is-on': tab === 'api' }" @click="tab = 'api'">接口</button>
      </div>

      <div v-if="tab === 'look'" class="sheet__body">
        <label class="field">
          <span>基底主题</span>
          <select
            class="control"
            :value="store.appearance.followSystem ? 'system' : store.appearance.prefs.theme"
            @change="setTheme"
          >
            <option value="system">跟随系统</option>
            <option v-for="theme in store.appearance.themes" :key="theme.id" :value="theme.id">
              {{ theme.name }}
            </option>
          </select>
          <p class="hint">跟随系统时，这个设置页会跟着墨纸或石墨一起换颜色。暖米和霓虹玻璃保持你选中的样子。</p>
        </label>

        <section class="group">
          <h3>玻璃</h3>
          <label class="field">
            <span>不透明度 {{ Math.round((draft.glassOpacity ?? 0.62) * 100) }}%</span>
            <input
              type="range"
              min="35"
              max="100"
              :value="Math.round((draft.glassOpacity ?? 0.62) * 100)"
              @input="setOpacity"
            />
          </label>
          <p class="hint">越低越透。标题栏会保持够实，避免点到窗口外面。</p>
          <label class="field">
            <span>模糊 {{ draft.glassBlur ?? 20 }}px</span>
            <input type="range" min="0" max="40" :value="draft.glassBlur ?? 20" @input="setBlur" />
          </label>
          <label class="check">
            <input
              type="checkbox"
              :checked="store.appearance.prefs.forceOpaque"
              @change="store.appearance.setForceOpaque(!store.appearance.prefs.forceOpaque)"
            />
            强制不透明
          </label>
        </section>

        <section class="group">
          <h3>壁纸</h3>
          <div
            v-if="store.wallpaper.src"
            class="preview"
            :style="{ backgroundImage: `url(${store.wallpaper.src})` }"
          />
          <p v-else class="hint">没选壁纸时，毛玻璃后面是桌面。</p>
          <div class="row">
            <button type="button" class="ghost" @click="store.wallpaper.pick()">选择图片</button>
            <button type="button" class="ghost" :disabled="!store.wallpaper.path" @click="store.wallpaper.clear()">
              移除
            </button>
          </div>
          <label class="field">
            <span>压暗 {{ Math.round(store.wallpaper.dim * 100) }}%</span>
            <input
              type="range"
              min="0"
              max="65"
              :value="Math.round(store.wallpaper.dim * 100)"
              @input="setDim"
            />
          </label>
        </section>

        <section class="group">
          <h3>颜色与字体</h3>
          <div class="swatches">
            <label class="field">
              <span>强调色</span>
              <input class="color" type="color" :value="draft.accent ?? '#3CB1E6'" @input="setHex('accent', $event)" />
            </label>
            <label class="field">
              <span>纸色</span>
              <input class="color" type="color" :value="draft.background ?? '#F6F7FA'" @input="setHex('background', $event)" />
            </label>
            <label class="field">
              <span>字色</span>
              <input class="color" type="color" :value="draft.foreground ?? '#121217'" @input="setHex('foreground', $event)" />
            </label>
          </div>
          <label class="field">
            <span>圆角 {{ draft.radius ?? 12 }}px</span>
            <input type="range" min="6" max="24" :value="draft.radius ?? 12" @input="setRadius" />
          </label>
          <label class="field">
            <span>正文字号 {{ store.editor.prefs.fontSize }}px</span>
            <input type="range" min="13" max="22" :value="store.editor.prefs.fontSize" @input="setFontSize" />
          </label>
          <label class="field">
            <span>编辑字体</span>
            <select class="control" :value="draft.fontFamily ?? ''" @change="setFont">
              <option v-for="font in fonts" :key="font.label" :value="font.id">{{ font.label }}</option>
            </select>
          </label>
          <div class="row">
            <button type="button" class="ghost" @click="download">导出</button>
            <button type="button" class="ghost" @click="reset">重置外观</button>
          </div>
          <label class="field">
            <span>导入 JSON</span>
            <textarea v-model="importText" class="control area" rows="3" placeholder="把导出的 JSON 贴在这里" />
          </label>
          <p v-if="importError" class="error">{{ importError }}</p>
          <button v-if="importText.trim() !== ''" type="button" class="primary" @click="applyImport">应用导入</button>
        </section>
      </div>

      <div v-else class="sheet__body">
        <p class="lead">选一家厂商即可。请求从本机发出，密钥不会回到界面上。</p>
        <div class="vendors">
          <button
            v-for="item in PROVIDERS"
            :key="item.id"
            type="button"
            class="vendor"
            :class="{ 'is-on': provider === item.id }"
            @click="pickProvider(item.id)"
          >
            <span class="vendor__name">{{ item.name }}</span>
            <span class="vendor__hint">{{ item.hint }}</span>
          </button>
        </div>

        <div v-if="showProtocolSwitch" class="protocol" role="group" aria-label="协议">
          <button type="button" :class="{ 'is-on': protocol === 'openai' }" @click="setProtocol('openai')">
            OpenAI 兼容
          </button>
          <button type="button" :class="{ 'is-on': protocol === 'anthropic' }" @click="setProtocol('anthropic')">
            Anthropic
          </button>
        </div>

        <label class="field">
          <span>接口地址</span>
          <input v-model="baseUrl" class="control" type="url" spellcheck="false" autocomplete="off" />
        </label>
        <label class="field">
          <span>模型{{ selected.customModel && selected.id === 'doubao' ? '（接入点）' : '' }}</span>
          <input
            v-model="model"
            class="control"
            type="text"
            spellcheck="false"
            autocomplete="off"
            :placeholder="selected.id === 'doubao' ? 'ep- 开头的接入点' : '模型名'"
          />
        </label>
        <div v-if="modelChoices.length > 0" class="choices">
          <button v-for="name in modelChoices" :key="name" type="button" class="choice" @click="model = name">
            {{ name }}
          </button>
        </div>
        <button
          v-if="selected.local"
          type="button"
          class="ghost"
          :disabled="listingModels"
          @click="listModels"
        >
          {{ listingModels ? '正在读取' : '读取本机模型' }}
        </button>

        <label class="field">
          <span>API 密钥</span>
          <input
            v-model="apiKey"
            class="control"
            type="password"
            spellcheck="false"
            autocomplete="off"
            :placeholder="hasKey ? '已保存。留空则不改' : '粘贴密钥，保存后这里会清空'"
          />
        </label>
        <p class="status" :class="{ 'is-warn': keyStorage === 'file', 'is-ok': hasKey && keyStorage !== 'file' }">
          <template v-if="!hasKey">还没有密钥，对话和改写都发不出去。</template>
          <template v-else-if="keyStorage === 'file'">
            钥匙串没有接上，密钥暂存在本机文件里，权限仅本人可读。换电脑不会跟着走。
          </template>
          <template v-else>密钥在这台 Mac 的钥匙串里。界面不再显示它。</template>
        </p>
        <p v-if="apiMessage" class="ok">{{ apiMessage }}</p>
        <p v-if="apiError" class="error">{{ apiError }}</p>
        <div class="actions">
          <button type="button" class="primary" :disabled="savingApi" @click="saveApi(false)">
            {{ savingApi ? '保存中' : '保存接口' }}
          </button>
          <button type="button" class="link" :disabled="savingApi || !hasKey" @click="saveApi(true)">
            清除密钥
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  background: rgb(18 18 23 / 40%);
}

.sheet {
  width: min(680px, 100%);
  max-height: min(760px, 100%);
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 28px 28px 24px;
  border-radius: 24px;
  background: var(--bg-base);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm), var(--shadow-lg);
}

.sheet__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.sheet__kicker {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 2px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.sheet__mark {
  width: 16px;
  height: 16px;
  display: block;
}

.sheet__head h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.sheet__close,
.ghost,
.link,
.primary,
.tabs button,
.protocol button,
.vendor,
.choice {
  font: inherit;
}

.sheet__close,
.ghost,
.link {
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  color: var(--text-secondary);
  background: transparent;
}

.sheet__close:hover,
.ghost:hover,
.link:hover:not(:disabled) {
  background: var(--bg-hover);
}

.tabs,
.protocol {
  display: flex;
  gap: 0;
  width: fit-content;
  padding: 4px;
  border-radius: 999px;
  background: var(--bg-sunken);
}

.tabs button,
.protocol button {
  height: 32px;
  padding: 0 16px;
  border-radius: 999px;
  color: var(--text-muted);
  background: transparent;
}

.tabs button.is-on,
.protocol button.is-on {
  background: var(--bg-raised);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}

.sheet__body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  border-radius: 20px;
  background: var(--bg-raised);
  box-shadow: var(--shadow-sm);
}

.group h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 650;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field > span {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.control,
.area {
  height: 40px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-raised);
  color: var(--text-primary);
  user-select: text;
  -webkit-user-select: text;
}

.control:focus,
.area:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
}

.area {
  height: auto;
  padding: 10px 14px;
  resize: vertical;
}

.swatches {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.color {
  width: 100%;
  height: 40px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-raised);
}

.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.hint,
.lead,
.status,
.ok,
.error {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}

.hint,
.lead {
  color: var(--text-muted);
}

.preview {
  height: 108px;
  border-radius: 16px;
  background-size: cover;
  background-position: center;
}

.row,
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ghost {
  background: var(--bg-raised);
  border: 1px solid var(--border);
}

.vendors {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.vendor {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-height: 76px;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-raised);
  text-align: left;
  color: var(--text-primary);
}

.vendor.is-on {
  border: 2px solid var(--accent);
  padding: 11px 13px;
}

.vendor__name {
  font-size: 14px;
  font-weight: 650;
}

.vendor__hint {
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-muted);
}

.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.choice {
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--accent-muted);
  color: var(--text-primary);
  font-size: 12px;
}

.status.is-ok {
  color: var(--text-primary);
}

.status.is-warn,
.error {
  color: var(--danger);
}

.ok {
  color: var(--success);
}

.primary {
  height: 40px;
  padding: 0 22px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-weight: 650;
}

.primary:hover:not(:disabled) {
  filter: brightness(0.96);
}

.link {
  color: var(--text-muted);
}

button:disabled {
  opacity: 0.45;
}

input[type='range'] {
  accent-color: var(--accent);
}
</style>
