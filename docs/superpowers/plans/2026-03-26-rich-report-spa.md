# Rich Report SPA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the one-shot HTML report into a persistent-history SPA with trend sparklines, a fingerprint radar, a project timeline, and drillable session cards — all baked into a self-contained HTML file, zero server, zero dependencies.

**Architecture:** `insights_get_data` saves raw facets to `.pending.json`. `insights_save_report` reads them, appends to `history.json` (deduped by sessionId), computes fingerprint + trends from 90-day history, then renders a self-contained HTML SPA with all data inlined as `window.INSIGHTS_DATA`. All charts use vanilla Canvas API.

**Tech Stack:** TypeScript, Bun runtime (opencode provides it), esbuild bundler, vitest (unit tests on pure functions), vanilla Canvas + DOM (SPA charts)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types.ts` | Modify | Add `ExtendedSessionFacet`, `HistoryEntry`, `InsightsData`, `FingerprintAxes`, `TrendPoint` |
| `src/compute.ts` | **Create** | Pure functions: `computeWasteScore`, `computeFingerprint`, `computeTrends`, `weekStart` — no bun deps, fully testable |
| `src/reader.ts` | Modify | Return `ExtendedSessionFacet[]`; add `mcreated` to SQL; extract duration, messageCounts, filesTouched, turnDepth, wasteScore |
| `src/history.ts` | **Create** | `readHistory`, `appendToHistory` (dedup by sessionId), `savePending`, `loadPending`, `deletePending` |
| `src/spa.ts` | **Create** | Exports `SPA_SCRIPT: string` — the entire client-side JS for tabs, Canvas charts, and DOM rendering |
| `src/reporter.ts` | Modify | New HTML shell, inject `window.INSIGHTS_DATA`, include `SPA_SCRIPT`, load history + compute before rendering |
| `src/plugin.ts` | Modify | `insights_get_data` saves pending facets; `insights_save_report` loads them and passes to reporter |
| `src/index.ts` | No change | — |
| `tests/compute.test.ts` | **Create** | Unit tests for `computeWasteScore`, `computeFingerprint`, `computeTrends` |
| `tests/history.test.ts` | **Create** | Unit tests for `appendToHistory` dedup logic |
| `tests/index.test.ts` | Replace | Remove stale imports, add smoke test |
| `package.json` | Modify | Add vitest dev dep, fix `"test"` script |
| `vitest.config.ts` | **Create** | Node environment config |

---

## Task 0 — Tag current version + set up test framework

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Replace: `tests/index.test.ts`

- [ ] **Step 1: Tag the current release**

```bash
git tag v2026.3.26
```

Expected: `git tag` shows `v2026.3.26`

- [ ] **Step 2: Install vitest**

```bash
npm install --save-dev vitest
```

- [ ] **Step 3: Add test script and vitest to package.json**

In `package.json`, replace the `"scripts"` block with:

```json
"scripts": {
  "build": "esbuild src/index.ts --bundle --platform=node --target=esnext --format=esm --external:bun:sqlite --external:bun --outfile=dist/index.js",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "prepublishOnly": "npm run build"
},
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
```

- [ ] **Step 5: Replace tests/index.test.ts with a smoke test that will pass**

```typescript
// tests/index.test.ts
import { describe, it, expect } from 'vitest'

describe('smoke', () => {
  it('vitest is configured', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected output: `1 passed`

- [ ] **Step 7: Commit**

```bash
git add package.json vitest.config.ts tests/index.test.ts
git commit -m "chore: add vitest, tag v2026.3.26"
```

---

## Task 1 — Extend types.ts

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add new types to src/types.ts**

Append after the existing `InsightReport` type (keep all existing types unchanged):

```typescript
// Extended per-session facet with richer metrics
export type ExtendedSessionFacet = SessionFacet & {
  duration: number                              // ms, last msg time − first msg time
  wasteScore: number                            // 0–10, consecutive same-tool error retries
  messageCounts: { user: number; assistant: number }
  filesTouched: string[]                        // paths from edit/write/read tool inputs
  turnDepth: number                             // count of step-finish parts (= LLM generations)
}

// One entry per report run, stored in history.json
export type HistoryEntry = {
  runAt: string                                 // ISO timestamp
  periodDays: number
  sessions: ExtendedSessionFacet[]
}

// Five-axis fingerprint, all values 0–1
export type FingerprintAxes = {
  autonomy: number       // avg turnDepth / 10, capped at 1
  breadth: number        // avg unique projects/week / 5, capped at 1
  iteration: number      // 1 − (avg wasteScore / 10)
  toolDiversity: number  // unique tools used / all tools ever seen in history
  outputDensity: number  // avg filesTouched.length / 10, capped at 1
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
  trends: TrendPoint[]   // last 12 weeks
}
```

- [ ] **Step 2: Verify types compile**

```bash
npm run typecheck 2>&1 | head -20
```

Expected: no errors (or only pre-existing errors unrelated to types.ts)

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add ExtendedSessionFacet, HistoryEntry, InsightsData"
```

---

## Task 2 — Create src/compute.ts (pure functions, testable)

**Files:**
- Create: `src/compute.ts`
- Create: `tests/compute.test.ts`

- [ ] **Step 1: Write the failing tests first**

```typescript
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test
```

Expected: fails with `Cannot find module '../src/compute.js'`

- [ ] **Step 3: Create src/compute.ts**

```typescript
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
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all compute tests pass

- [ ] **Step 5: Commit**

```bash
git add src/compute.ts src/types.ts tests/compute.test.ts
git commit -m "feat(compute): pure functions for wasteScore, fingerprint, trends"
```

---

## Task 3 — Create src/history.ts

**Files:**
- Create: `src/history.ts`
- Create: `tests/history.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
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
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test
```

Expected: fails with `Cannot find module '../src/history.js'`

- [ ] **Step 3: Create src/history.ts**

```typescript
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
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all history tests pass

- [ ] **Step 5: Commit**

```bash
git add src/history.ts tests/history.test.ts
git commit -m "feat(history): read/append/dedup history.json, pending facets helpers"
```

---

## Task 4 — Extend reader.ts to return ExtendedSessionFacet

**Files:**
- Modify: `src/reader.ts`

The SQL query needs `m.time_created AS mcreated` to compute session duration. Parts need to expose tool output (for wasteScore) and tool input (for filesTouched).

- [ ] **Step 1: Replace src/reader.ts entirely**

```typescript
// src/reader.ts
import { Database } from 'bun:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ExtendedSessionFacet } from './types.js'
import { computeWasteScore } from './compute.js'

export function getDbPath(): string {
  const dataDir = process.env.OPENCODE_DATA_DIR
    ?? path.join(os.homedir(), '.local', 'share', 'opencode')
  return path.join(dataDir, 'opencode.db')
}

const ERROR_RE = /error|failed|exit code [^0]|enoent|cannot|not found/i
const PATH_RE = /(?:^|\s)([\w.-]+)\/[\w./-]+\.(ts|js|py|lua|go|rs|json|md)/i
const FILE_TOOLS = new Set(['edit', 'write', 'read'])

function inferProject(texts: string[]): string {
  for (const text of texts) {
    const m = text.match(PATH_RE)
    if (m?.[1] && m[1] !== 'node_modules') return m[1]
  }
  return 'Unknown'
}

export function readSessionFacets(
  days: number,
  currentSessionId: string | undefined,
  limit?: number,
  topic?: string,
  errorsOnly?: boolean
): ExtendedSessionFacet[] {
  const dbPath = getDbPath()
  if (!fs.existsSync(dbPath)) {
    throw new Error(`opencode database not found at ${dbPath}`)
  }

  const db = new Database(dbPath, { readonly: true })
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000

  type Row = {
    sid: string; screated: number; mcreated: number | null; mid: string | null;
    mrole: string | null; pdata: string | null
  }

  let rows: Row[]
  try {
    rows = db.query<Row, unknown[]>(`
      SELECT
        s.id             AS sid,
        s.time_created   AS screated,
        m.time_created   AS mcreated,
        m.id             AS mid,
        JSON_EXTRACT(m.data, '$.role') AS mrole,
        p.data           AS pdata
      FROM session s
      LEFT JOIN message m ON m.session_id = s.id
      LEFT JOIN part p ON p.message_id = m.id
      WHERE s.time_created > ?
      ${currentSessionId ? 'AND s.id != ?' : ''}
      ORDER BY s.time_created DESC, m.time_created, p.id
    `).all(currentSessionId ? [cutoff, currentSessionId] : [cutoff])
  } finally {
    db.close()
  }

  // Per-session accumulators
  type SessAcc = {
    createdAt: number
    msgTimes: number[]
    messages: Array<{ role: string; parts: Array<{ type: string; text: string; toolName?: string }> }>
    msgIndex: Map<string, number>
    toolParts: Array<{ tool: string; hasError: boolean }>
    filesTouched: Set<string>
    turnDepth: number
    userCount: number
    assistantCount: number
  }
  const sessionMap = new Map<string, SessAcc>()

  for (const row of rows) {
    if (!sessionMap.has(row.sid)) {
      sessionMap.set(row.sid, {
        createdAt: row.screated,
        msgTimes: [],
        messages: [],
        msgIndex: new Map(),
        toolParts: [],
        filesTouched: new Set(),
        turnDepth: 0,
        userCount: 0,
        assistantCount: 0,
      })
    }
    const sess = sessionMap.get(row.sid)!
    if (row.mcreated) sess.msgTimes.push(row.mcreated)
    if (!row.mid || !row.pdata) continue
    if (!sess.msgIndex.has(row.mid)) {
      sess.msgIndex.set(row.mid, sess.messages.length)
      const role = row.mrole ?? 'user'
      sess.messages.push({ role, parts: [] })
      if (role === 'user') sess.userCount++
      else if (role === 'assistant') sess.assistantCount++
    }

    let pdata: {
      type?: string; text?: string; content?: string; tool?: string
      state?: { input?: Record<string, string>; output?: string }
    } = {}
    try { pdata = JSON.parse(row.pdata) } catch { continue }

    const idx = sess.msgIndex.get(row.mid)
    if (idx === undefined) continue

    // Count LLM generations
    if (pdata.type === 'step-finish') {
      sess.turnDepth++
      continue
    }

    // Extract tool metrics
    if (pdata.type === 'tool' && pdata.tool) {
      const output = pdata.state?.output ?? ''
      sess.toolParts.push({ tool: pdata.tool, hasError: ERROR_RE.test(output) })
      if (FILE_TOOLS.has(pdata.tool.toLowerCase())) {
        const fp = pdata.state?.input?.file_path ?? pdata.state?.input?.path
        if (fp) sess.filesTouched.add(fp)
      }
    }

    sess.messages[idx].parts.push({
      type: pdata.type ?? 'text',
      text: pdata.text ?? pdata.content ?? '',
      toolName: pdata.tool,
    })
  }

  let facets: ExtendedSessionFacet[] = []

  for (const [sid, sess] of sessionMap) {
    if (sess.messages.length === 0) continue

    const allTexts = sess.messages.flatMap(m => m.parts.map(p => p.text))
    const assistantTexts = sess.messages
      .filter(m => m.role === 'assistant')
      .flatMap(m => m.parts.map(p => p.text))

    const toolsUsed = Array.from(new Set(
      sess.messages.flatMap(m => m.parts)
        .filter(p => p.type === 'tool' && p.toolName)
        .map(p => p.toolName!)
    ))

    const errorSnippets: string[] = []
    for (const text of assistantTexts) {
      for (const line of text.split('\n')) {
        if (ERROR_RE.test(line) && errorSnippets.length < 5) {
          errorSnippets.push(line.trim().slice(0, 120))
        }
      }
    }

    const rawFirstMsg = sess.messages
      .find(m => m.role === 'user')
      ?.parts.map(p => p.text).join(' ') ?? ''
    const firstUserMessage = rawFirstMsg.replace(/^"([\s\S]*?)"\s*$/, '$1').slice(0, 200)

    const fullText = allTexts.join(' ')
    if (topic && !fullText.toLowerCase().includes(topic.toLowerCase())) continue
    if (errorsOnly && sess.toolParts.every(p => !p.hasError)) continue

    const sortedTimes = sess.msgTimes.filter(Boolean).sort((a, b) => a - b)
    const duration = sortedTimes.length >= 2
      ? sortedTimes[sortedTimes.length - 1] - sortedTimes[0]
      : 0

    facets.push({
      sessionId: sid,
      projectName: inferProject(allTexts),
      date: new Date(sess.createdAt).toISOString().slice(0, 10),
      messageCount: sess.messages.length,
      toolsUsed,
      errorSnippets,
      firstUserMessage,
      duration,
      wasteScore: computeWasteScore(sess.toolParts),
      messageCounts: { user: sess.userCount, assistant: sess.assistantCount },
      filesTouched: Array.from(sess.filesTouched),
      turnDepth: sess.turnDepth,
    })
  }

  if (limit != null) facets = facets.slice(0, limit)
  return facets
}
```

- [ ] **Step 2: Build to verify compilation**

```bash
npm run build 2>&1
```

Expected: `dist/index.js  ~460kb  Done in <200ms`  — no errors

- [ ] **Step 3: Commit**

```bash
git add src/reader.ts
git commit -m "feat(reader): return ExtendedSessionFacet with duration, wasteScore, filesTouched, turnDepth"
```

---

## Task 5 — Create src/spa.ts (full client-side SPA)

**Files:**
- Create: `src/spa.ts`

This file exports a single string constant containing the complete client-side JavaScript for the SPA. It is injected verbatim into the `<script>` block of the HTML report.

- [ ] **Step 1: Create src/spa.ts**

```typescript
// src/spa.ts
// The entire client-side SPA as a template string.
// Injected verbatim into the <script> tag of the rendered HTML.
// No imports at runtime — all data comes from window.INSIGHTS_DATA.

export const SPA_SCRIPT = `
(function () {
  var data = window.INSIGHTS_DATA;
  var panels = ['trends', 'fingerprint', 'timeline', 'cards'];

  // ── Tab Navigation ──────────────────────────────────────────────
  function showTab(name) {
    panels.forEach(function(p) {
      document.getElementById('panel-' + p).style.display = p === name ? 'block' : 'none';
      document.getElementById('tab-' + p).classList.toggle('active', p === name);
    });
  }
  panels.forEach(function(p) {
    document.getElementById('tab-' + p).addEventListener('click', function() { showTab(p); });
  });

  // ── Canvas Helpers ───────────────────────────────────────────────
  function drawSparkline(canvas, values, color) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height, pad = 10;
    ctx.clearRect(0, 0, w, h);
    if (!values || !values.length) return;
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var range = max - min || 1;
    var pts = values.map(function(v, i) {
      return [
        pad + (i / Math.max(values.length - 1, 1)) * (w - pad * 2),
        (h - pad) - ((v - min) / range) * (h - pad * 2)
      ];
    });
    // Fill area under line
    ctx.beginPath();
    ctx.moveTo(pts[0][0], h - pad);
    pts.forEach(function(p) { ctx.lineTo(p[0], p[1]); });
    ctx.lineTo(pts[pts.length - 1][0], h - pad);
    ctx.closePath();
    ctx.fillStyle = color + '22';
    ctx.fill();
    // Line
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    pts.forEach(function(p, i) { i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]); });
    ctx.stroke();
    // Last-point dot (current week)
    var lp = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(lp[0], lp[1], 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawRadar(canvas, scores, labels) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var cx = w / 2, cy = h / 2;
    var r = Math.min(cx, cy) - 40;
    var n = scores.length;
    var angle = function(i) { return (i * 2 * Math.PI / n) - Math.PI / 2; };
    ctx.clearRect(0, 0, w, h);
    // Grid rings
    [0.25, 0.5, 0.75, 1].forEach(function(ring) {
      ctx.beginPath();
      for (var i = 0; i < n; i++) {
        var x = cx + r * ring * Math.cos(angle(i));
        var y = cy + r * ring * Math.sin(angle(i));
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    // Axis lines
    for (var i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i)));
      ctx.strokeStyle = '#cbd5e1';
      ctx.stroke();
    }
    // Score polygon
    ctx.beginPath();
    scores.forEach(function(s, i) {
      var x = cx + r * s * Math.cos(angle(i));
      var y = cy + r * s * Math.sin(angle(i));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(8,145,178,0.15)';
    ctx.fill();
    ctx.strokeStyle = '#0891b2';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Vertex dots
    scores.forEach(function(s, i) {
      ctx.beginPath();
      ctx.arc(cx + r * s * Math.cos(angle(i)), cy + r * s * Math.sin(angle(i)), 4, 0, Math.PI * 2);
      ctx.fillStyle = '#0891b2';
      ctx.fill();
    });
    // Labels
    ctx.fillStyle = '#334155';
    ctx.font = '11px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    labels.forEach(function(label, i) {
      var x = cx + (r + 26) * Math.cos(angle(i));
      var y = cy + (r + 26) * Math.sin(angle(i));
      ctx.fillText(label, x, y);
    });
  }

  // ── Trends Panel ────────────────────────────────────────────────
  function renderTrends() {
    var trends = data.trends;
    var configs = [
      { key: 'avgTurnDepth',  label: 'Avg Turn Depth',   color: '#0891b2', fmt: function(v){ return v.toFixed(1); } },
      { key: 'errorRate',     label: 'Error Rate',        color: '#ef4444', fmt: function(v){ return (v*100).toFixed(0)+'%'; } },
      { key: 'toolDiversity', label: 'Tool Diversity',    color: '#8b5cf6', fmt: function(v){ return v.toFixed(1)+' tools'; } },
      { key: 'avgWasteScore', label: 'Avg Waste Score',   color: '#f59e0b', fmt: function(v){ return v.toFixed(1); } },
    ];
    var grid = document.getElementById('trends-grid');
    configs.forEach(function(cfg) {
      var values = trends.map(function(t) { return t[cfg.key]; });
      var latest = values[values.length - 1] || 0;
      var card = document.createElement('div');
      card.className = 'spark-card';
      var canvas = document.createElement('canvas');
      canvas.width = 200; canvas.height = 60;
      canvas.className = 'spark-canvas';
      card.innerHTML =
        '<div class="spark-label">' + cfg.label + '</div>' +
        '<div class="spark-value">' + cfg.fmt(latest) + '</div>';
      card.appendChild(canvas);
      if (trends.length) {
        var first = trends[0].week, last = trends[trends.length-1].week;
        var range = document.createElement('div');
        range.className = 'spark-weeks';
        range.textContent = first + ' \u2192 ' + last;
        card.appendChild(range);
      }
      grid.appendChild(card);
      drawSparkline(canvas, values, cfg.color);
    });
  }

  // ── Fingerprint Panel ───────────────────────────────────────────
  function renderFingerprint() {
    var fp = data.fingerprint;
    var axes = ['Autonomy', 'Breadth', 'Iteration', 'Tool Diversity', 'Output Density'];
    var scores = [fp.autonomy, fp.breadth, fp.iteration, fp.toolDiversity, fp.outputDensity];
    var canvas = document.getElementById('radar-canvas');
    drawRadar(canvas, scores, axes);
    var sessions = data.current.sessions;
    var avgTurnDepth = sessions.length ? (sessions.reduce(function(s,f){return s+f.turnDepth;},0)/sessions.length).toFixed(1) : '0';
    var allProjects = new Set(sessions.map(function(s){return s.projectName;}));
    var avgWaste = sessions.length ? (sessions.reduce(function(s,f){return s+f.wasteScore;},0)/sessions.length).toFixed(1) : '0';
    var allTools = new Set(sessions.flatMap ? sessions.flatMap(function(s){return s.toolsUsed;}) : []);
    var avgFiles = sessions.length ? (sessions.reduce(function(s,f){return s+(f.filesTouched||[]).length;},0)/sessions.length).toFixed(1) : '0';
    var descs = [
      'Autonomy: avg ' + avgTurnDepth + ' turns per session (higher = you let it run longer)',
      'Breadth: ' + allProjects.size + ' distinct projects this period',
      'Iteration: avg waste score ' + avgWaste + '/10 (lower is cleaner)',
      'Tool diversity: ' + allTools.size + ' unique tools used this period',
      'Output density: avg ' + avgFiles + ' files touched per session',
    ];
    var list = document.getElementById('fp-descriptions');
    descs.forEach(function(d) {
      var li = document.createElement('li');
      li.textContent = d;
      list.appendChild(li);
    });
  }

  // ── Timeline Panel ──────────────────────────────────────────────
  function wasteColor(score) {
    if (score <= 1) return '#22c55e';
    if (score <= 4) return '#f59e0b';
    return '#ef4444';
  }

  function renderTimeline() {
    var sessions = data.current.sessions;
    var projectSet = {};
    sessions.forEach(function(s) { projectSet[s.projectName] = true; });
    var projects = Object.keys(projectSet);
    var dates = sessions.map(function(s){ return s.date; }).sort();
    var minMs = dates.length ? new Date(dates[0]).getTime() : Date.now();
    var maxMs = dates.length ? new Date(dates[dates.length-1]).getTime() : Date.now();
    var span = Math.max(maxMs - minMs, 1);
    var container = document.getElementById('timeline-rows');
    projects.forEach(function(proj) {
      var row = document.createElement('div');
      row.className = 'tl-row';
      var label = document.createElement('div');
      label.className = 'tl-label';
      label.textContent = proj;
      var track = document.createElement('div');
      track.className = 'tl-track';
      sessions.filter(function(s){ return s.projectName === proj; }).forEach(function(s) {
        var dot = document.createElement('div');
        dot.className = 'tl-dot';
        var pct = ((new Date(s.date).getTime() - minMs) / span) * 100;
        var size = 8 + Math.min(s.turnDepth || 0, 8) * 2;
        dot.style.left = pct + '%';
        dot.style.width = size + 'px';
        dot.style.height = size + 'px';
        dot.style.background = wasteColor(s.wasteScore || 0);
        dot.style.marginTop = '-' + (size/2) + 'px';
        dot.title = s.date + ' \u00b7 ' + s.firstUserMessage.slice(0, 80);
        dot.addEventListener('click', (function(sid) {
          return function() {
            showTab('cards');
            setTimeout(function() {
              var card = document.getElementById('card-' + sid);
              if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.classList.add('highlight');
                setTimeout(function(){ card.classList.remove('highlight'); }, 2000);
              }
            }, 60);
          };
        })(s.sessionId));
        track.appendChild(dot);
      });
      row.appendChild(label);
      row.appendChild(track);
      container.appendChild(row);
    });
  }

  // ── Session Cards Panel ─────────────────────────────────────────
  function fmtDuration(ms) {
    if (!ms || ms < 1000) return '\u2014';
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    return Math.floor(s/60) + 'm ' + (s%60) + 's';
  }

  function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function renderCards() {
    var sessions = data.current.sessions.slice().sort(function(a,b){ return b.date.localeCompare(a.date); });
    var container = document.getElementById('cards-list');
    sessions.forEach(function(s) {
      var card = document.createElement('div');
      card.className = 'sess-card';
      card.id = 'card-' + s.sessionId;
      var wasteBadge = (s.wasteScore || 0) >= 3
        ? '<span class="waste-badge">\u26a0 waste ' + s.wasteScore + '</span>' : '';
      var toolPills = (s.toolsUsed || []).map(function(t){ return '<span class="tool-pill">' + esc(t) + '</span>'; }).join('');
      var fileList = (s.filesTouched || []).length
        ? '<div class="detail-row"><strong>Files:</strong><ul class="detail-list">' +
          s.filesTouched.map(function(f){ return '<li>' + esc(f) + '</li>'; }).join('') +
          '</ul></div>' : '';
      var errList = (s.errorSnippets || []).length
        ? '<div class="detail-row"><strong>Errors:</strong><ul class="detail-list">' +
          s.errorSnippets.map(function(e){ return '<li>' + esc(e) + '</li>'; }).join('') +
          '</ul></div>' : '';
      var mc = s.messageCounts || { user: 0, assistant: 0 };
      card.innerHTML =
        '<div class="card-header" onclick="this.parentElement.classList.toggle(\'open\')">' +
          '<div class="card-meta"><span class="card-date">' + esc(s.date) + '</span>' +
          '<span class="card-project">' + esc(s.projectName) + '</span>' + wasteBadge + '</div>' +
          '<div class="card-msg">' + esc(s.firstUserMessage.slice(0, 120)) + '</div>' +
          '<div class="card-tools">' + toolPills + '</div>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="detail-row"><strong>Turns:</strong> ' + (s.turnDepth||0) +
          ' &nbsp;&middot;&nbsp; <strong>Duration:</strong> ' + fmtDuration(s.duration) + '</div>' +
          '<div class="detail-row"><strong>Messages:</strong> ' + mc.user + ' user &nbsp;&middot;&nbsp; ' + mc.assistant + ' assistant</div>' +
          fileList + errList +
        '</div>';
      container.appendChild(card);
    });
  }

  // ── Init ────────────────────────────────────────────────────────
  showTab('trends');
  renderTrends();
  renderFingerprint();
  renderTimeline();
  renderCards();
})();
`
```

- [ ] **Step 2: Build to verify compilation**

```bash
npm run build 2>&1
```

Expected: builds cleanly

- [ ] **Step 3: Commit**

```bash
git add src/spa.ts
git commit -m "feat(spa): full client-side SPA script (tabs, sparklines, radar, timeline, cards)"
```

---

## Task 6 — Restructure reporter.ts

**Files:**
- Modify: `src/reporter.ts`

Replace the existing file entirely. The new `renderReport` takes `InsightsData` instead of `InsightReport`. `saveAndOpenReport` now loads history, computes fingerprint + trends, builds `InsightsData`, and passes it to `renderReport`.

- [ ] **Step 1: Replace src/reporter.ts**

```typescript
// src/reporter.ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { InsightReport, InsightsData } from './types.js'
import { readHistory, appendToHistory, loadPending, deletePending } from './history.js'
import { computeFingerprint, computeTrends } from './compute.js'
import { SPA_SCRIPT } from './spa.js'

function getInsightsDir(): string {
  return path.join(
    process.env.OPENCODE_DATA_DIR ?? path.join(os.homedir(), '.local', 'share', 'opencode'),
    'insights'
  )
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/'/g, '&#39;')
}

export function renderReport(report: InsightReport, spaData: InsightsData): string {
  const date = report.generatedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
  const dataJson = JSON.stringify(spaData)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>opencode Insights \u2014 ${date}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',-apple-system,sans-serif;background:#f8fafc;color:#334155;line-height:1.6;padding:0}
    .top-bar{position:sticky;top:0;z-index:10;background:white;border-bottom:1px solid #e2e8f0;padding:12px 24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
    .top-title{font-weight:700;font-size:18px;color:#0f172a;margin-right:auto}
    .top-meta{font-size:12px;color:#64748b}
    .tab-btn{padding:6px 14px;border-radius:6px;border:1px solid #e2e8f0;background:white;font-size:13px;cursor:pointer;color:#64748b;font-family:inherit}
    .tab-btn.active{background:#0891b2;color:white;border-color:#0891b2;font-weight:600}
    .tab-btn:hover:not(.active){background:#f1f5f9}
    .panel{max-width:860px;margin:0 auto;padding:32px 24px;display:none}
    h2{font-size:18px;font-weight:600;color:#0f172a;margin-bottom:4px}
    .section-sub{font-size:13px;color:#64748b;margin-bottom:20px}
    /* Trends */
    .trends-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .spark-card{background:white;border:1px solid #e2e8f0;border-radius:10px;padding:16px}
    .spark-label{font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;margin-bottom:4px}
    .spark-value{font-size:22px;font-weight:700;color:#0f172a;margin-bottom:8px}
    .spark-canvas{display:block;width:100%;height:60px}
    .spark-weeks{font-size:10px;color:#94a3b8;margin-top:4px}
    /* Fingerprint */
    .fp-layout{display:flex;gap:32px;align-items:flex-start;flex-wrap:wrap}
    #radar-canvas{width:260px;height:260px;flex-shrink:0}
    #fp-descriptions{list-style:none;display:flex;flex-direction:column;gap:10px;flex:1;min-width:200px}
    #fp-descriptions li{font-size:13px;color:#475569;padding:10px 14px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px}
    /* Timeline */
    .tl-row{display:flex;align-items:center;gap:12px;margin-bottom:18px}
    .tl-label{width:120px;font-size:12px;font-weight:600;color:#475569;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .tl-track{flex:1;height:2px;background:#e2e8f0;position:relative}
    .tl-dot{position:absolute;top:50%;border-radius:50%;cursor:pointer;transition:transform .15s;transform:translateY(-50%)}
    .tl-dot:hover{transform:translateY(-50%) scale(1.4)}
    /* Cards */
    .sess-card{background:white;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:10px;overflow:hidden}
    .sess-card.highlight{border-color:#0891b2;box-shadow:0 0 0 3px rgba(8,145,178,.15)}
    .card-header{padding:14px 16px;cursor:pointer;user-select:none}
    .card-header:hover{background:#f8fafc}
    .card-meta{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}
    .card-date{font-size:11px;color:#64748b;font-weight:500}
    .card-project{font-size:12px;font-weight:600;color:#0891b2;background:#e0f2fe;padding:2px 7px;border-radius:4px}
    .waste-badge{font-size:11px;color:#92400e;background:#fef3c7;border:1px solid #f59e0b;padding:2px 7px;border-radius:4px}
    .card-msg{font-size:13px;color:#334155;margin-bottom:8px;line-height:1.5}
    .card-tools{display:flex;flex-wrap:wrap;gap:4px}
    .tool-pill{font-size:10px;background:#f1f5f9;color:#475569;padding:2px 7px;border-radius:4px;border:1px solid #e2e8f0}
    .card-body{display:none;padding:14px 16px;border-top:1px solid #f1f5f9;background:#fafafa}
    .open .card-body{display:block}
    .detail-row{font-size:13px;color:#475569;margin-bottom:8px}
    .detail-list{margin:4px 0 0 16px;font-size:12px;color:#334155}
    .detail-list li{margin-bottom:2px;font-family:monospace;font-size:11px}
    /* LLM synthesis section */
    .synthesis{background:white;border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin-bottom:24px}
    .glance{background:linear-gradient(135deg,#fef3c7,#fde68a);border:1px solid #f59e0b;border-radius:10px;padding:18px 22px;margin-bottom:20px}
    .glance-title{font-size:14px;font-weight:700;color:#92400e;margin-bottom:12px}
    .glance-line{font-size:13px;color:#78350f;margin-bottom:6px;line-height:1.6}
    @media(max-width:640px){.trends-grid{grid-template-columns:1fr}.fp-layout{flex-direction:column}#radar-canvas{width:100%;height:220px}}
  </style>
</head>
<body>
  <div class="top-bar">
    <div class="top-title">opencode Insights</div>
    <div class="top-meta">Last ${report.periodDays} days &nbsp;&middot;&nbsp; ${report.sessionCount} sessions &nbsp;&middot;&nbsp; ${date}</div>
    <button class="tab-btn" id="tab-trends">Trends</button>
    <button class="tab-btn" id="tab-fingerprint">Fingerprint</button>
    <button class="tab-btn" id="tab-timeline">Timeline</button>
    <button class="tab-btn" id="tab-cards">Sessions</button>
  </div>

  <!-- Trends Panel -->
  <div class="panel" id="panel-trends">
    <h2>Trends</h2>
    <p class="section-sub">Weekly averages over the last 12 weeks</p>
    <div class="trends-grid" id="trends-grid"></div>
  </div>

  <!-- Fingerprint Panel -->
  <div class="panel" id="panel-fingerprint">
    <h2>Your Fingerprint</h2>
    <p class="section-sub">90-day rolling profile across five dimensions</p>
    <div class="fp-layout">
      <canvas id="radar-canvas" width="260" height="260"></canvas>
      <ul id="fp-descriptions"></ul>
    </div>

    <h2 style="margin-top:32px">At a Glance</h2>
    <div class="glance" style="margin-top:12px">
      <div class="glance-title">Summary</div>
      <div class="glance-line"><strong>Working well:</strong> ${esc(report.atAGlance?.workingWell ?? '')}</div>
      <div class="glance-line"><strong>Hindering you:</strong> ${esc(report.atAGlance?.hindering ?? '')}</div>
      <div class="glance-line"><strong>Quick wins:</strong> ${esc(report.atAGlance?.quickWins ?? '')}</div>
    </div>
    <div class="synthesis">
      <p style="font-size:14px;color:#475569">${esc(report.behavioralProfile ?? report.workflowInsights?.behavioralProfile ?? '')}</p>
    </div>
  </div>

  <!-- Timeline Panel -->
  <div class="panel" id="panel-timeline">
    <h2>Project Timeline</h2>
    <p class="section-sub">Dot size = turn depth &nbsp;&middot;&nbsp; Color: <span style="color:#22c55e">&#9679;</span> clean &nbsp;<span style="color:#f59e0b">&#9679;</span> some waste &nbsp;<span style="color:#ef4444">&#9679;</span> high waste. Click a dot to open that session.</p>
    <div id="timeline-rows"></div>
  </div>

  <!-- Session Cards Panel -->
  <div class="panel" id="panel-cards">
    <h2>Sessions</h2>
    <p class="section-sub">Click a card to expand details</p>
    <div id="cards-list"></div>
  </div>

  <script>window.INSIGHTS_DATA = ${dataJson};</script>
  <script>${SPA_SCRIPT}</script>
</body>
</html>`
}

export function saveAndOpenReport(report: InsightReport): string {
  const insightsDir = getInsightsDir()
  fs.mkdirSync(insightsDir, { recursive: true })

  // Load facets saved by insights_get_data
  const pending = loadPending(insightsDir)
  const sessions = pending?.sessions ?? []
  const periodDays = pending?.periodDays ?? report.periodDays

  // Append to history (deduped)
  const runAt = new Date().toISOString()
  appendToHistory(insightsDir, { runAt, periodDays, sessions })
  deletePending(insightsDir)

  // Build InsightsData for the SPA
  const history = readHistory(insightsDir)
  const spaData: InsightsData = {
    current: { runAt, periodDays, sessions },
    history,
    fingerprint: computeFingerprint(history),
    trends: computeTrends(history),
  }

  // Render and write
  const timestamp = new Date().toISOString().replace(/:/g, '-').slice(0, 19)
  const outPath = path.join(insightsDir, `report-${timestamp}.html`)
  fs.writeFileSync(outPath, renderReport(report, spaData), 'utf-8')

  try {
    if (process.platform === 'win32') {
      Bun.spawn(['cmd', '/c', 'start', '', outPath])
    } else if (process.platform === 'darwin') {
      Bun.spawn(['open', outPath])
    } else {
      Bun.spawn(['xdg-open', outPath])
    }
  } catch { /* ignore if browser open fails */ }

  return outPath
}
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1
```

Expected: clean build, no errors

- [ ] **Step 3: Commit**

```bash
git add src/reporter.ts
git commit -m "feat(reporter): SPA HTML shell with INSIGHTS_DATA injection and history integration"
```

---

## Task 7 — Update plugin.ts to save/load pending facets

**Files:**
- Modify: `src/plugin.ts`

- [ ] **Step 1: Replace src/plugin.ts**

```typescript
// src/plugin.ts
import type { Plugin } from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin'
import * as os from 'node:os'
import * as path from 'node:path'
import { readSessionFacets } from './reader.js'
import { saveAndOpenReport } from './reporter.js'
import { savePending } from './history.js'
import type { InsightReport } from './types.js'

function getInsightsDir(): string {
  return path.join(
    process.env.OPENCODE_DATA_DIR ?? path.join(os.homedir(), '.local', 'share', 'opencode'),
    'insights'
  )
}

const REPORT_SCHEMA_DESC = `JSON string with these fields: generatedAt (ISO timestamp), periodDays (number), sessionCount (number), atAGlance ({workingWell, hindering, quickWins}), behavioralProfile (string), projects ([{name, sessionCount, description}]), topTools ([{name, count}]), workflowInsights ({strengths:[{title,detail}], frictionPoints:[{title,detail,examples:[]}], behavioralProfile}), codeQualityInsights ({recurringPatterns:[], recommendations:[]}), opencodeConfigSuggestions ([{description, rule}]), featureRecommendations ([{title, why}]). Write in second person. Cite specific project names, tool names, and error messages from the data.`

export const InsightsPlugin: Plugin = async () => {
  return {
    tool: {
      insights_get_data: tool({
        description: 'Read opencode session data and return compact per-session facets for analysis. Step 1 of 2: call this first to get the data, synthesize it into an InsightReport JSON, then ALWAYS call insights_save_report to render and open the HTML report \u2014 never skip the save step.',
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
          // Persist facets so insights_save_report can pick them up
          savePending(getInsightsDir(), facets, args.days)
          return JSON.stringify({
            periodDays: args.days,
            sessionCount: facets.length,
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
            report = JSON.parse(args.report_json) as InsightReport
          } catch (e) {
            return `Error: report_json is not valid JSON: ${e}`
          }
          const outPath = saveAndOpenReport(report)
          return `Report saved to ${outPath} and opened in browser.`
        },
      }),
    },
  }
}

export default InsightsPlugin
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1
```

Expected: clean build

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/plugin.ts
git commit -m "feat(plugin): save pending facets in get_data, load them in save_report"
```

---

## Task 8 — Smoke test end-to-end

- [ ] **Step 1: Run insights_get_data smoke test via opencode**

```bash
opencode run --dir . "Use the insights_get_data tool with days=30 and limit=5. Show me the raw result."
```

Expected: tool executes, returns JSON with `toolsUsed`, `turnDepth`, `wasteScore`, `filesTouched`, `duration` fields populated (non-empty for sessions that used tools)

- [ ] **Step 2: Verify .pending.json was created**

```bash
ls "$USERPROFILE/.local/share/opencode/insights/.pending.json" 2>/dev/null && echo "exists" || echo "missing"
```

Expected: `exists`

- [ ] **Step 3: Run full report generation**

```bash
opencode run --dir . "Generate a full insights report for the last 30 days, limit to 10 sessions."
```

Expected: LLM calls `insights_get_data` then `insights_save_report`, report opens in browser

- [ ] **Step 4: Verify history.json was created and pending was cleaned up**

```bash
ls "$USERPROFILE/.local/share/opencode/insights/"
```

Expected: `history.json` present, `.pending.json` absent, new `report-*.html` file present

- [ ] **Step 5: Final build + commit**

```bash
npm run build 2>&1
git add dist/index.js
git commit -m "build: rebuild dist after rich SPA implementation"
```
