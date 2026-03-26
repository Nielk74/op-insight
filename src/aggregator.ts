import type { Facet, InsightReport } from './types.js'
import { callLlm } from './llm.js'
import { extractJson } from './json-utils.js'

const SYNTHESIS_SYSTEM_PROMPT = `You are analyzing aggregated data from multiple AI coding sessions to produce a personal insights report.
IMPORTANT: Your ENTIRE response must be a single valid JSON object. Do NOT include any text, explanation, or markdown before or after the JSON. Start your response with { and end with }.

Write in second person ("you", "your") throughout. Be specific — cite actual project names, file paths, tool names, and error messages from the session data. Avoid generic statements; every insight should be traceable to something concrete in the data.

Produce a JSON object with EXACTLY these fields:
- generatedAt: ISO timestamp string (now)
- periodDays: number (copy from input)
- sessionCount: number (copy from input)
- atAGlance: {
    workingWell: string (2-3 sentences on what the user does well — cite a specific win from the sessions),
    hindering: string (2-3 sentences on the main friction — cite the specific recurring error or pattern),
    quickWins: string (1-2 actionable suggestions with concrete "try this" language)
  }
- behavioralProfile: string (3-4 sentences characterizing how this user works with AI tools, based on patterns in the data — specific, not generic)
- projects: Array<{ name: string, sessionCount: number, description: string }> (describe what actually happened in each project)
- topTools: Array<{ name: string, count: number }> (aggregate toolsUsed across all facets, count occurrences, return top 6)
- workflowInsights: {
    strengths: Array<{ title: string, detail: string }> (2-3 concrete strengths with specifics from session data),
    frictionPoints: Array<{ title: string, detail: string, examples: string[] }> (2-4 friction points; examples should be actual things that went wrong, like the real error message or action),
    behavioralProfile: string (copy of the top-level behavioralProfile)
  }
- codeQualityInsights: {
    recurringPatterns: string[] (actual patterns observed, with examples like "assumed paths without checking"),
    recommendations: string[] (actionable, concrete)
  }
- opencodeConfigSuggestions: Array<{ description: string, rule: string }> (copy-pasteable JSON snippets for opencode config)
- featureRecommendations: Array<{ title: string, why: string }> (opencode features not being used; why explains specifically how it would help this user)`

export async function synthesizeReport(
  facets: Facet[],
  periodDays: number
): Promise<InsightReport> {
  const payload = {
    periodDays,
    sessionCount: facets.length,
    facets,
  }

  const raw = await callLlm(
    SYNTHESIS_SYSTEM_PROMPT,
    JSON.stringify(payload, null, 2)
  )

  let report: InsightReport
  try {
    report = extractJson<InsightReport>(raw)
  } catch (e) {
    throw new Error(`LLM returned invalid JSON for synthesis: ${e}\n\nRaw response:\n${raw.slice(0, 500)}`)
  }
  report.periodDays = periodDays
  report.sessionCount = facets.length
  return report
}
