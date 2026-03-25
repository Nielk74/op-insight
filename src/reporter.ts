import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import type { InsightReport, ConfigSuggestion } from './types.js'

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderList(items: string[]): string {
  if (items.length === 0) return '<p><em>None identified.</em></p>'
  return `<ul>${items.map((i) => `<li>${escape(i)}</li>`).join('')}</ul>`
}

function renderConfigSuggestion(s: ConfigSuggestion, idx: number): string {
  return `
    <div class="suggestion">
      <p>${escape(s.description)}</p>
      <pre id="rule-${idx}"><code>${escape(s.rule)}</code></pre>
      <button onclick="navigator.clipboard.writeText(document.getElementById('rule-${idx}').innerText)">Copy</button>
    </div>`
}

export function renderReport(report: InsightReport): string {
  const projectRows = report.projects
    .map(
      (p) =>
        `<tr><td>${escape(p.name)}</td><td>${p.sessionCount}</td><td>${escape(p.description)}</td></tr>`
    )
    .join('')

  const configSuggestions = report.opencodeConfigSuggestions
    .map((s, i) => renderConfigSuggestion(s, i))
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>opencode Insights — ${report.generatedAt.slice(0, 10)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
    h1 { border-bottom: 2px solid #0066cc; padding-bottom: 8px; }
    h2 { color: #0066cc; margin-top: 40px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { text-align: left; padding: 8px 12px; border: 1px solid #ddd; }
    th { background: #f5f5f5; }
    .suggestion { background: #f9f9f9; border: 1px solid #ddd; border-radius: 6px; padding: 16px; margin: 12px 0; }
    pre { background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 4px; overflow-x: auto; }
    button { margin-top: 8px; padding: 6px 14px; background: #0066cc; color: white; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #0052a3; }
    .meta { color: #666; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>opencode Insights</h1>
  <p class="meta">Generated: ${escape(report.generatedAt)} &nbsp;|&nbsp; Period: last ${report.periodDays} days &nbsp;|&nbsp; Sessions: ${report.sessionCount}</p>

  <h2>Projects</h2>
  <table>
    <thead><tr><th>Project</th><th>Sessions</th><th>Description</th></tr></thead>
    <tbody>${projectRows}</tbody>
  </table>

  <h2>Workflow Insights</h2>
  <h3>Strengths</h3>${renderList(report.workflowInsights.strengths)}
  <h3>Friction Points</h3>${renderList(report.workflowInsights.frictionPoints)}
  <h3>Behavioral Profile</h3><p>${escape(report.workflowInsights.behavioralProfile)}</p>

  <h2>Code Quality</h2>
  <h3>Recurring Patterns</h3>${renderList(report.codeQualityInsights.recurringPatterns)}
  <h3>Recommendations</h3>${renderList(report.codeQualityInsights.recommendations)}

  <h2>opencode Config Suggestions</h2>
  ${configSuggestions || '<p><em>None identified.</em></p>'}

  <h2>Feature Recommendations</h2>
  ${renderList(report.featureRecommendations)}
</body>
</html>`
}

export function saveAndOpenReport(report: InsightReport): string {
  const dataDir = process.env.OPENCODE_DATA_DIR
    ?? path.join(os.homedir(), '.local', 'share', 'opencode')
  const outDir = path.join(dataDir, 'insights')
  const outPath = path.join(outDir, 'report.html')

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outPath, renderReport(report), 'utf-8')

  const opener =
    process.platform === 'win32' ? `start "" "${outPath}"` :
    process.platform === 'darwin' ? `open "${outPath}"` :
    `xdg-open "${outPath}"`

  try { execSync(opener) } catch { /* ignore if browser open fails */ }

  return outPath
}
