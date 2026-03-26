import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export async function callLlm(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const prompt = `${systemPrompt}\n\n${userMessage}`

  // Write prompt to temp file — avoids Windows command-line length limits and shell escaping issues
  const tmpFile = path.join(os.tmpdir(), `op-insight-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  fs.writeFileSync(tmpFile, prompt, 'utf-8')

  // Message MUST appear before --file (opencode/yargs treats positional args after --file as file paths)
  let result
  try {
    result = spawnSync(
      'opencode',
      ['run', '--format', 'json', 'Execute:', '--file', tmpFile],
      {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
        shell: true,
      }
    )
  } finally {
    try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
  }

  if (result.error) {
    throw new Error(`Failed to run opencode: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`opencode exited with code ${result.status}: ${result.stderr}`)
  }

  // Parse NDJSON output and collect all text parts
  const lines = result.stdout.split('\n').filter((l: string) => l.trim())
  const textParts: string[] = []
  for (const line of lines) {
    try {
      const event = JSON.parse(line)
      if (event.type === 'text' && event.part?.text) {
        textParts.push(event.part.text)
      }
    } catch {
      // skip non-JSON lines
    }
  }

  return textParts.join('').trim()
}
