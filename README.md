# opencode-insights

A native [opencode](https://opencode.ai) plugin that generates a rich insights report from your session history.

## Installation

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-insights"]
}
```

opencode will auto-install the plugin on next startup.

## Usage

Simply ask opencode to generate a report:

```
/insights
/insights 7
/insights 7 --errors
/insights 14 --topic typescript
/insights 30 --limit 20
```

Or just type: *"generate my insights report for the last 7 days"*

The plugin exposes two tools that the LLM uses automatically:
- **`insights_get_data`** — reads your session history from opencode's SQLite DB, extracts facets heuristically (no extra LLM calls)
- **`insights_save_report`** — renders the HTML report and opens it in your browser

## Options

| Argument | Description |
|----------|-------------|
| `days` | Number of past days to include (default: 30) |
| `--limit N` | Cap at N most recent sessions (faster) |
| `--topic <keyword>` | Only sessions whose content matches the keyword |
| `--errors` | Only sessions that had tool errors |

## Report Contents

- At-a-glance summary (what's working, what's hindering you, quick wins)
- Project breakdown with descriptions
- Top tools bar chart
- Workflow strengths and friction points with concrete examples
- Code quality patterns and recommendations
- opencode config suggestions (copy-pasteable JSON)
- Feature recommendations

## Development

```bash
git clone https://github.com/Nielk74/op-insight
cd op-insight
npm install
npm run build
```

To use a local version in opencode, add the absolute path to your `opencode.json`:

```json
{
  "plugin": ["/absolute/path/to/op-insight"]
}
```