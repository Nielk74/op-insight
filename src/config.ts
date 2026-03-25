import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ProviderConfig } from './types.js'

const SUPPORTED_PROVIDERS = ['anthropic', 'openai'] as const
type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number]

const API_KEY_ENV: Record<SupportedProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
}

export function readOpencodeConfig(): ProviderConfig {
  const configPath = path.join(os.homedir(), '.config', 'opencode', 'config.json')

  let raw: string
  try {
    raw = fs.readFileSync(configPath, 'utf-8')
  } catch {
    throw new Error(
      `Could not read opencode config at ${configPath}. Is opencode installed?`
    )
  }

  let parsed: { model?: string }
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`opencode config at ${configPath} is not valid JSON`)
  }

  const modelString = parsed.model
  if (!modelString || !modelString.includes('/')) {
    throw new Error(
      `opencode config does not contain a valid model field (expected "provider/model-name", got: ${modelString})`
    )
  }

  const slashIndex = modelString.indexOf('/')
  const provider = modelString.slice(0, slashIndex)
  const model = modelString.slice(slashIndex + 1)

  if (!SUPPORTED_PROVIDERS.includes(provider as SupportedProvider)) {
    throw new Error(
      `Unsupported provider: ${provider}. Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}`
    )
  }

  const envVar = API_KEY_ENV[provider as SupportedProvider]
  const apiKey = process.env[envVar]
  if (!apiKey) {
    throw new Error(
      `${envVar} is not set. Please set it to use the ${provider} provider.`
    )
  }

  return { provider: provider as SupportedProvider, model, apiKey }
}
