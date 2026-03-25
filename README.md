# op-insight

`/insights` for [opencode](https://opencode.ai) — analyze your session history and generate an interactive HTML report with workflow insights, code quality patterns, and ready-to-paste config suggestions.

Inspired by Claude Code's `/insights` command.

![Report preview showing project summary, workflow insights, and config suggestions](https://github.com/Nielk74/op-insight/raw/master/docs/preview-placeholder.png)

---

## What it does

op-insight reads your local opencode SQLite database, runs your session history through your configured LLM, and produces a self-contained HTML report covering:

- **Projects** — what you worked on and how your time was distributed
- **Workflow insights** — strengths, friction points, and a behavioral profile of how you prompt and iterate
- **Code quality patterns** — recurring bug types and antipatterns across sessions
- **Config suggestions** — ready-to-paste `opencode.json` rules generated from instructions you repeat
- **Feature recommendations** — opencode capabilities you're not yet using

All analysis runs locally using your own LLM provider. Nothing is sent to a third-party service.

---

## Requirements

- [Node.js](https://nodejs.org) v20+
- [opencode](https://opencode.ai) installed and used at least once (so a database exists)
- An API key for your configured LLM provider (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`)

---

## Installation

```bash
git clone https://github.com/Nielk74/op-insight.git
cd op-insight
npm install
npm run build
```

---

## Usage

### Standalone CLI

```bash
node dist/index.js
# or with a custom time window:
node dist/index.js --days 90
```

The report is saved to `~/.local/share/opencode/insights/report.html` and opens automatically in your browser.

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--days N` | `30` | Number of days of session history to analyze |

### As an opencode slash command

1. Open `.opencode/commands/insights.md` and update the path on the last line to point to your local `dist/index.js`:

   ```
   !node /absolute/path/to/op-insight/dist/index.js --days ${ARGUMENTS:-30}
   ```

2. Reload opencode. You can now run `/insights` or `/insights 90` directly from the chat.

---

## How it works

```
opencode.db (SQLite, read-only)
        │
        ▼
   reader.ts       Query sessions filtered by --days, exclude current session
        │
        ▼
   extractor.ts    Per-session LLM call → structured Facet (cached on disk)
        │
        ▼
   aggregator.ts   Single LLM synthesis call → InsightReport
        │
        ▼
   reporter.ts     Render self-contained HTML → open in browser
```

**Caching:** Each session's facet is cached at `~/.local/share/opencode/insights-cache/<session-id>.json`. Re-runs only process sessions that have been updated since the last run, making subsequent runs significantly faster.

**LLM provider:** op-insight reads your opencode config at `~/.config/opencode/config.json` to pick the active provider and model. Supported providers: `anthropic`, `openai`. The corresponding API key must be set as an environment variable (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`).

**Privacy:** Your session data never leaves your machine except through your own LLM API calls, using your own API key.

---

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `OPENCODE_DATA_DIR` | `~/.local/share/opencode` | Override opencode's data directory |
| `OPENCODE_SESSION_ID` | *(set by opencode)* | Current session ID to exclude from analysis |
| `ANTHROPIC_API_KEY` | — | Required if using an Anthropic model |
| `OPENAI_API_KEY` | — | Required if using an OpenAI model |

---

## Development

```bash
npm test          # run tests
npm run test:watch  # watch mode
npm run build     # bundle to dist/index.js
npm run dev       # run directly with tsx (no build needed)
```

**Project structure:**

```
src/
  config.ts      Read opencode config, resolve LLM provider
  reader.ts      SQLite session reader (read-only, injectable for tests)
  extractor.ts   Per-session facet extraction with disk cache
  aggregator.ts  Merge facets → single LLM synthesis call
  reporter.ts    Render InsightReport → self-contained HTML
  llm.ts         Thin LLM wrapper (Anthropic + OpenAI)
  index.ts       CLI entry point
tests/           Unit tests (vitest, in-memory SQLite for reader tests)
```

---

## License

MIT
