# Rich Report SPA — Design Spec

**Date:** 2026-03-26
**Plugin:** opencode-insights
**Mode:** on-demand, embedded plugin, zero server

---

## Goal

Transform the current one-shot static HTML report into a self-contained SPA that accumulates history across runs and provides four interconnected views: trends, personal fingerprint, project timeline, and drillable session cards. No server, no CDN, no dependencies — works offline forever.

---

## Pre-implementation Step

Tag the current working version before touching any code:

```bash
git tag v$(node -p "require('./package.json').version")
```

---

## Architecture

### Storage

```
~/.local/share/opencode/insights/
  history.json                    ← append-only, all-time session facets
  report-YYYY-MM-DDTHH-MM-SS.html ← self-contained SPA, one per run
```

**`history.json`** accumulates one entry per report run:

```json
[
  {
    "runAt": "2026-03-26T14:30:00Z",
    "periodDays": 30,
    "sessions": [ /* ExtendedSessionFacet[] */ ]
  }
]
```

De-duplication: when appending a new run, any `sessionId` already present in history is skipped. History never double-counts sessions.

### Data flow

```
opencode DB
  └── readSessionFacets() → ExtendedSessionFacet[]
        └── appendToHistory(history.json)
              └── renderReport(current facets + full history) → report-*.html
```

The HTML file receives all data baked in as a single inline script:

```html
<script>const INSIGHTS_DATA = { current: { runAt, periodDays, sessions }, history: [...] }</script>
```

---

## Extended SessionFacet

New fields added to the existing `SessionFacet` type:

| Field | Type | Description |
|-------|------|-------------|
| `duration` | `number` | ms between first and last message timestamp |
| `wasteScore` | `number` | 0–10, consecutive same-tool error retries |
| `messageCounts` | `{ user: number; assistant: number }` | role breakdown |
| `filesTouched` | `string[]` | paths from Edit/Write/Read tool call inputs |
| `turnDepth` | `number` | count of assistant step-finish parts |

**wasteScore algorithm:** scan parts in order; when the same `tool` appears in ≥2 consecutive `type==='tool'` parts and at least one has an error keyword in its output, increment. Cap at 10.

**filesTouched extraction:** parts where `type === 'tool'` and `tool` is `edit`, `write`, or `read` → extract `state.input.file_path` (or `state.input.path`).

---

## Fingerprint Axes (90-day rolling window)

| Axis | Computation |
|------|-------------|
| **Autonomy** | avg `turnDepth` normalized to 0–1 (capped at 10 turns = 1.0) |
| **Breadth** | unique projects per week, normalized |
| **Iteration** | `1 - (avg wasteScore / 10)` — low waste = high score |
| **Tool diversity** | unique tools used / total distinct tools seen in history |
| **Output density** | avg `filesTouched.length` per session, normalized (capped at 10) |

---

## Report SPA — Four Panels

### Navigation
Sticky top bar with four tab buttons. Header shows: period, session count, generated-at timestamp.

### 1. Trends (2×2 sparkline grid)
Four mini canvas charts showing **weekly averages** over the past 12 weeks:
- Avg session depth (turnDepth)
- Error rate (sessions with wasteScore > 0 / total)
- Tool diversity (unique tools per week)
- Avg waste score

Current week highlighted with a distinct color. Hover shows week label + value tooltip.

### 2. Fingerprint (pentagon radar)
Canvas-drawn pentagon radar, five axes. Each axis labeled. Score shown as a filled polygon.
Below the chart: one sentence per axis explaining the score in plain language, citing actual numbers.
("You let sessions run deep — avg 4.2 turns. Consider breaking tasks into shorter sessions.")

### 3. Project Timeline
One horizontal row per project. X axis = date (current period).
Each session = a dot: **size** proportional to `turnDepth`, **color** = waste score gradient (green → amber → red).
Clicking a dot opens that session's card (jumps to panel 4 and expands it).

### 4. Session Cards
Scrollable list, sorted date descending. Each collapsed card shows:
- Date, project name
- First user message (truncated to 120 chars)
- Tool pills (one per unique tool)
- Waste badge (shown if wasteScore ≥ 3)

Clicking expands the card to show:
- All tools used (with counts)
- Files touched (list)
- Error snippets (up to 5)
- Turn depth + duration (human-readable: "4 turns · 3m 20s")

---

## Implementation Notes

- All charts use **vanilla Canvas API** — no Chart.js, no D3, no external dependencies.
- The entire JS for the SPA lives in a single `<script>` block inside the rendered HTML template in `reporter.ts`.
- `history.json` is read and written in `saveAndOpenReport()` before rendering.
- The `KNOWN_TOOLS` constant can be removed (already unused after the toolsUsed fix).
- New file `src/history.ts` handles read/append/dedup of `history.json`.

---

## Files Changed

| File | Change |
|------|--------|
| `src/types.ts` | Add `ExtendedSessionFacet` extending `SessionFacet` |
| `src/reader.ts` | Extract new fields: `duration`, `wasteScore`, `messageCounts`, `filesTouched`, `turnDepth` |
| `src/history.ts` | New — read/append/dedup `history.json` |
| `src/reporter.ts` | Inject `INSIGHTS_DATA`, add full SPA with four panels |
| `src/plugin.ts` | Pass extended facets through; no interface change |

---

## Out of Scope

- Live/auto-refresh (no server)
- Team/shared dashboards
- Cost tracking
- Export formats other than HTML
