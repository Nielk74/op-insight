// tests/history.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { readHistory, appendToHistory } from '../src/history.js'
import type { ExtendedSessionFacet, HistoryEntry } from '../src/types.js'

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'insights-test-'))
}

const FAKE_SESSION: ExtendedSessionFacet = {
  sessionId: 'ses_abc', projectName: 'my-project', date: '2026-03-26',
  messageCount: 3, toolsUsed: ['bash'], errorSnippets: [], firstUserMessage: 'hello',
  duration: 5000, wasteScore: 0, messageCounts: { user: 1, assistant: 2 },
  filesTouched: ['src/foo.ts'], turnDepth: 2,
}

describe('readHistory', () => {
  it('returns empty array when file does not exist', () => {
    const dir = tmpDir()
    expect(readHistory(dir)).toEqual([])
    fs.rmSync(dir, { recursive: true })
  })
})

describe('appendToHistory', () => {
  let dir: string
  beforeEach(() => { dir = tmpDir() })
  afterEach(() => { fs.rmSync(dir, { recursive: true }) })

  it('creates history.json on first append', () => {
    appendToHistory(dir, { runAt: '2026-03-26T00:00:00Z', periodDays: 30, sessions: [FAKE_SESSION] })
    const h = readHistory(dir)
    expect(h.length).toBe(1)
    expect(h[0].sessions.length).toBe(1)
  })

  it('deduplicates sessions across runs', () => {
    const entry: HistoryEntry = { runAt: '2026-03-26T00:00:00Z', periodDays: 30, sessions: [FAKE_SESSION] }
    appendToHistory(dir, entry)
    appendToHistory(dir, { ...entry, runAt: '2026-03-27T00:00:00Z' })
    const h = readHistory(dir)
    // Second entry should have 0 sessions (ses_abc already in history)
    expect(h[1].sessions.length).toBe(0)
  })

  it('keeps new sessions in second run', () => {
    appendToHistory(dir, { runAt: '2026-03-26T00:00:00Z', periodDays: 30, sessions: [FAKE_SESSION] })
    const newSession = { ...FAKE_SESSION, sessionId: 'ses_xyz' }
    appendToHistory(dir, { runAt: '2026-03-27T00:00:00Z', periodDays: 30, sessions: [newSession] })
    const h = readHistory(dir)
    expect(h[1].sessions.length).toBe(1)
    expect(h[1].sessions[0].sessionId).toBe('ses_xyz')
  })
})
