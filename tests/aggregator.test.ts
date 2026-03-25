import { describe, it, expect, vi, beforeEach } from 'vitest'
import { synthesizeReport } from '../src/aggregator.js'
import type { Facet, ProviderConfig, InsightReport } from '../src/types.js'

vi.mock('../src/llm.js', () => ({
  callLlm: vi.fn(),
}))
import { callLlm } from '../src/llm.js'

const mockConfig: ProviderConfig = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  apiKey: 'test-key',
}

const mockFacets: Facet[] = [
  {
    sessionId: 'ses_1',
    projectName: 'MyApp',
    summary: 'Fixed auth bug',
    toolsUsed: ['edit', 'bash'],
    repeatedInstructions: ['use TypeScript strict mode'],
    frictionPoints: ['Claude misunderstood the schema'],
    codeQualityPatterns: ['null pointer errors'],
    workflowPatterns: ['gives brief prompts then corrects'],
  },
]

const mockReport: InsightReport = {
  generatedAt: '2026-03-25T00:00:00.000Z',
  periodDays: 30,
  sessionCount: 1,
  projects: [{ name: 'MyApp', sessionCount: 1, description: 'Auth work' }],
  workflowInsights: {
    strengths: ['Uses bash tool well'],
    frictionPoints: ['Schema misunderstandings'],
    behavioralProfile: 'Terse prompter who iterates quickly',
  },
  codeQualityInsights: {
    recurringPatterns: ['null pointer errors'],
    recommendations: ['Add null checks'],
  },
  opencodeConfigSuggestions: [
    { description: 'Enforce strict TS', rule: '"typescript.strict": true' },
  ],
  featureRecommendations: ['Try MCP servers for external tools'],
}

describe('synthesizeReport', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls LLM with all facets and returns parsed report', async () => {
    vi.mocked(callLlm).mockResolvedValue(JSON.stringify(mockReport))

    const result = await synthesizeReport(mockFacets, 30, mockConfig)

    expect(callLlm).toHaveBeenCalledOnce()
    expect(result.sessionCount).toBe(1)
    expect(result.projects[0].name).toBe('MyApp')
  })

  it('includes periodDays and sessionCount in report', async () => {
    vi.mocked(callLlm).mockResolvedValue(JSON.stringify(mockReport))

    const result = await synthesizeReport(mockFacets, 90, mockConfig)

    expect(result.periodDays).toBe(90) // overridden with ground-truth value
    expect(result.sessionCount).toBe(1) // overridden with ground-truth value
  })
})
