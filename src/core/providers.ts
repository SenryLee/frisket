/**
 * 厂商表。协议只有两种：OpenAI 兼容，和 Anthropic Messages。
 * 新增厂商改这里的一行，不新增类。
 */
import type { TokenUsage } from '@/core/interfaces'

export type ProviderProtocol = 'openai' | 'anthropic'

export interface ProviderOption {
  id: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  defaultModel: string
  /** 豆包等必须手填模型或接入点 */
  customModel: boolean
  local: boolean
  hint: string
}

export const PROVIDERS: readonly ProviderOption[] = [
  {
    id: 'xai',
    name: 'xAI',
    protocol: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4.7',
    customModel: true,
    local: false,
    hint: '默认。密钥用 XAI_API_KEY，请求走 api.x.ai。',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1',
    customModel: true,
    local: false,
    hint: '官方兼容接口。',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    customModel: true,
    local: false,
    hint: 'OpenAI 兼容。',
  },
  {
    id: 'doubao',
    name: '豆包',
    protocol: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: '',
    customModel: true,
    local: false,
    hint: '模型名是接入点，一般以 ep- 开头。',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-auto',
    customModel: true,
    local: false,
    hint: 'OpenAI 兼容。',
  },
  {
    id: 'qwen',
    name: '通义千问',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    customModel: true,
    local: false,
    hint: '兼容模式端点。',
  },
  {
    id: 'glm',
    name: '智谱 GLM',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    customModel: true,
    local: false,
    hint: 'OpenAI 兼容。',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    protocol: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    customModel: true,
    local: false,
    hint: '走官方 OpenAI 兼容端点，不单独适配。',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: '',
    customModel: true,
    local: true,
    hint: '本机运行，无云端费用。可读取已安装模型。',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5',
    customModel: true,
    local: false,
    hint: 'Messages API，和上面几家不是同一条协议。',
  },
  {
    id: 'custom',
    name: '自定义',
    protocol: 'openai',
    baseUrl: 'https://',
    defaultModel: '',
    customModel: true,
    local: false,
    hint: 'OpenRouter、SiliconFlow 或私有网关。',
  },
]

export function providerById(id: string): ProviderOption {
  return PROVIDERS.find((item) => item.id === id) ?? PROVIDERS[0]!
}

/**
 * 每百万 token 的美元标价，只覆盖对得上官方价目的默认模型。
 * 短上下文、不计算缓存。对不上的厂商只显示 token。
 * grok-4.7：$2 / $6（xAI，200k 以下）。gpt-4.1：$2 / $8。
 * gemini-2.0-flash 文本：$0.15 / $0.60。claude-sonnet-4-5：$3 / $15。
 */
const DEFAULT_MODEL_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  xai: { input: 2, output: 6 },
  openai: { input: 2, output: 8 },
  gemini: { input: 0.15, output: 0.6 },
  anthropic: { input: 3, output: 15 },
}

/** 当前模型正好是该厂商表里的默认模型时，估一笔美元。Ollama 和对不上的名字返回 null。 */
export function estimateUsd(providerId: string, model: string, usage: TokenUsage): number | null {
  const provider = PROVIDERS.find((item) => item.id === providerId)
  if (provider === undefined || provider.local) return null
  if (provider.defaultModel === '' || model !== provider.defaultModel) return null
  const price = DEFAULT_MODEL_USD_PER_MILLION[provider.id]
  if (price === undefined) return null
  return (usage.promptTokens * price.input + usage.completionTokens * price.output) / 1_000_000
}

/** 侧栏底部一行。没有金额时只留 token。 */
export function formatTokenLine(usage: TokenUsage, providerId: string | null, model: string | null): string {
  const tokens = `输入 ${usage.promptTokens} · 输出 ${usage.completionTokens}`
  if (providerId === null || model === null) return tokens
  const usd = estimateUsd(providerId, model, usage)
  if (usd === null) return tokens
  return `${tokens} · 约 ${formatUsd(usd)}`
}

function formatUsd(amount: number): string {
  if (!(amount > 0)) return '$0'
  if (amount < 0.000001) return '< $0.000001'
  const digits = amount >= 1 ? 2 : amount >= 0.01 ? 4 : 6
  const fixed = amount.toFixed(digits)
  const text = amount >= 1 ? fixed : fixed.replace(/0+$/, '').replace(/\.$/, '')
  return `$${text}`
}
