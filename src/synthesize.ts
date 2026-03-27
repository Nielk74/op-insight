// src/synthesize.ts
// Two-agent synthesis pipeline using the opencode client:
//   1. Summarizer  — one goal-oriented sentence per session
//   2. Aggregator  — produces the full rich summary (atAGlance + all sections)
import { readFileSync, existsSync } from 'fs'
import { join, resolve, dirname } from 'path'
import type { PluginInput } from '@opencode-ai/plugin'
import type { ExtendedSessionFacet, InsightReport } from './types.js'

interface OpencodeJson {
  instructions?: string[]
  system?: string
  [key: string]: unknown
}

/**
 * Read the user's opencode.json and any markdown files listed in its
 * `instructions` field. Returns a context block to inject into the aggregator
 * prompt so advice accounts for what's already configured.
 */
function readUserConfig(directory: string): string {
  const configPath = join(directory, 'opencode.json')
  if (!existsSync(configPath)) return ''

  let config: OpencodeJson
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8')) as OpencodeJson
  } catch {
    return ''
  }

  const parts: string[] = []

  // Include the raw opencode.json (minus any large fields)
  const configSummary = JSON.stringify(config, null, 2)
  parts.push(`### opencode.json\n\`\`\`json\n${configSummary}\n\`\`\``)

  // Read each file listed in `instructions`
  const instructionFiles = config.instructions ?? []
  for (const relPath of instructionFiles) {
    // Paths in opencode.json are relative to the config file's directory
    const absPath = resolve(dirname(configPath), relPath)
    if (!existsSync(absPath)) continue
    try {
      const content = readFileSync(absPath, 'utf-8').slice(0, 3000) // cap per file
      parts.push(`### ${relPath}\n${content}`)
    } catch {
      // skip unreadable files
    }
  }

  if (parts.length === 0) return ''
  return `\n\n## User's existing opencode configuration\nThe user already has the following configuration in place. Your advice in featuresToTry and quickWins MUST acknowledge what is already set up — do not recommend things already configured. Instead, focus on gaps, improvements, and extensions.\n\n${parts.join('\n\n')}`
}

function extractText(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter(p => p.type === 'text' && p.text)
    .map(p => p.text!)
    .join('\n')
    .trim()
}

function parseJSON<T>(text: string, fallback: T): T {
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    console.warn('[insights] JSON parse failed, using fallback. Raw:', text.slice(0, 200))
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

type SynthesisResult = Pick<InsightReport,
  'atAGlance' | 'behavioralProfile' | 'impressiveThings' | 'whereThingsGoWrong' | 'featuresToTry'
>

export async function synthesizeSummary(
  client: PluginInput['client'],
  facets: ExtendedSessionFacet[],
  days: number,
  directory: string,
): Promise<SynthesisResult | null> {
  if (facets.length === 0) return null

  const sessRes = await client.session.create({ query: { directory } })
  if (!sessRes.data) return null
  const sessionId = sessRes.data.id

  try {
    // ── Step 1: Summarizer ───────────────────────────────────────────────
    const sessionLines = facets.slice(0, 60).map((f, i) => {
      const tools = f.toolsUsed.slice(0, 6).join(',')
      const err = f.errorSnippets[0]?.slice(0, 80) ?? 'none'
      return `[${i + 1}] ${f.date} | turns:${f.turnDepth} | waste:${f.wasteScore}/10 | tools:${tools} | files:${f.filesTouched.length} | first_error:"${err}" | goal:"${f.firstUserMessage.slice(0, 120)}"`
    }).join('\n')

    const summarizerPrompt = `You are analyzing opencode AI coding sessions. For each session, write ONE sentence: what the user tried to accomplish and whether it succeeded or hit friction. Be concrete — name tools and errors.

Sessions:
${sessionLines}

Respond with a JSON array of strings, one per session, same order. No other text.`

    const summariesText = await llmCall(client, sessionId, summarizerPrompt)
    const summaries: string[] = parseJSON(summariesText, facets.map(f => f.firstUserMessage.slice(0, 100)))

    // ── Step 2: Aggregator ───────────────────────────────────────────────
    // Compute stats to give the aggregator concrete numbers
    const topTools = (() => {
      const counts: Record<string, number> = {}
      facets.forEach(f => f.toolsUsed.forEach(t => { counts[t] = (counts[t] ?? 0) + 1 }))
      return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([t, n]) => `${t}(${n})`).join(', ')
    })()
    const errorSessions = facets.filter(f => f.errorSnippets.length > 0).length
    const wastySessions = facets.filter(f => f.wasteScore >= 3).length
    const avgTurns = (facets.reduce((s, f) => s + f.turnDepth, 0) / facets.length).toFixed(1)

    const summaryLines = summaries.map((s, i) => `[${i + 1}] ${s}`).join('\n')

    const userConfigContext = readUserConfig(directory)

    const aggregatorPrompt = `You are an expert coding workflow analyst producing a rich personal insights report for an opencode user.

Stats: ${facets.length} sessions over ${days} days | avg turns/session: ${avgTurns} | sessions with errors: ${errorSessions} | sessions with high waste: ${wastySessions} | top tools: ${topTools}${userConfigContext}

Session summaries:
${summaryLines}

Produce a JSON object with EXACTLY these fields. Be specific — cite real patterns, tool names, error types from the data. Write in second person ("You..."). Keep each paragraph to 2-4 sentences.

CRITICAL for featuresToTry: the "pasteInto" fields must contain REAL, FILLED-IN content derived from the session data — not placeholder text in angle brackets. Replace every <...> with actual content. For the AGENTS.md card, write the actual AGENTS.md file content based on what you inferred about the user's projects, platform, and recurring issues. For the opencode.json card, write the actual "system" instruction text that would address the top friction patterns observed. The third card should be a concrete, specific suggestion (a prompt template, a workflow step, a config snippet) tailored to this user's actual patterns.

{
  "atAGlance": {
    "workingWell": "Narrative paragraph. What patterns are consistently working well. Mention specific tools or workflows observed.",
    "hindering": "Narrative paragraph. What is blocking or slowing the user. Name specific friction patterns with examples.",
    "quickWins": "Narrative paragraph. 2-3 specific actionable improvements. ALWAYS mention: (1) adding an AGENTS.md or CLAUDE.md at the repo root with project context and coding guidelines so the AI has consistent context, and (2) using the opencode.json \\"instructions\\" field to load project-specific files (e.g. {  \\"instructions\\": [\\"CONTRIBUTING.md\\", \\"docs/guidelines.md\\", \\".cursor/rules/*.md\\"] })."
  },
  "behavioralProfile": "3-4 sentence paragraph describing how this user works: their style, ambition level, iteration speed, how they use AI as a tool. Be insightful and specific.",
  "impressiveThings": [
    { "title": "Short title", "paragraph": "2-3 sentences about a standout achievement with specific details from the sessions." },
    { "title": "Short title", "paragraph": "..." },
    { "title": "Short title", "paragraph": "..." }
  ],
  "whereThingsGoWrong": [
    {
      "title": "Short friction category title",
      "paragraph": "2-3 sentences explaining the pattern and its root cause.",
      "examples": ["Concrete example from the sessions", "Another example"]
    },
    { "title": "...", "paragraph": "...", "examples": ["..."] },
    { "title": "...", "paragraph": "...", "examples": ["..."] }
  ],
  "featuresToTry": [
    {
      "title": "Add AGENTS.md to your repos",
      "why": "Based on the session patterns, the AI frequently lacks project context, leading to wrong-file or wrong-approach errors. Fill in the template below with the actual details you observed.",
      "pasteInto": "# Project Context\\n\\n## What this project does\\n<Fill in 2-3 sentences based on what you observed in the sessions — actual project names, languages, and purpose>\\n\\n## Key constraints\\n- Platform: <observed platform>\\n- Build: <observed build command>\\n- Test: <observed test command>\\n\\n## Coding guidelines\\n<List 2-4 of the most specific rules that would have prevented the friction patterns you observed — e.g. 'Always check git status before running git commands', 'Never mock the database in tests'>",
      "target": "Save as AGENTS.md at repo root"
    },
    {
      "title": "Configure opencode.json instructions",
      "why": "Loading project-specific files gives the AI consistent context across all sessions without you having to re-explain. Based on the observed friction, here are specific instructions that would help.",
      "pasteInto": "{\\n  \\"instructions\\": [\\n    \\"AGENTS.md\\"\\n  ],\\n  \\"system\\": \\"<Write 2-4 sentences of standing instructions directly addressing the top friction patterns observed — e.g. if the user often hits Git directory errors: Always verify we are inside a Git repo before running git commands. If the user frequently re-explains project context: This project is a C++ trading engine; key files are in src/. Never assume a function exists without grepping first.\\"\\n}",
      "target": "Add to opencode.json"
    },
    {
      "title": "<A third actionable suggestion specific to this user's patterns>",
      "why": "<Why this is relevant based on observed friction or workflow>",
      "pasteInto": "<Copy-pasteable prompt, config snippet, or workflow step the user can use immediately — must be specific to their actual patterns, not generic>",
      "target": "<Where to paste: 'Paste into opencode', 'Save as AGENTS.md', 'Add to opencode.json', etc.>"
    }
  ]
}

Respond with ONLY the JSON object. No markdown fences, no explanation.`

    const aggregateText = await llmCall(client, sessionId, aggregatorPrompt)
    const result = parseJSON<Partial<SynthesisResult>>(aggregateText, {})

    return {
      atAGlance: {
        workingWell: result.atAGlance?.workingWell ?? '',
        hindering:   result.atAGlance?.hindering   ?? '',
        quickWins:   result.atAGlance?.quickWins    ?? '',
      },
      behavioralProfile: result.behavioralProfile ?? '',
      impressiveThings:  result.impressiveThings  ?? [],
      whereThingsGoWrong: result.whereThingsGoWrong ?? [],
      featuresToTry:     result.featuresToTry     ?? [],
    }
  } finally {
    await client.session.delete({ path: { id: sessionId } }).catch(() => {})
  }
}
