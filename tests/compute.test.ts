// tests/compute.test.ts
import { describe, it, expect } from 'vitest'
import { computeWasteScore, computeFingerprint, computeTrends, weekStart } from '../src/compute.js'
import type { HistoryEntry } from '../src/types.js'

describe('weekStart', () => {
  it('returns Monday for a Monday', () => {
    expect(weekStart('2026-03-23')).toBe('2026-03-23') // 2026-03-23 is a Monday
  })
  it('returns the previous Monday for a Wednesday', () => {
    expect(weekStart('2026-03-25')).toBe('2026-03-23')
  })
})

describe('computeWasteScore', () => {
  it('returns 0 with no retries', () => {
    expect(computeWasteScore([
      { tool: 'bash', hasError: false },
      { tool: 'read', hasError: false },
    ])).toBe(0)
  })
  it('returns 1 when the same tool appears twice and the second has an error', () => {
    expect(computeWasteScore([
      { tool: 'bash', hasError: false },
      { tool: 'bash', hasError: true },
    ])).toBe(1)
  })
  it('returns 0 when tools alternate even if one has an error', () => {
    expect(computeWasteScore([
      { tool: 'bash', hasError: true },
      { tool: 'read', hasError: true },
    ])).toBe(0)
  })
  it('caps at 10', () => {
    const parts = Array.from({ length: 22 }, (_, i) => ({ tool: 'bash', hasError: i % 2 === 1 }))
    expect(computeWasteScore(parts)).toBe(10)
  })
})

describe('computeFingerprint', () => {
  it('returns all zeros on empty history', () => {
    const fp = computeFingerprint([])
    expect(fp).toEqual({ autonomy: 0, breadth: 0, iteration: 0, toolDiversity: 0, outputDensity: 0 })
  })

  it('computes autonomy as avg turnDepth / 10', () => {
    const today = new Date().toISOString().slice(0, 10)
    const entry: HistoryEntry = {
      runAt: today + 'T00:00:00Z',
      periodDays: 30,
      sessions: [{
        sessionId: 'a', projectName: 'p', date: today,
        messageCount: 1, toolsUsed: [], errorSnippets: [], firstUserMessage: '',
        duration: 0, wasteScore: 0, messageCounts: { user: 1, assistant: 1 },
        filesTouched: [], turnDepth: 5,
      }],
    }
    expect(computeFingerprint([entry]).autonomy).toBeCloseTo(0.5)
  })
})

describe('computeTrends', () => {
  it('returns exactly 12 TrendPoints', () => {
    expect(computeTrends([]).length).toBe(12)
  })
  it('all zero values with empty history', () => {
    const trends = computeTrends([])
    expect(trends.every(t => t.avgTurnDepth === 0 && t.errorRate === 0)).toBe(true)
  })
})
