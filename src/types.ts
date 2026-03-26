// src/types.ts

export type SessionFacet = {
  sessionId: string
  date: string               // ISO date string of session creation
  messageCount: number
  toolsUsed: string[]        // unique tool names seen in parts
  errorSnippets: string[]    // up to 5 error lines from assistant messages
  firstUserMessage: string   // first user message, truncated to 200 chars
}

export type ConfigSuggestion = {
  description: string
  rule: string
}

export type InsightReport = {
  generatedAt: string
  periodDays: number
  sessionCount: number
  atAGlance: {
    workingWell: string
    hindering: string
    quickWins: string
  }
  behavioralProfile: string
  projects: Array<{
    name: string
    sessionCount: number
    description: string
  }>
  topTools: Array<{ name: string; count: number }>
  workflowInsights: {
    strengths: Array<{ title: string; detail: string }>
    frictionPoints: Array<{ title: string; detail: string; examples: string[] }>
    behavioralProfile: string
  }
  codeQualityInsights: {
    recurringPatterns: string[]
    recommendations: string[]
  }
  opencodeConfigSuggestions: ConfigSuggestion[]
  featureRecommendations: Array<{ title: string; why: string }>
}

// Extended per-session facet with richer metrics
export type ExtendedSessionFacet = SessionFacet & {
  duration: number                              // ms, last msg time − first msg time
  wasteScore: number                            // 0–10, consecutive same-tool error retries
  messageCounts: { user: number; assistant: number }
  filesTouched: string[]                        // paths from edit/write/read tool inputs
  turnDepth: number                             // count of step-finish parts (= LLM generations)
  hourOfDay: number                             // 0–23, hour of first message (local time)
}

// One entry per report run, stored in history.json
export type HistoryEntry = {
  runAt: string                                 // ISO timestamp
  periodDays: number
  sessions: ExtendedSessionFacet[]
}

// Five-axis fingerprint, all values 0–1
export type FingerprintAxes = {
  autonomy: number          // avg turnDepth / 10, capped at 1
  sessionFrequency: number  // avg sessions/week over last 90 days / 10, capped at 1
  iteration: number         // 1 − (avg wasteScore / 10)
  toolDiversity: number     // unique tools used / all tools ever seen in history
  outputDensity: number     // avg filesTouched.length / 10, capped at 1
}

// One data point per calendar week
export type TrendPoint = {
  week: string           // Monday date "YYYY-MM-DD"
  avgTurnDepth: number
  errorRate: number      // fraction 0–1 (sessions with wasteScore > 0)
  toolDiversity: number  // unique tool count that week
  avgWasteScore: number
}

// Everything baked into window.INSIGHTS_DATA
export type InsightsData = {
  current: {
    runAt: string
    periodDays: number
    sessions: ExtendedSessionFacet[]
  }
  history: HistoryEntry[]
  fingerprint: FingerprintAxes
  trends: TrendPoint[]         // last 12 weeks
  summary?: InsightReport      // LLM-generated analysis, optional
}
