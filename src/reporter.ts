import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { exec } from 'child_process'
import type { InsightReport, InsightsData, HistoryEntry } from './types.js'
import { readHistory, appendToHistory, loadPending, deletePending } from './history.js'
import { computeFingerprint, computeTrends } from './compute.js'
import { SPA_SCRIPT } from './spa.js'

export function getInsightsDir(): string {
  const dir = path.join(os.homedir(), '.local', 'share', 'opencode', 'insights')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function renderReport(data: InsightsData): string {
  const date = data.current.runAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
  const dataJson = JSON.stringify(data)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>opencode insights — ${date}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3; min-height: 100vh; }
    nav { position: sticky; top: 0; background: #161b22; border-bottom: 1px solid #30363d; padding: 0 1rem; display: flex; align-items: center; gap: 1rem; z-index: 10; }
    nav h1 { font-size: .9rem; color: #8b949e; padding: .75rem 0; flex: 1; }
    nav button { background: none; border: none; color: #8b949e; padding: .75rem .5rem; cursor: pointer; font-size: .85rem; border-bottom: 2px solid transparent; }
    nav button.active { color: #58a6ff; border-bottom-color: #58a6ff; }
    .panel { display: none; padding: 1.5rem; max-width: 1100px; margin: 0 auto; }
    .panel.active { display: block; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem; margin-bottom: .75rem; cursor: pointer; }
    .card-header { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
    .card-body { display: none; margin-top: .75rem; border-top: 1px solid #30363d; padding-top: .75rem; }
    .card.open .card-body { display: block; }
    .pill { font-size: .7rem; background: #21262d; border: 1px solid #30363d; border-radius: 4px; padding: 2px 6px; }
    .waste-badge { font-size: .7rem; background: #da3633; border-radius: 4px; padding: 2px 6px; color: #fff; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .spark-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem; }
    .spark-label { font-size: .8rem; color: #8b949e; margin-bottom: .5rem; }
    .tl-row { display: flex; align-items: center; gap: .75rem; margin-bottom: .5rem; }
    .tl-label { font-size: .8rem; color: #8b949e; width: 140px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tl-track { flex: 1; position: relative; height: 24px; }
    .fp-desc { font-size: .85rem; color: #8b949e; margin-top: .5rem; line-height: 1.6; }
    .fp-desc li { margin-bottom: .25rem; list-style: none; }
    canvas { display: block; }
  </style>
</head>
<body>
  <nav>
    <h1 id="nav-title"></h1>
    <button onclick="showTab('trends')" id="tab-trends">Trends</button>
    <button onclick="showTab('fingerprint')" id="tab-fingerprint">Fingerprint</button>
    <button onclick="showTab('timeline')" id="tab-timeline">Timeline</button>
    <button onclick="showTab('cards')" id="tab-cards">Sessions</button>
  </nav>
  <div id="panel-trends" class="panel"></div>
  <div id="panel-fingerprint" class="panel"></div>
  <div id="panel-timeline" class="panel"></div>
  <div id="panel-cards" class="panel"></div>
  <script>const INSIGHTS_DATA = ${dataJson};</script>
  <script>${SPA_SCRIPT}</script>
</body>
</html>`
}

export function saveAndOpenReport(report: InsightReport): string {
  const insightsDir = getInsightsDir()

  const pending = loadPending(insightsDir)
  const sessions = pending?.sessions ?? []
  const periodDays = pending?.periodDays ?? report.periodDays

  const runAt = new Date().toISOString()
  const entry: HistoryEntry = { runAt, periodDays, sessions }

  appendToHistory(insightsDir, entry)
  const history = readHistory(insightsDir)
  const fingerprint = computeFingerprint(history)
  const trends = computeTrends(history)

  const data: InsightsData = { current: entry, history, fingerprint, trends }
  const html = renderReport(data)

  const timestamp = runAt.replace(/[:.]/g, '-').slice(0, 23)
  const outPath = path.join(insightsDir, `report-${timestamp}.html`)
  fs.writeFileSync(outPath, html, 'utf-8')

  try {
    if (process.platform === 'win32') {
      exec(`start "" "${outPath}"`)
    } else if (process.platform === 'darwin') {
      exec(`open "${outPath}"`)
    } else {
      exec(`xdg-open "${outPath}"`)
    }
  } catch { /* ignore if browser open fails */ }

  deletePending(insightsDir)

  return outPath
}
