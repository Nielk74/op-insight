import type { ProviderConfig } from './types.js'

export async function callLlm(
  config: ProviderConfig,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  if (config.provider === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: config.apiKey })
    const response = await client.messages.create({
      model: config.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })
    const block = response.content[0]
    if (block.type !== 'text') throw new Error('Unexpected response type from Anthropic')
    return block.text
  }

  if (config.provider === 'openai') {
    const { default: OpenAI } = await import('openai')
    const client = new OpenAI({ apiKey: config.apiKey })
    const response = await client.chat.completions.create({
      model: config.model,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    })
    const content = response.choices[0]?.message?.content
    if (!content) throw new Error('Empty response from OpenAI')
    return content
  }

  throw new Error(`Unsupported provider: ${config.provider}`)
}
