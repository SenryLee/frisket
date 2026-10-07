/**
 * 厂商表。协议只有两种：OpenAI 兼容，和 Anthropic Messages。
 * 新增厂商改这里的一行，不新增类。
 */
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
