// src/plugin.ts
import type { Plugin } from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin'
import { readSessionFacets } from './reader.js'
import { saveAndOpenReport } from './reporter.js'
import type { InsightReport } from './types.js'

const REPORT_SCHEMA_DESC = `
InsightReport JSON schema:
{
  "generatedAt": "ISO timestamp",
  "periodDays": number,
  "sessionCount": number,
  "atAGlance": { "workingWell": "string", "hindering": "string", "quickWins": "string" },
  "behavioralProfile": "string",
  "projects": [{ "name": "string", "sessionCount": number, "description": "string" }],
  "topTools": [{ "name": "string", "count": number }],
  "workflowInsights": {
    "strengths": [{ "title": "string", "detail": "string" }],
    "frictionPoints": [{ "title": "string", "detail": "string", "examples": ["string"] }],
    "behavioralProfile": "string"
  },
  "codeQualityInsights": { "recurringPatterns": ["string"], "recommendations": ["string"] },
  "opencodeConfigSuggestions": [{ "description": "string", "rule": "string" }],
  "featureRecommendations": [{ "title": "string", "why": "string" }]
}
Write in second person ("you", "your"). Be specific — cite project names, tool names, and actual error messages from the session data. Every insight must be traceable to something concrete in the data.`

export const InsightsPlugin: Plugin = async () => {
  return {
    tool: {
      insights_get_data: tool({
        description: 'Read opencode session data and return compact per-session facets for analysis. Call this first, then synthesize the data into an InsightReport, then call insights_save_report.',
        args: {
          days: tool.schema.number().default(30).describe('Number of past days to include'),
          limit: tool.schema.number().optional().describe('Max sessions to return (for faster runs)'),
          topic: tool.schema.string().optional().describe('Only include sessions whose content contains this keyword'),
          errors_only: tool.schema.boolean().optional().describe('Only include sessions that had tool errors'),
        },
        async execute(args, context) {
          let facets
          try {
            facets = readSessionFacets(
              args.days,
              context.sessionID,
              args.limit,
              args.topic,
              args.errors_only
            )
          } catch (e) {
            return `Error reading session data: ${e}`
          }
          return JSON.stringify({
            periodDays: args.days,
            sessionCount: facets.length,
            sessions: facets,
          }, null, 2)
        },
      }),

      insights_save_report: tool({
        description: `Save an insights report to disk and open it in the browser. Pass a JSON string matching the InsightReport schema.${REPORT_SCHEMA_DESC}`,
        args: {
          report_json: tool.schema.string().describe('JSON string matching InsightReport schema'),
        },
        async execute(args) {
          let report: InsightReport
          try {
            report = JSON.parse(args.report_json) as InsightReport
          } catch (e) {
            return `Error: report_json is not valid JSON: ${e}`
          }
          const outPath = saveAndOpenReport(report)
          return `Report saved to ${outPath} and opened in browser.`
        },
      }),
    },
  }
}

export default InsightsPlugin
