import { describe, expect, it } from 'vitest'
import { formatTokenLine } from '../../src/core/providers'

const usage = { promptTokens: 1000, completionTokens: 500 }

describe('侧栏用量', () => {
  it('默认模型估一笔，表外模型名和 Ollama 只留 token', () => {
    expect(formatTokenLine(usage, 'openai', 'gpt-4.1')).toBe('输入 1000 · 输出 500 · 约 $0.006')
    expect(formatTokenLine(usage, 'xai', 'grok-4.7')).toBe('输入 1000 · 输出 500 · 约 $0.005')
    expect(formatTokenLine(usage, 'anthropic', 'claude-sonnet-4-5')).toBe('输入 1000 · 输出 500 · 约 $0.0105')
    expect(formatTokenLine(usage, 'openai', 'gpt-4.1-mini')).toBe('输入 1000 · 输出 500')
    expect(formatTokenLine(usage, 'ollama', 'llama3')).toBe('输入 1000 · 输出 500')
    expect(formatTokenLine(usage, 'deepseek', 'deepseek-chat')).toBe('输入 1000 · 输出 500')
  })
})
