// src/types.ts

export type SessionFacet = {
  sessionId: string
  projectName: string        // inferred from file paths or directory
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
