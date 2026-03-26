import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Session, Facet } from './types.js'
import { callLlm } from './llm.js'
import { extractJson } from './json-utils.js'

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

const FACET_SYSTEM_PROMPT = `You are analyzing a coding session transcript.
IMPORTANT: Your ENTIRE response must be a single valid JSON object. Do NOT include any text, explanation, or markdown before or after the JSON. Start your response with { and end with }.

Extract a JSON object with these fields:
- sessionId: string (copy from input)
- projectName: string (infer from file paths or context; use "Unknown" if unclear)
- summary: string (2-3 sentence description of what was done)
- toolsUsed: string[] (e.g. ["edit", "bash", "grep"])
- repeatedInstructions: string[] (instructions the user gave more than once)
- frictionPoints: string[] (corrections, misunderstandings, retries)
- codeQualityPatterns: string[] (recurring bug types or antipatterns)
- workflowPatterns: string[] (how the user prompts and iterates)`

async function summarizeChunk(chunk: string): Promise<string> {
  return callLlm(
    'Summarize this coding session excerpt in 3-5 sentences, preserving key actions, tools, and any friction points.',
    chunk
  )
}

async function callFacetLlm(sessionId: string, text: string, systemPrompt = FACET_SYSTEM_PROMPT): Promise<Facet> {
  const raw = await callLlm(systemPrompt, `sessionId: ${sessionId}\n\n${text}`)
  try {
    return extractJson<Facet>(raw)
  } catch {
    // LLM couldn't produce valid JSON — return minimal facet so pipeline continues
    process.stderr.write(`(invalid JSON, using defaults) `)
    return {
      sessionId,
      projectName: 'Unknown',
      summary: 'Could not extract facet from this session.',
      toolsUsed: [],
      repeatedInstructions: [],
      frictionPoints: [],
      codeQualityPatterns: [],
      workflowPatterns: [],
    }
  }
}

const ERROR_FACET_SYSTEM_PROMPT = `You are analyzing tool errors from a coding session.
IMPORTANT: Your ENTIRE response must be a single valid JSON object. Do NOT include any text, explanation, or markdown before or after the JSON. Start your response with { and end with }.

Extract a JSON object with these fields:
- sessionId: string (copy from input)
- projectName: string (infer from file paths or context; use "Unknown" if unclear)
- summary: string (1-2 sentences describing the errors and what triggered them)
- toolsUsed: string[] (tools that errored, e.g. ["bash", "edit"])
- repeatedInstructions: string[] (any repeated attempts to fix the same thing)
- frictionPoints: string[] (each distinct error with brief context)
- codeQualityPatterns: string[] (patterns in the mistakes, e.g. "wrong path assumptions")
- workflowPatterns: string[] (how the user/assistant responded to the errors)`

/** Extract only error events + surrounding context (much cheaper than full facet). */
export async function extractErrorFacet(session: Session): Promise<Facet> {
  // Collect messages with their index
  const messages = session.messages
  const errorSnippets: string[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const text = msg.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.content)
      .join('\n')

    // Look for error indicators in assistant messages
    if (
      msg.role === 'assistant' &&
      /error|failed|cannot|invalid|not found|exit code [^0]/i.test(text)
    ) {
      // Include 1 message before and 1 after for context
      const contextStart = Math.max(0, i - 1)
      const contextEnd = Math.min(messages.length - 1, i + 1)
      const snippet = messages
        .slice(contextStart, contextEnd + 1)
        .map((m) => {
          const t = m.parts.filter((p) => p.type === 'text').map((p) => p.content).join('\n')
          return `${m.role}: ${t.slice(0, 500)}`
        })
        .join('\n\n')
      errorSnippets.push(snippet)
    }
  }

  if (errorSnippets.length === 0) {
    return {
      sessionId: session.id,
      projectName: 'Unknown',
      summary: 'No tool errors found in this session.',
      toolsUsed: [],
      repeatedInstructions: [],
      frictionPoints: [],
      codeQualityPatterns: [],
      workflowPatterns: [],
    }
  }

  process.stderr.write(`(${errorSnippets.length} errors) `)
  const text = errorSnippets.join('\n\n---\n\n').slice(0, 15_000)
  return callFacetLlm(session.id, text, ERROR_FACET_SYSTEM_PROMPT)
}

export async function extractFacet(session: Session): Promise<Facet> {
  const cachePath = getCachePath(session.id)

  // Return cached facet if fresh
  if (fs.existsSync(cachePath)) {
    const stat = fs.statSync(cachePath)
    if (stat.mtimeMs >= session.updatedAt) {
      try {
        const facet = JSON.parse(fs.readFileSync(cachePath, 'utf-8') as string) as Facet
        process.stderr.write(`(cached) `)
        return facet
      } catch {
        // Cache corrupted, fall through to regenerate
      }
    }
  }

  const serialized = serializeSession(session).trim()

  if (serialized.length < 200) {
    return {
      sessionId: session.id,
      projectName: 'Unknown',
      summary: 'Empty session with no messages.',
      toolsUsed: [],
      repeatedInstructions: [],
      frictionPoints: [],
      codeQualityPatterns: [],
      workflowPatterns: [],
    }
  }

  let textForLlm: string
  if (serialized.length <= MAX_DIRECT_SIZE) {
    textForLlm = serialized
  } else {
    // Chunk and summarize sequentially
    const chunks: string[] = []
    for (let i = 0; i < serialized.length; i += CHUNK_SIZE) {
      chunks.push(serialized.slice(i, i + CHUNK_SIZE))
    }
    process.stderr.write(`(${chunks.length} chunks, ~${Math.round(serialized.length / 1000)}k chars) `)
    const summaries: string[] = []
    for (let i = 0; i < chunks.length; i++) {
      process.stderr.write(`chunk ${i + 1}/${chunks.length}... `)
      summaries.push(await summarizeChunk(chunks[i]))
    }
    textForLlm = summaries.join('\n\n')
  }

  const facet = await callFacetLlm(session.id, textForLlm, FACET_SYSTEM_PROMPT)

  // Write cache
  fs.mkdirSync(getCacheDir(), { recursive: true })
  fs.writeFileSync(cachePath, JSON.stringify(facet, null, 2), 'utf-8')

  return facet
}
