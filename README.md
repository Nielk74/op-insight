# opencode-insights

A native [opencode](https://opencode.ai) plugin that generates a rich, interactive HTML report from your session history. Session data is read locally; a two-agent LLM pipeline runs inside the plugin to synthesize the narrative sections.

## Installation

> **Config file location**
> - Windows: `C:\Users\<you>\.config\opencode\config.json`
> - macOS/Linux: `~/.config/opencode/config.json`
>
> Create it if it doesn't exist yet.

### Option 1: From npm (recommended)

```bash
npm install -g opencode-insights
```

Add to your opencode config:

```json
{
  "plugin": ["opencode-insights"]
}
```

### Option 2: From source

```bash
git clone https://github.com/Nielk74/op-insight
cd op-insight
npm install
npm run build
```

Add the absolute path to your opencode config:

```json
{
  "plugin": ["C:\\absolute\\path\\to\\op-insight"]
}
```

opencode loads the plugin automatically on next startup.

## Usage

Type `/insights` in any opencode session. The LLM will automatically run the full flow — no extra prompting needed.

```
/insights
/insights 7
/insights 7 --errors
/insights 14 --topic typescript
/insights 30 --limit 20
```

You can also just say: *"generate my insights report for the last 30 days"*

### Arguments

| Argument | Description |
|----------|-------------|
| `days` | Number of past days to include (default: 30) |
| `--limit N` | Cap at N most recent sessions (faster) |
| `--topic <keyword>` | Only sessions whose content matches the keyword |
| `--errors` | Only sessions that had tool errors |

## Report Tabs

The generated HTML report opens in your browser with five tabs:

- **Summary** — at-a-glance cards (what's working, what's hindering, quick wins), behavioral profile, impressive things you did, where things go wrong (with concrete examples), and personalized features & practices to try with copy-pasteable AGENTS.md and opencode.json snippets derived from your actual patterns
- **Trends** — weekly sparklines for sessions, tokens, waste score, tool errors, and a time-of-day usage chart
- **Fingerprint** — radar chart of your coding style axes (exploration, interruptions, waste, deep work, tool diversity)
- **Timeline** — dot-plot of sessions per project over the selected time window
- **Sessions** — expandable cards for each session with tool usage, file counts, and turn depth

## History Management

The plugin keeps a `history.json` of past runs to power the Trends and Fingerprint tabs. Two tools let you manage it:

- **`insights_list_runs`** — list all stored runs with timestamps and session counts
- **`insights_delete_run`** — remove a specific run by its `runAt` timestamp

Example: *"list my insights runs"* or *"delete the insights run from 2026-03-20"*

## How It Works

The plugin exposes tools the LLM calls automatically:

1. **`insights_get_data`** — reads opencode's SQLite session DB, extracts per-session facets (duration, tools used, files touched, waste score, turn depth, hour of day), then runs a two-agent synthesis pipeline:
   - **Summarizer** — writes one goal-oriented sentence per session
   - **Aggregator** — produces the full narrative report (at-a-glance, behavioral profile, impressive things, friction patterns, personalized recommendations). Before generating advice, it reads your project's `opencode.json` and any markdown files listed in its `instructions` field, so recommendations account for what you've already configured and focus on genuine gaps.
2. **`insights_save_report`** — takes the `InsightReport` JSON, renders the HTML report, saves it to `~/.local/share/opencode/insights/`, and opens it in your browser
