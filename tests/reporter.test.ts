import { describe, it, expect, vi } from 'vitest'
import { renderReport } from '../src/reporter.js'
import type { InsightReport } from '../src/types.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, writeFileSync: vi.fn(), mkdirSync: vi.fn() }
})
vi.mock('node:child_process', () => ({ execSync: vi.fn() }))

const mockReport: InsightReport = {
  generatedAt: '2026-03-25T00:00:00.000Z',
  periodDays: 30,
  sessionCount: 5,
  projects: [{ name: 'MyApp', sessionCount: 3, description: 'Auth work' }],
  workflowInsights: {
    strengths: ['Good bash usage'],
    frictionPoints: ['Schema confusion'],
    behavioralProfile: 'Terse prompter',
  },
  codeQualityInsights: {
    recurringPatterns: ['Null errors'],
    recommendations: ['Add null checks'],
  },
  opencodeConfigSuggestions: [
    { description: 'Strict TS', rule: '"typescript.strict": true' },
  ],
  featureRecommendations: ['Try MCP servers'],
}

describe('renderReport', () => {
  it('returns HTML string containing key content', () => {
    const html = renderReport(mockReport)

    expect(html).toContain('MyApp')
    expect(html).toContain('Terse prompter')
    expect(html).toContain('Null errors')
    expect(html).toContain('"typescript.strict": true')
    expect(html).toContain('Try MCP servers')
  })

  it('includes copy button for each config suggestion', () => {
    const html = renderReport(mockReport)
    const copyButtonCount = (html.match(/navigator\.clipboard/g) ?? []).length
    expect(copyButtonCount).toBeGreaterThanOrEqual(1)
  })

  it('is a complete HTML document', () => {
    const html = renderReport(mockReport)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('</html>')
  })
})
