import { spawnSync } from 'node:child_process'

export async function callLlm(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const prompt = `${systemPrompt}\n\n${userMessage}`

  const result = spawnSync('opencode', ['run', '--print', prompt], {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  })

  if (result.error) {
    throw new Error(`Failed to run opencode: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`opencode exited with code ${result.status}: ${result.stderr}`)
  }

  return result.stdout.trim()
}
