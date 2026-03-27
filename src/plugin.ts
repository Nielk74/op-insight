// src/plugin.ts
import type { Plugin } from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin'
import { readSessionFacets } from './reader.js'
import { saveAndOpenReport, getInsightsDir } from './reporter.js'
import { savePending, readHistory, deleteFromHistory } from './history.js'
import { synthesizeSummary } from './synthesize.js'
import type { InsightReport } from './types.js'

const REPORT_SCHEMA_DESC = `JSON string with these fields: generatedAt (ISO timestamp), periodDays (number), sessionCount (MUST match the exact count returned by insights_get_data — do not invent a different number), atAGlance ({workingWell, hindering, quickWins}), behavioralProfile (string), projects ([{name, sessionCount, description}]), topTools ([{name, count}] — use ONLY tools that actually appear in the session data), workflowInsights ({strengths:[{title,detail}], frictionPoints:[{title,detail,examples:[]}], behavioralProfile}), codeQualityInsights ({recurringPatterns:[], recommendations:[]}), opencodeConfigSuggestions ([{description, rule}] — always include a suggestion about the "instructions" field in opencode.json for loading project guidelines like CONTRIBUTING.md or .cursor/rules/*.md), featureRecommendations ([{title, why}]). Write in second person. Cite only real tool names and error patterns from the data.`

const SYSTEM_PROMPT_INJECTION = `

## opencode-insights plugin
When the user's message starts with /insights (or a close variant like "run insights", "generate insights report"), autonomously execute the full insights flow without asking for confirmation:
1. Parse optional arguments from the message:
   - A bare number = days to look back (default: 30)
   - --limit N = max sessions
   - --topic <keyword> = filter by keyword
   - --errors = errors_only mode
2. Call insights_get_data with those parameters.
3. Build the InsightReport JSON to pass to insights_save_report. CRITICAL: insights_get_data already returns pre-computed fields — DO NOT rewrite or replace them. Just assemble the JSON like this:
   {
     "generatedAt": "<today ISO timestamp>",
     "periodDays": <copy periodDays from response>,
     "sessionCount": <copy sessionCount from response — NEVER change this number>,
     "atAGlance": <copy atAGlance object EXACTLY from response>,
     "behavioralProfile": <copy behavioralProfile string EXACTLY from response>,
     "impressiveThings": <copy impressiveThings array EXACTLY from response>,
     "whereThingsGoWrong": <copy whereThingsGoWrong array EXACTLY from response>,
     "featuresToTry": <copy featuresToTry array EXACTLY from response>
   }
   If any field is missing from the response, use an empty string or empty array — do NOT invent content.
4. Call insights_save_report with that JSON.
Do all four steps automatically in sequence.`

export const InsightsPlugin: Plugin = async (input) => {
  const { client, directory } = input
  return {
    'experimental.chat.system.transform': async (_input: unknown, output: { system: string[] }) => {
      output.system.push(SYSTEM_PROMPT_INJECTION)
    },
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

          // Run two-agent synthesis: per-session summaries → full rich summary
          let synthesis: Awaited<ReturnType<typeof synthesizeSummary>> = null
          try {
            synthesis = await synthesizeSummary(client, facets, args.days, directory)
          } catch (_) {
            // non-fatal — SPA fallback will compute from raw data
          }

          return JSON.stringify({
            periodDays: args.days,
            sessionCount: facets.length,
            atAGlance:          synthesis?.atAGlance,
            behavioralProfile:  synthesis?.behavioralProfile,
            impressiveThings:   synthesis?.impressiveThings,
            whereThingsGoWrong: synthesis?.whereThingsGoWrong,
            featuresToTry:      synthesis?.featuresToTry,
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
            const raw = JSON.parse(args.report_json) as Record<string, unknown>
            // Normalize atAGlance — models frequently use wrong key names
            const ag = (raw.atAGlance ?? raw.atAglance ?? raw.at_a_glance ?? {}) as Record<string, unknown>
            raw.atAGlance = {
              workingWell: ag.workingWell ?? ag.working_well ?? ag.strengths ?? ag.good ?? '',
              hindering:   ag.hindering ?? ag.friction ?? ag.challenges ?? ag.bad ?? ag.highFrictionPoints ?? '',
              quickWins:   ag.quickWins ?? ag.quick_wins ?? ag.wins ?? ag.tips ?? ag.userBehaviors ?? '',
            }
            // Migrate old featureRecommendations → featuresToTry
            if (!raw.featuresToTry && raw.featureRecommendations) {
              raw.featuresToTry = (raw.featureRecommendations as Array<{title:string;why:string}>)
                .map(r => ({ title: r.title ?? '', why: r.why ?? '', pasteInto: '', target: '' }))
            }
            // Migrate old workflowInsights.frictionPoints → whereThingsGoWrong
            const wf = raw.workflowInsights as Record<string, unknown> | undefined
            if (!raw.whereThingsGoWrong && wf?.frictionPoints) {
              raw.whereThingsGoWrong = (wf.frictionPoints as Array<{title:string;detail:string;examples:string[]}> )
                .map(fp => ({ title: fp.title, paragraph: fp.detail, examples: fp.examples ?? [] }))
            }
            report = raw as unknown as InsightReport
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
      insights_list_runs: tool({
        description: 'List all runs stored in history.json, showing runAt timestamps and session counts. Use this before insights_delete_run to find the runAt value to delete.',
        args: {},
        async execute() {
          const history = readHistory(getInsightsDir())
          if (history.length === 0) return 'No history entries found.'
          return history.map((e, i) =>
            `[${i + 1}] runAt: ${e.runAt} | ${e.sessions.length} sessions | ${e.periodDays}d window`
          ).join('\n')
        },
      }),

      insights_delete_run: tool({
        description: 'Remove a specific run from history.json by its exact runAt timestamp. Use insights_list_runs first to find the runAt value.',
        args: {
          run_at: tool.schema.string().describe('Exact runAt timestamp of the run to delete (e.g. "2026-03-26T21:39:37.743Z")'),
        },
        async execute(args) {
          const removed = deleteFromHistory(getInsightsDir(), args.run_at)
          if (!removed) return `No run found with runAt="${args.run_at}". Use insights_list_runs to see available entries.`
          const remaining = readHistory(getInsightsDir()).length
          return `Deleted run from ${args.run_at}. History now has ${remaining} entries.`
        },
      }),
    },
  }
}

export default InsightsPlugin
