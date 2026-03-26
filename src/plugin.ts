// src/plugin.ts
import type { Plugin } from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin'
import { readSessionFacets } from './reader.js'
import { saveAndOpenReport, getInsightsDir } from './reporter.js'
import { savePending } from './history.js'
import type { InsightReport } from './types.js'

const REPORT_SCHEMA_DESC = `JSON string with these fields: generatedAt (ISO timestamp), periodDays (number), sessionCount (number), atAGlance ({workingWell, hindering, quickWins}), behavioralProfile (string), projects ([{name, sessionCount, description}]), topTools ([{name, count}]), workflowInsights ({strengths:[{title,detail}], frictionPoints:[{title,detail,examples:[]}], behavioralProfile}), codeQualityInsights ({recurringPatterns:[], recommendations:[]}), opencodeConfigSuggestions ([{description, rule}]), featureRecommendations ([{title, why}]). Write in second person. Cite specific project names, tool names, and error messages from the data.`

export const InsightsPlugin: Plugin = async () => {
  return {
    tool: {
      insights_get_data: tool({
        description: 'Read opencode session data and return compact per-session facets for analysis. Step 1 of 2: call this first to get the data, synthesize it into an InsightReport JSON, then ALWAYS call insights_save_report to render and open the HTML report — never skip the save step.',
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
          try {
            savePending(getInsightsDir(), facets, args.days)
          } catch (_) {
            // non-fatal
          }
          return JSON.stringify({
            periodDays: args.days,
            sessionCount: facets.length,
            sessions: facets,
          }, null, 2)
        },
      }),

      insights_save_report: tool({
        description: 'Step 2 of 2: save the InsightReport JSON to disk as an HTML report and open it in the browser. Always call this after insights_get_data.',
        args: {
          report_json: tool.schema.string().describe(REPORT_SCHEMA_DESC),
        },
        async execute(args) {
          let report: InsightReport
          try {
            report = JSON.parse(args.report_json) as InsightReport
          } catch (e) {
            return `Error: report_json is not valid JSON: ${e}`
          }
          let outPath: string
          try {
            outPath = saveAndOpenReport(report)
          } catch (e) {
            return `Error saving report: ${e instanceof Error ? e.stack ?? e.message : String(e)}`
          }
          return `Report saved to ${outPath} and opened in browser.`
        },
      }),
    },
  }
}

export default InsightsPlugin
