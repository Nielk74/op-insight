// src/synthesize.ts
// Uses the opencode client to run two focused LLM calls:
//   1. Summarizer — one sentence per session describing goal + outcome
//   2. Aggregator — synthesizes all summaries into workingWell/hindering/quickWins
import type { PluginInput } from '@opencode-ai/plugin'
import type { ExtendedSessionFacet } from './types.js'

function extractText(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter(p => p.type === 'text' && p.text)
    .map(p => p.text!)
    .join('\n')
    .trim()
}

function parseJSON<T>(text: string, fallback: T): T {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    return fallback
  }
}

async function llmCall(
  client: PluginInput['client'],
  sessionId: string,
  prompt: string
): Promise<string> {
  const res = await client.session.prompt({
    path: { id: sessionId },
    body: { parts: [{ type: 'text', text: prompt }] },
  })
  if (!res.data) throw new Error('No response from LLM')
  return extractText(res.data.parts as Array<{ type: string; text?: string }>)
}

export async function synthesizeAtAGlance(
  client: PluginInput['client'],
  facets: ExtendedSessionFacet[],
  days: number,
  directory: string,
): Promise<{ workingWell: string; hindering: string; quickWins: string }> {
  const fallback = { workingWell: '', hindering: '', quickWins: '' }
  if (facets.length === 0) return fallback

  // Create a temporary session for the LLM calls
  const sessRes = await client.session.create({ query: { directory } })
  if (!sessRes.data) return fallback
  const sessionId = sessRes.data.id

  try {
    // ── Step 1: Summarizer ──────────────────────────────────────────
    const sessionLines = facets.slice(0, 60).map((f, i) =>
      `[${i + 1}] ${f.date} | turns:${f.turnDepth} | waste:${f.wasteScore}/10 | tools:${f.toolsUsed.slice(0, 5).join(',')} | files:${f.filesTouched.length} | errors:${f.errorSnippets.length} | "${f.firstUserMessage.slice(0, 120)}"`
    ).join('\n')

    const summarizerPrompt =
      `You are analyzing opencode AI coding sessions. For each session below, write ONE sentence describing what the user was trying to accomplish and whether it succeeded or hit friction. Be concrete — mention the tools used and what went wrong if anything.\n\nSessions:\n${sessionLines}\n\nRespond with a JSON array of strings (one per session, same order). No other text.`

    const summariesText = await llmCall(client, sessionId, summarizerPrompt)
    const summaries: string[] = parseJSON(summariesText, [])

    // ── Step 2: Aggregator ──────────────────────────────────────────
    const summaryLines = (summaries.length > 0 ? summaries : facets.map(f => f.firstUserMessage.slice(0, 80)))
      .map((s, i) => `[${i + 1}] ${s}`)
      .join('\n')

    const aggregatorPrompt =
      `You are a coding workflow analyst. Based on ${facets.length} opencode sessions over the last ${days} days:\n\n${summaryLines}\n\nProduce a JSON object with exactly these three fields:\n- "workingWell": 2-3 sentences on patterns that are working well for this user.\n- "hindering": 2-3 sentences on what is blocking or slowing them down.\n- "quickWins": 2-3 sentences of specific, actionable improvements. Always mention: (1) adding project-specific instructions to opencode.json using the "instructions" field (e.g. \`{"instructions": ["CONTRIBUTING.md", "docs/guidelines.md", ".cursor/rules/*.md"]}\`) so the AI has context about the project, and (2) keeping an AGENTS.md or CLAUDE.md at the repo root with coding guidelines.\n\nRespond with ONLY the JSON object. No markdown, no explanation.`

    const glanceText = await llmCall(client, sessionId, aggregatorPrompt)
    const glance = parseJSON<{ workingWell?: string; hindering?: string; quickWins?: string }>(glanceText, {})

    return {
      workingWell: glance.workingWell ?? '',
      hindering:   glance.hindering   ?? '',
      quickWins:   glance.quickWins   ?? '',
    }
  } finally {
    // Clean up the temp session
    await client.session.delete({ path: { id: sessionId } }).catch(() => {})
  }
}
