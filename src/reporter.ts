import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { InsightReport, ConfigSuggestion } from './types.js'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;')
}

function bar(label: string, value: number, max: number, color: string): string {
  const pct = max > 0 ? (value / max) * 100 : 0
  return `<div class="bar-row">
  <div class="bar-label">${esc(label)}</div>
  <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
  <div class="bar-value">${value}</div>
</div>`
}

function projectCards(report: InsightReport): string {
  return report.projects.map((p) => `
    <div class="project-area">
      <div class="area-header">
        <span class="area-name">${esc(p.name)}</span>
        <span class="area-count">~${p.sessionCount} session${p.sessionCount !== 1 ? 's' : ''}</span>
      </div>
      <div class="area-desc">${esc(p.description)}</div>
    </div>`).join('')
}

function strengthCards(strengths: InsightReport['workflowInsights']['strengths']): string {
  if (!strengths?.length) return '<p class="empty">None identified.</p>'
  return strengths.map((s) => `
    <div class="big-win">
      <div class="big-win-title">${esc(s.title)}</div>
      <div class="big-win-desc">${esc(s.detail)}</div>
    </div>`).join('')
}

function frictionCards(fps: InsightReport['workflowInsights']['frictionPoints']): string {
  if (!fps?.length) return '<p class="empty">None identified.</p>'
  return fps.map((f) => `
    <div class="friction-category">
      <div class="friction-title">${esc(f.title)}</div>
      <div class="friction-desc">${esc(f.detail)}</div>
      ${f.examples?.length ? `<ul class="friction-examples">${f.examples.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
    </div>`).join('')
}

function configSuggestion(s: ConfigSuggestion, idx: number): string {
  return `
    <div class="claude-md-item">
      <div style="flex:1">
        <div class="cmd-code" id="rule-${idx}">${esc(s.rule)}</div>
        <div class="cmd-why">${esc(s.description)}</div>
      </div>
      <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('rule-${idx}').innerText)">Copy</button>
    </div>`
}

function featureCards(features: InsightReport['featureRecommendations']): string {
  if (!features?.length) return '<p class="empty">None identified.</p>'
  return features.map((f) => `
    <div class="feature-card">
      <div class="feature-title">${esc(typeof f === 'string' ? f : f.title)}</div>
      ${typeof f !== 'string' && f.why ? `<div class="feature-oneliner">${esc(f.why)}</div>` : ''}
    </div>`).join('')
}

function toolBars(report: InsightReport): string {
  const tools = report.topTools ?? []
  if (!tools.length) return '<p class="empty">No tool data available.</p>'
  const max = tools[0]?.count ?? 1
  return tools.map((t) => bar(t.name, t.count, max, '#0891b2')).join('')
}

export function renderReport(report: InsightReport): string {
  const date = report.generatedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
  const topToolsMax = (report.topTools?.[0]?.count ?? 1)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>opencode Insights — ${date}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #f8fafc; color: #334155; line-height: 1.65; padding: 48px 24px; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 32px; font-weight: 700; color: #0f172a; margin-bottom: 8px; }
    h2 { font-size: 20px; font-weight: 600; color: #0f172a; margin-top: 48px; margin-bottom: 16px; }
    .subtitle { color: #64748b; font-size: 15px; margin-bottom: 32px; }
    .nav-toc { display: flex; flex-wrap: wrap; gap: 8px; margin: 24px 0 32px 0; padding: 16px; background: white; border-radius: 8px; border: 1px solid #e2e8f0; }
    .nav-toc a { font-size: 12px; color: #64748b; text-decoration: none; padding: 6px 12px; border-radius: 6px; background: #f1f5f9; transition: all 0.15s; }
    .nav-toc a:hover { background: #e2e8f0; color: #334155; }
    .stats-row { display: flex; gap: 24px; margin-bottom: 40px; padding: 20px 0; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; }
    .stat { text-align: center; }
    .stat-value { font-size: 24px; font-weight: 700; color: #0f172a; }
    .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; }
    .at-a-glance { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 1px solid #f59e0b; border-radius: 12px; padding: 20px 24px; margin-bottom: 32px; }
    .glance-title { font-size: 16px; font-weight: 700; color: #92400e; margin-bottom: 16px; }
    .glance-sections { display: flex; flex-direction: column; gap: 12px; }
    .glance-section { font-size: 14px; color: #78350f; line-height: 1.6; }
    .glance-section strong { color: #92400e; }
    .project-areas { display: flex; flex-direction: column; gap: 12px; margin-bottom: 32px; }
    .project-area { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    .area-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .area-name { font-weight: 600; font-size: 15px; color: #0f172a; }
    .area-count { font-size: 12px; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 4px; }
    .area-desc { font-size: 14px; color: #475569; line-height: 1.5; }
    .narrative { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
    .narrative p { margin-bottom: 12px; font-size: 14px; color: #475569; line-height: 1.7; }
    .narrative p:last-child { margin-bottom: 0; }
    .key-insight { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 16px; margin-top: 12px; font-size: 14px; color: #166534; }
    .big-wins { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
    .big-win { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; }
    .big-win-title { font-weight: 600; font-size: 15px; color: #166534; margin-bottom: 8px; }
    .big-win-desc { font-size: 14px; color: #15803d; line-height: 1.5; }
    .friction-categories { display: flex; flex-direction: column; gap: 16px; margin-bottom: 24px; }
    .friction-category { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 16px; }
    .friction-title { font-weight: 600; font-size: 15px; color: #991b1b; margin-bottom: 6px; }
    .friction-desc { font-size: 13px; color: #7f1d1d; margin-bottom: 10px; }
    .friction-examples { margin: 0 0 0 20px; font-size: 13px; color: #334155; }
    .friction-examples li { margin-bottom: 4px; }
    .claude-md-section { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
    .claude-md-item { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; padding: 10px 0; border-bottom: 1px solid #dbeafe; }
    .claude-md-item:last-child { border-bottom: none; }
    .cmd-code { background: white; padding: 8px 12px; border-radius: 4px; font-size: 12px; color: #1e40af; border: 1px solid #bfdbfe; font-family: monospace; display: block; white-space: pre-wrap; word-break: break-word; }
    .cmd-why { font-size: 12px; color: #64748b; margin-top: 4px; }
    .feature-card { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .feature-title { font-weight: 600; font-size: 15px; color: #0f172a; margin-bottom: 6px; }
    .feature-oneliner { font-size: 14px; color: #475569; }
    .charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 24px 0; }
    .chart-card { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    .chart-title { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; margin-bottom: 12px; }
    .bar-row { display: flex; align-items: center; margin-bottom: 6px; }
    .bar-label { width: 110px; font-size: 11px; color: #475569; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar-track { flex: 1; height: 6px; background: #f1f5f9; border-radius: 3px; margin: 0 8px; }
    .bar-fill { height: 100%; border-radius: 3px; }
    .bar-value { width: 32px; font-size: 11px; font-weight: 500; color: #64748b; text-align: right; }
    .copy-btn { background: #e2e8f0; border: none; border-radius: 4px; padding: 4px 8px; font-size: 11px; cursor: pointer; color: #475569; flex-shrink: 0; }
    .copy-btn:hover { background: #cbd5e1; }
    .empty { color: #94a3b8; font-size: 13px; }
    .section-intro { font-size: 14px; color: #64748b; margin-bottom: 16px; }
    @media (max-width: 640px) { .charts-row { grid-template-columns: 1fr; } .stats-row { justify-content: center; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>opencode Insights</h1>
    <p class="subtitle">Last ${report.periodDays} days &nbsp;|&nbsp; ${report.sessionCount} sessions analyzed &nbsp;|&nbsp; ${date}</p>

    <div class="at-a-glance">
      <div class="glance-title">At a Glance</div>
      <div class="glance-sections">
        <div class="glance-section"><strong>What&apos;s working:</strong> ${esc(report.atAGlance?.workingWell ?? '')}</div>
        <div class="glance-section"><strong>What&apos;s hindering you:</strong> ${esc(report.atAGlance?.hindering ?? '')}</div>
        <div class="glance-section"><strong>Quick wins to try:</strong> ${esc(report.atAGlance?.quickWins ?? '')}</div>
      </div>
    </div>

    <nav class="nav-toc">
      <a href="#section-work">What You Work On</a>
      <a href="#section-profile">How You Work</a>
      <a href="#section-wins">Strengths</a>
      <a href="#section-friction">Friction Points</a>
      <a href="#section-quality">Code Quality</a>
      <a href="#section-config">Config Suggestions</a>
      <a href="#section-features">Features to Try</a>
    </nav>

    <div class="stats-row">
      <div class="stat"><div class="stat-value">${report.sessionCount}</div><div class="stat-label">Sessions</div></div>
      <div class="stat"><div class="stat-value">${report.periodDays}</div><div class="stat-label">Days</div></div>
      <div class="stat"><div class="stat-value">${report.projects?.length ?? 0}</div><div class="stat-label">Projects</div></div>
      <div class="stat"><div class="stat-value">${report.workflowInsights?.frictionPoints?.length ?? 0}</div><div class="stat-label">Friction Areas</div></div>
    </div>

    <h2 id="section-work">What You Work On</h2>
    <div class="project-areas">
      ${projectCards(report)}
    </div>

    <div class="charts-row">
      <div class="chart-card">
        <div class="chart-title">Top Tools Used</div>
        ${toolBars(report)}
      </div>
      <div class="chart-card">
        <div class="chart-title">Friction Points Found</div>
        ${report.workflowInsights?.frictionPoints?.length
          ? report.workflowInsights.frictionPoints.map((f) => bar(f.title, f.examples?.length ?? 1, Math.max(...(report.workflowInsights.frictionPoints.map((fp) => fp.examples?.length ?? 1))), '#ef4444')).join('')
          : '<p class="empty">None identified.</p>'}
      </div>
    </div>

    <h2 id="section-profile">How You Work</h2>
    <div class="narrative">
      <p>${esc(report.behavioralProfile ?? report.workflowInsights?.behavioralProfile ?? '')}</p>
    </div>

    <h2 id="section-wins">Strengths</h2>
    <div class="big-wins">
      ${strengthCards(report.workflowInsights?.strengths ?? [])}
    </div>

    <h2 id="section-friction">Friction Points</h2>
    <div class="friction-categories">
      ${frictionCards(report.workflowInsights?.frictionPoints ?? [])}
    </div>

    <h2 id="section-quality">Code Quality Patterns</h2>
    <p class="section-intro">Recurring patterns and recommendations from your recent sessions.</p>
    <div class="narrative">
      <p><strong>Patterns observed:</strong></p>
      <ul style="margin: 8px 0 16px 20px; font-size:14px; color:#475569;">
        ${(report.codeQualityInsights?.recurringPatterns ?? []).map((p) => `<li style="margin-bottom:6px">${esc(p)}</li>`).join('')}
      </ul>
      <p><strong>Recommendations:</strong></p>
      <ul style="margin: 8px 0 0 20px; font-size:14px; color:#475569;">
        ${(report.codeQualityInsights?.recommendations ?? []).map((r) => `<li style="margin-bottom:6px">${esc(r)}</li>`).join('')}
      </ul>
    </div>

    <h2 id="section-config">opencode Config Suggestions</h2>
    ${report.opencodeConfigSuggestions?.length
      ? `<div class="claude-md-section">${report.opencodeConfigSuggestions.map((s, i) => configSuggestion(s, i)).join('')}</div>`
      : '<p class="empty">None identified.</p>'}

    <h2 id="section-features">Features to Try</h2>
    <p class="section-intro">opencode features you&apos;re not fully using yet.</p>
    ${featureCards(report.featureRecommendations ?? [])}

  </div>
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
