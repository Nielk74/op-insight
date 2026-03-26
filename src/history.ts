// src/history.ts
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { HistoryEntry, ExtendedSessionFacet } from './types.js'

const HISTORY_FILE = 'history.json'
const PENDING_FILE = '.pending.json'

export function readHistory(dataDir: string): HistoryEntry[] {
  const filePath = path.join(dataDir, HISTORY_FILE)
  if (!fs.existsSync(filePath)) return []
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as HistoryEntry[]
  } catch {
    return []
  }
}

/**
 * Append a new run entry to history.json, stripping any sessions whose
 * sessionId already exists anywhere in history (dedup).
 */
export function appendToHistory(dataDir: string, entry: HistoryEntry): void {
  fs.mkdirSync(dataDir, { recursive: true })
  const existing = readHistory(dataDir)
  const seenIds = new Set(existing.flatMap(e => e.sessions.map(s => s.sessionId)))
  const newSessions = entry.sessions.filter(s => !seenIds.has(s.sessionId))
  existing.push({ ...entry, sessions: newSessions })
  fs.writeFileSync(path.join(dataDir, HISTORY_FILE), JSON.stringify(existing, null, 2), 'utf-8')
}

/** Save current-run facets so insights_save_report can retrieve them. */
export function savePending(dataDir: string, sessions: ExtendedSessionFacet[], periodDays: number): void {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(
    path.join(dataDir, PENDING_FILE),
    JSON.stringify({ sessions, periodDays }, null, 2),
    'utf-8'
  )
}

/** Load pending facets written by insights_get_data. Returns null if missing. */
export function loadPending(dataDir: string): { sessions: ExtendedSessionFacet[]; periodDays: number } | null {
  const p = path.join(dataDir, PENDING_FILE)
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

/** Delete the pending facets file after it has been consumed. */
export function deletePending(dataDir: string): void {
  const p = path.join(dataDir, PENDING_FILE)
  if (fs.existsSync(p)) fs.unlinkSync(p)
}
