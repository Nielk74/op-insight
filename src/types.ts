export type MessagePart = {
  type: string
  content: string
}

export type Message = {
  role: 'user' | 'assistant'
  parts: MessagePart[]
}

export type Session = {
  id: string
  projectId: string
  createdAt: number
  updatedAt: number
  messages: Message[]
}

export type Facet = {
  sessionId: string
  projectName: string
  summary: string
  toolsUsed: string[]
  repeatedInstructions: string[]
  frictionPoints: string[]
  codeQualityPatterns: string[]
  workflowPatterns: string[]
}

export type ConfigSuggestion = {
  description: string
  rule: string
}

export type ProviderConfig = {
  provider: 'anthropic' | 'openai'
  model: string
  apiKey: string
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

