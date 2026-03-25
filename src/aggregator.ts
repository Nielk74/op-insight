import type { Facet, InsightReport } from './types.js'
import { callLlm } from './llm.js'

const SYNTHESIS_SYSTEM_PROMPT = `You are analyzing aggregated data from multiple coding sessions.
Produce an InsightReport as valid JSON (no markdown fences) with these fields:
- generatedAt: ISO timestamp string
- periodDays: number
- sessionCount: number
- projects: Array<{ name, sessionCount, description }>
- workflowInsights: { strengths: string[], frictionPoints: string[], behavioralProfile: string }
- codeQualityInsights: { recurringPatterns: string[], recommendations: string[] }
- opencodeConfigSuggestions: Array<{ description: string, rule: string }> (ready-to-paste opencode.json snippets)
- featureRecommendations: string[] (opencode features the user isn't leveraging)

Be specific and actionable. The config suggestions should be copy-pasteable JSON snippets.`

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
    report = JSON.parse(raw) as InsightReport
  } catch (e) {
    throw new Error(`LLM returned invalid JSON for synthesis: ${e}`)
  }
  report.periodDays = periodDays
  report.sessionCount = facets.length
  return report
}
