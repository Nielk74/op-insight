import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Session, Facet } from './types.js'
import { callLlm } from './llm.js'

export const CHUNK_SIZE = 25_000
const MAX_DIRECT_SIZE = 30_000

function getCacheDir(): string {
  const dataDir = process.env.OPENCODE_DATA_DIR
    ?? path.join(os.homedir(), '.local', 'share', 'opencode')
  return path.join(dataDir, 'insights-cache')
}

function getCachePath(sessionId: string): string {
  return path.join(getCacheDir(), `${sessionId}.json`)
}

export function serializeSession(session: Session): string {
  return session.messages
    .map((m) => {
      const text = m.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.content)
        .join('\n')
      return `${m.role}: ${text}`
    })
    .join('\n\n')
}

const FACET_SYSTEM_PROMPT = `You are analyzing a coding session transcript. Extract a structured JSON facet with these fields:
- sessionId: string (copy from input)
- projectName: string (infer from file paths or context; use "Unknown" if unclear)
- summary: string (2-3 sentence description of what was done)
- toolsUsed: string[] (e.g. ["edit", "bash", "grep"])
- repeatedInstructions: string[] (instructions the user gave more than once)
- frictionPoints: string[] (corrections, misunderstandings, retries)
- codeQualityPatterns: string[] (recurring bug types or antipatterns)
- workflowPatterns: string[] (how the user prompts and iterates)

Return ONLY valid JSON, no markdown fences.`

async function summarizeChunk(chunk: string): Promise<string> {
  return callLlm(
    'Summarize this coding session excerpt in 3-5 sentences, preserving key actions, tools, and any friction points.',
    chunk
  )
}

async function callFacetLlm(sessionId: string, text: string): Promise<Facet> {
  const raw = await callLlm(FACET_SYSTEM_PROMPT, `sessionId: ${sessionId}\n\n${text}`)
  try {
    return JSON.parse(raw) as Facet
  } catch (e) {
    throw new Error(`LLM returned invalid JSON for session ${sessionId}: ${e}`)
  }
}

export async function extractFacet(session: Session): Promise<Facet> {
  const cachePath = getCachePath(session.id)

  // Return cached facet if fresh
  if (fs.existsSync(cachePath)) {
    const stat = fs.statSync(cachePath)
    if (stat.mtimeMs >= session.updatedAt) {
      try {
        return JSON.parse(fs.readFileSync(cachePath, 'utf-8') as string) as Facet
      } catch {
        // Cache corrupted, fall through to regenerate
      }
    }
  }

  const serialized = serializeSession(session)

  let textForLlm: string
  if (serialized.length <= MAX_DIRECT_SIZE) {
    textForLlm = serialized
  } else {
    // Chunk and summarize
    const chunks: string[] = []
    for (let i = 0; i < serialized.length; i += CHUNK_SIZE) {
      chunks.push(serialized.slice(i, i + CHUNK_SIZE))
    }
    const summaries = await Promise.all(chunks.map((c) => summarizeChunk(c)))
    textForLlm = summaries.join('\n\n')
  }

  const facet = await callFacetLlm(session.id, textForLlm)

  // Write cache
  fs.mkdirSync(getCacheDir(), { recursive: true })
  fs.writeFileSync(cachePath, JSON.stringify(facet, null, 2), 'utf-8')

  return facet
}
