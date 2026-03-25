import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readOpencodeConfig } from '../src/config.js'
import * as fs from 'node:fs'

vi.mock('node:fs')

describe('readOpencodeConfig', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
  })

  it('parses anthropic model and resolves API key from env', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ model: 'anthropic/claude-haiku-4-5' })
    )
    process.env.ANTHROPIC_API_KEY = 'test-key'

    const config = readOpencodeConfig()

    expect(config).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      apiKey: 'test-key',
    })
  })

  it('parses openai model and resolves API key from env', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ model: 'openai/gpt-4o' })
    )
    process.env.OPENAI_API_KEY = 'sk-test'

    const config = readOpencodeConfig()

    expect(config).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-test',
    })
  })

  it('throws if config file not found', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    expect(() => readOpencodeConfig()).toThrow(
      'Could not read opencode config'
    )
  })

  it('throws if provider is unsupported', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ model: 'ollama/llama3' })
    )

    expect(() => readOpencodeConfig()).toThrow(
      'Unsupported provider: ollama'
    )
  })

  it('throws if API key env var is not set', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ model: 'anthropic/claude-haiku-4-5' })
    )

    expect(() => readOpencodeConfig()).toThrow(
      'ANTHROPIC_API_KEY is not set'
    )
  })
})
