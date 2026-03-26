// src/compute.ts
import type { HistoryEntry, FingerprintAxes, TrendPoint } from './types.js'

export type ToolPartSummary = {
  tool: string
  hasError: boolean
}

/** Returns the ISO date string of the Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const d = new Date(date)
  const day = d.getDay() // 0=Sun
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

/**
 * Count consecutive same-tool retries where at least one has an error.
 * Capped at 10.
 */
export function computeWasteScore(parts: ToolPartSummary[]): number {
  let score = 0
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].tool === parts[i - 1].tool && parts[i].hasError) {
      score++
    }
  }
  return Math.min(score, 10)
}

/** Compute five-axis fingerprint from a rolling 90-day window of history. */
export function computeFingerprint(history: HistoryEntry[]): FingerprintAxes {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 90)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const sessions = deduplicateSessions(history).filter(s => s.date >= cutoffStr)
  if (sessions.length === 0) {
    return { autonomy: 0, breadth: 0, iteration: 0, toolDiversity: 0, outputDensity: 0 }
  }

  const autonomy = Math.min(
    sessions.reduce((s, f) => s + f.turnDepth, 0) / sessions.length / 10, 1
  )

  const weekProjects = new Map<string, Set<string>>()
  for (const s of sessions) {
    const w = weekStart(s.date)
    if (!weekProjects.has(w)) weekProjects.set(w, new Set())
    weekProjects.get(w)!.add(s.projectName)
  }
  const avgProjectsPerWeek = [...weekProjects.values()].reduce((s, p) => s + p.size, 0) / weekProjects.size
  const breadth = Math.min(avgProjectsPerWeek / 5, 1)

  const avgWaste = sessions.reduce((s, f) => s + f.wasteScore, 0) / sessions.length
  const iteration = Math.max(0, 1 - avgWaste / 10)

  const allToolsInWindow = new Set(sessions.flatMap(s => s.toolsUsed))
  const allToolsEver = new Set(deduplicateSessions(history).flatMap(s => s.toolsUsed))
  const toolDiversity = allToolsEver.size === 0 ? 0 : allToolsInWindow.size / allToolsEver.size

  const avgFiles = sessions.reduce((s, f) => s + f.filesTouched.length, 0) / sessions.length
  const outputDensity = Math.min(avgFiles / 10, 1)

  return { autonomy, breadth, iteration, toolDiversity, outputDensity }
}

/** Compute weekly trend data for the last 12 weeks. */
export function computeTrends(history: HistoryEntry[]): TrendPoint[] {
  const unique = deduplicateSessions(history)
  const today = new Date()
  const points: TrendPoint[] = []

  for (let i = 11; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i * 7)
    const week = weekStart(d.toISOString().slice(0, 10))
    const weekEnd = new Date(week)
    weekEnd.setDate(weekEnd.getDate() + 7)
    const weekEndStr = weekEnd.toISOString().slice(0, 10)
    const ws = unique.filter(s => s.date >= week && s.date < weekEndStr)

    points.push({
      week,
      avgTurnDepth: ws.length === 0 ? 0 : ws.reduce((s, f) => s + f.turnDepth, 0) / ws.length,
      errorRate: ws.length === 0 ? 0 : ws.filter(s => s.wasteScore > 0).length / ws.length,
      toolDiversity: ws.length === 0 ? 0 : new Set(ws.flatMap(s => s.toolsUsed)).size,
      avgWasteScore: ws.length === 0 ? 0 : ws.reduce((s, f) => s + f.wasteScore, 0) / ws.length,
    })
  }
  return points
}

/** Flatten all history sessions, removing duplicates by sessionId (first wins). */
export function deduplicateSessions(history: HistoryEntry[]) {
  const seen = new Set<string>()
  return history.flatMap(e => e.sessions).filter(s => {
    if (seen.has(s.sessionId)) return false
    seen.add(s.sessionId)
    return true
  })
}
