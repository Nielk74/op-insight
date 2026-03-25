# opencode-insights Design Spec

**Date:** 2026-03-25
**Status:** Approved

## Overview

A tool that analyzes opencode session history from the local SQLite database and generates an interactive HTML report with workflow insights, code quality patterns, and ready-to-paste `opencode.json` config suggestions — equivalent to Claude Code's `/insights` command.

---

## Invocation

- **Standalone CLI:** `node dist/index.js --days <n>` (default: 30)
- **Slash command:** `/insights [days]` via `.opencode/commands/insights.md`, which calls the script via `!` bash execution
- `$ARGUMENTS` from the slash command is passed as the `--days` value

---

## Architecture

Pipeline of four isolated modules:

```
opencode.db (SQLite, read-only)
        │
        ▼
   [reader.ts]        Query & reconstruct Session[] objects
        │
        ▼
   [extractor.ts]     Per-session LLM facet extraction (with caching)
        │
        ▼
   [aggregator.ts]    Merge facets + single LLM synthesis call
        │
        ▼
   [reporter.ts]      Render InsightReport → HTML → open in browser
```

---

## Module Designs

### reader.ts

- Opens `$OPENCODE_DATA_DIR/opencode.db` (default: `~/.local/share/opencode/opencode.db`) in **read-only mode** via `better-sqlite3`
- Filters sessions by `time_created > now - days`
- Excludes the current session via `OPENCODE_SESSION_ID` env var (set by opencode when running as a slash command; omitted when running standalone)
- Joins `session`, `message`, and `part` tables; reassembles into `Session[]`
- Error handling: DB not found → clear error; corrupt JSON rows → skip with warning

**Session type:**
```ts
type Session = {
  id: string
  projectId: string
  createdAt: number
  messages: Array<{
    role: 'user' | 'assistant'
    parts: Array<{ type: string; content: string }>
  }>
}
```

### extractor.ts

Processes each session into a structured `Facet` via an LLM call.

**Chunking:** sessions > 25,000 chars are split → each chunk summarized → facet extracted from combined summaries.

**Cache:** `~/.local/share/opencode/insights-cache/<session-id>.json`
- Valid if cache `mtime >= session.updatedAt`
- On hit: load from disk, skip LLM call
- On miss: call LLM, write cache

**Facet type:**
```ts
type Facet = {
  sessionId: string
  projectName: string
  summary: string
  toolsUsed: string[]
  repeatedInstructions: string[]
  frictionPoints: string[]
  codeQualityPatterns: string[]
  workflowPatterns: string[]
}
```

### aggregator.ts

- Merges all `Facet[]` into a single JSON payload
- Makes one LLM synthesis call → `InsightReport`

**InsightReport type:**
```ts
type InsightReport = {
  generatedAt: string
  periodDays: number
  sessionCount: number
  projects: Array<{
    name: string
    sessionCount: number
    description: string
  }>
  workflowInsights: {
    strengths: string[]
    frictionPoints: string[]
    behavioralProfile: string
  }
  codeQualityInsights: {
    recurringPatterns: string[]
    recommendations: string[]
  }
  opencodeConfigSuggestions: Array<{
    description: string
    rule: string
  }>
  featureRecommendations: string[]
}
```

### reporter.ts

- Renders `InsightReport` into a self-contained HTML file (inline CSS + JS, no external deps)
- Sections: Projects · Workflow Insights · Code Quality · Config Suggestions · Feature Recommendations
- Each config suggestion has a **Copy** button (Clipboard API)
- Saved to `~/.local/share/opencode/insights/report.html`
- Auto-opened via platform-appropriate command (`start` on Windows, `open` on macOS, `xdg-open` on Linux)

---

## LLM Provider

- Reads `~/.config/opencode/config.json` to resolve the active provider, model, and API key
- **No fallback** — if config is unreadable or provider cannot be resolved, fail with a clear error message

---

## Progress Output

Printed to **stderr** (not stdout):
```
Reading sessions from opencode.db...  (12 sessions found)
Extracting facets...  (8 cached, 4 new)
Synthesizing report...
Report saved to ~/.local/share/opencode/insights/report.html
```

---

## File Structure

```
op-insight/
├── src/
│   ├── index.ts              # CLI entry point, --days flag
│   ├── reader.ts             # SQLite reader (better-sqlite3, read-only)
│   ├── extractor.ts          # Per-session facet extraction + caching
│   ├── aggregator.ts         # Facet merging + LLM synthesis
│   └── reporter.ts           # HTML report generation + browser open
├── templates/
│   └── report.html.ts        # HTML template as TS string
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-03-25-opencode-insights-design.md
├── package.json
├── tsconfig.json
└── .opencode/
    └── commands/
        └── insights.md       # Slash command
```

---

## Key Dependencies

- `better-sqlite3` — read-only SQLite access
- `typescript`, `tsx` or `esbuild` — build tooling
- LLM SDK resolved at runtime from opencode config (e.g. `@anthropic-ai/sdk`, `openai`)
