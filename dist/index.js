// src/reader.ts
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
function getDbPath() {
  const dataDir = process.env.OPENCODE_DATA_DIR ?? path.join(os.homedir(), ".local", "share", "opencode");
  return path.join(dataDir, "opencode.db");
}
function readSessionsFromDb(db, days, currentSessionId) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1e3;
  const rows = db.prepare(`
    SELECT
      s.id           AS sid,
      s.project_id   AS sprojectid,
      s.title        AS stitle,
      s.time_created AS screated,
      s.time_updated AS supdated,
      m.id           AS mid,
      m.time_created AS mcreated,
      m.data         AS mdata,
      p.id           AS pid,
      p.data         AS pdata
    FROM session s
    LEFT JOIN message m ON m.session_id = s.id
    LEFT JOIN part p ON p.message_id = m.id
    WHERE s.time_created > ?
    ${currentSessionId ? "AND s.id != ?" : ""}
    ORDER BY s.id, m.time_created, p.id
  `).all(
    ...currentSessionId ? [cutoff, currentSessionId] : [cutoff]
  );
  const sessionMap = /* @__PURE__ */ new Map();
  const messageMap = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const sid = row["sid"];
    if (!sessionMap.has(sid)) {
      sessionMap.set(sid, {
        id: sid,
        projectId: row["sprojectid"] ?? "",
        createdAt: row["screated"],
        updatedAt: row["supdated"],
        messages: []
      });
    }
    const mid = row["mid"];
    if (!mid) continue;
    if (!messageMap.has(mid)) {
      let mdata = {};
      try {
        mdata = JSON.parse(row["mdata"]);
      } catch {
        continue;
      }
      const msg = {
        role: mdata.role === "assistant" ? "assistant" : "user",
        parts: []
      };
      messageMap.set(mid, msg);
      sessionMap.get(sid).messages.push(msg);
    }
    const pid = row["pid"];
    if (!pid) continue;
    let pdata = {};
    try {
      pdata = JSON.parse(row["pdata"]);
    } catch {
      continue;
    }
    messageMap.get(mid).parts.push({
      type: pdata.type ?? "text",
      content: pdata.text ?? pdata.content ?? ""
    });
  }
  return Array.from(sessionMap.values());
}
function readSessions(days) {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `opencode database not found at ${dbPath}. Is opencode installed and has it been used?`
    );
  }
  const db = new Database(dbPath, { readonly: true });
  const currentSessionId = process.env.OPENCODE_SESSION_ID;
  try {
    return readSessionsFromDb(db, days, currentSessionId);
  } finally {
    db.close();
  }
}

// src/extractor.ts
import * as fs3 from "node:fs";
import * as os3 from "node:os";
import * as path3 from "node:path";

// src/llm.ts
import { spawnSync } from "node:child_process";
import * as fs2 from "node:fs";
import * as os2 from "node:os";
import * as path2 from "node:path";
async function callLlm(systemPrompt, userMessage) {
  const prompt = `${systemPrompt}

${userMessage}`;
  const tmpFile = path2.join(os2.tmpdir(), `op-insight-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs2.writeFileSync(tmpFile, prompt, "utf-8");
  let result;
  try {
    result = spawnSync(
      "opencode",
      ["run", "--format", "json", "Execute:", "--file", tmpFile],
      {
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
        shell: true
      }
    );
  } finally {
    try {
      fs2.unlinkSync(tmpFile);
    } catch {
    }
  }
  if (result.error) {
    throw new Error(`Failed to run opencode: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`opencode exited with code ${result.status}: ${result.stderr}`);
  }
  const lines = result.stdout.split("\n").filter((l) => l.trim());
  const textParts = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === "text" && event.part?.text) {
        textParts.push(event.part.text);
      }
    } catch {
    }
  }
  return textParts.join("").trim();
}

// src/json-utils.ts
function extractJson(raw) {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
  }
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
    }
  }
  const objMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {
    }
  }
  throw new Error(`Could not extract JSON from response:
${raw.slice(0, 400)}`);
}

// src/extractor.ts
var CHUNK_SIZE = 25e3;
var MAX_DIRECT_SIZE = 3e4;
function getCacheDir() {
  const dataDir = process.env.OPENCODE_DATA_DIR ?? path3.join(os3.homedir(), ".local", "share", "opencode");
  return path3.join(dataDir, "insights-cache");
}
function getCachePath(sessionId) {
  return path3.join(getCacheDir(), `${sessionId}.json`);
}
function serializeSession(session) {
  return session.messages.map((m) => {
    const text = m.parts.filter((p) => p.type === "text").map((p) => p.content).join("\n");
    return `${m.role}: ${text}`;
  }).join("\n\n");
}
var FACET_SYSTEM_PROMPT = `You are analyzing a coding session transcript.
IMPORTANT: Your ENTIRE response must be a single valid JSON object. Do NOT include any text, explanation, or markdown before or after the JSON. Start your response with { and end with }.

Extract a JSON object with these fields:
- sessionId: string (copy from input)
- projectName: string (infer from file paths or context; use "Unknown" if unclear)
- summary: string (2-3 sentence description of what was done)
- toolsUsed: string[] (e.g. ["edit", "bash", "grep"])
- repeatedInstructions: string[] (instructions the user gave more than once)
- frictionPoints: string[] (corrections, misunderstandings, retries)
- codeQualityPatterns: string[] (recurring bug types or antipatterns)
- workflowPatterns: string[] (how the user prompts and iterates)`;
async function summarizeChunk(chunk) {
  return callLlm(
    "Summarize this coding session excerpt in 3-5 sentences, preserving key actions, tools, and any friction points.",
    chunk
  );
}
async function callFacetLlm(sessionId, text, systemPrompt = FACET_SYSTEM_PROMPT) {
  const raw = await callLlm(systemPrompt, `sessionId: ${sessionId}

${text}`);
  try {
    return extractJson(raw);
  } catch {
    process.stderr.write(`(invalid JSON, using defaults) `);
    return {
      sessionId,
      projectName: "Unknown",
      summary: "Could not extract facet from this session.",
      toolsUsed: [],
      repeatedInstructions: [],
      frictionPoints: [],
      codeQualityPatterns: [],
      workflowPatterns: []
    };
  }
}
var ERROR_FACET_SYSTEM_PROMPT = `You are analyzing tool errors from a coding session.
IMPORTANT: Your ENTIRE response must be a single valid JSON object. Do NOT include any text, explanation, or markdown before or after the JSON. Start your response with { and end with }.

Extract a JSON object with these fields:
- sessionId: string (copy from input)
- projectName: string (infer from file paths or context; use "Unknown" if unclear)
- summary: string (1-2 sentences describing the errors and what triggered them)
- toolsUsed: string[] (tools that errored, e.g. ["bash", "edit"])
- repeatedInstructions: string[] (any repeated attempts to fix the same thing)
- frictionPoints: string[] (each distinct error with brief context)
- codeQualityPatterns: string[] (patterns in the mistakes, e.g. "wrong path assumptions")
- workflowPatterns: string[] (how the user/assistant responded to the errors)`;
async function extractErrorFacet(session) {
  const messages = session.messages;
  const errorSnippets = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const text2 = msg.parts.filter((p) => p.type === "text").map((p) => p.content).join("\n");
    if (msg.role === "assistant" && /error|failed|cannot|invalid|not found|exit code [^0]/i.test(text2)) {
      const contextStart = Math.max(0, i - 1);
      const contextEnd = Math.min(messages.length - 1, i + 1);
      const snippet = messages.slice(contextStart, contextEnd + 1).map((m) => {
        const t = m.parts.filter((p) => p.type === "text").map((p) => p.content).join("\n");
        return `${m.role}: ${t.slice(0, 500)}`;
      }).join("\n\n");
      errorSnippets.push(snippet);
    }
  }
  if (errorSnippets.length === 0) {
    return {
      sessionId: session.id,
      projectName: "Unknown",
      summary: "No tool errors found in this session.",
      toolsUsed: [],
      repeatedInstructions: [],
      frictionPoints: [],
      codeQualityPatterns: [],
      workflowPatterns: []
    };
  }
  process.stderr.write(`(${errorSnippets.length} errors) `);
  const text = errorSnippets.join("\n\n---\n\n").slice(0, 15e3);
  return callFacetLlm(session.id, text, ERROR_FACET_SYSTEM_PROMPT);
}
async function extractFacet(session) {
  const cachePath = getCachePath(session.id);
  if (fs3.existsSync(cachePath)) {
    const stat = fs3.statSync(cachePath);
    if (stat.mtimeMs >= session.updatedAt) {
      try {
        const facet2 = JSON.parse(fs3.readFileSync(cachePath, "utf-8"));
        process.stderr.write(`(cached) `);
        return facet2;
      } catch {
      }
    }
  }
  const serialized = serializeSession(session).trim();
  if (serialized.length < 200) {
    return {
      sessionId: session.id,
      projectName: "Unknown",
      summary: "Empty session with no messages.",
      toolsUsed: [],
      repeatedInstructions: [],
      frictionPoints: [],
      codeQualityPatterns: [],
      workflowPatterns: []
    };
  }
  let textForLlm;
  if (serialized.length <= MAX_DIRECT_SIZE) {
    textForLlm = serialized;
  } else {
    const chunks = [];
    for (let i = 0; i < serialized.length; i += CHUNK_SIZE) {
      chunks.push(serialized.slice(i, i + CHUNK_SIZE));
    }
    process.stderr.write(`(${chunks.length} chunks, ~${Math.round(serialized.length / 1e3)}k chars) `);
    const summaries = [];
    for (let i = 0; i < chunks.length; i++) {
      process.stderr.write(`chunk ${i + 1}/${chunks.length}... `);
      summaries.push(await summarizeChunk(chunks[i]));
    }
    textForLlm = summaries.join("\n\n");
  }
  const facet = await callFacetLlm(session.id, textForLlm, FACET_SYSTEM_PROMPT);
  fs3.mkdirSync(getCacheDir(), { recursive: true });
  fs3.writeFileSync(cachePath, JSON.stringify(facet, null, 2), "utf-8");
  return facet;
}

// src/aggregator.ts
var SYNTHESIS_SYSTEM_PROMPT = `You are analyzing aggregated data from multiple AI coding sessions to produce a personal insights report.
IMPORTANT: Your ENTIRE response must be a single valid JSON object. Do NOT include any text, explanation, or markdown before or after the JSON. Start your response with { and end with }.

Write in second person ("you", "your") throughout. Be specific \u2014 cite actual project names, file paths, tool names, and error messages from the session data. Avoid generic statements; every insight should be traceable to something concrete in the data.

Produce a JSON object with EXACTLY these fields:
- generatedAt: ISO timestamp string (now)
- periodDays: number (copy from input)
- sessionCount: number (copy from input)
- atAGlance: {
    workingWell: string (2-3 sentences on what the user does well \u2014 cite a specific win from the sessions),
    hindering: string (2-3 sentences on the main friction \u2014 cite the specific recurring error or pattern),
    quickWins: string (1-2 actionable suggestions with concrete "try this" language)
  }
- behavioralProfile: string (3-4 sentences characterizing how this user works with AI tools, based on patterns in the data \u2014 specific, not generic)
- projects: Array<{ name: string, sessionCount: number, description: string }> (describe what actually happened in each project)
- topTools: Array<{ name: string, count: number }> (aggregate toolsUsed across all facets, count occurrences, return top 6)
- workflowInsights: {
    strengths: Array<{ title: string, detail: string }> (2-3 concrete strengths with specifics from session data),
    frictionPoints: Array<{ title: string, detail: string, examples: string[] }> (2-4 friction points; examples should be actual things that went wrong, like the real error message or action),
    behavioralProfile: string (copy of the top-level behavioralProfile)
  }
- codeQualityInsights: {
    recurringPatterns: string[] (actual patterns observed, with examples like "assumed paths without checking"),
    recommendations: string[] (actionable, concrete)
  }
- opencodeConfigSuggestions: Array<{ description: string, rule: string }> (copy-pasteable JSON snippets for opencode config)
- featureRecommendations: Array<{ title: string, why: string }> (opencode features not being used; why explains specifically how it would help this user)`;
async function synthesizeReport(facets, periodDays) {
  const payload = {
    periodDays,
    sessionCount: facets.length,
    facets
  };
  const raw = await callLlm(
    SYNTHESIS_SYSTEM_PROMPT,
    JSON.stringify(payload, null, 2)
  );
  let report;
  try {
    report = extractJson(raw);
  } catch (e) {
    throw new Error(`LLM returned invalid JSON for synthesis: ${e}

Raw response:
${raw.slice(0, 500)}`);
  }
  report.periodDays = periodDays;
  report.sessionCount = facets.length;
  return report;
}

// src/reporter.ts
import * as fs4 from "node:fs";
import * as os4 from "node:os";
import * as path4 from "node:path";
import { execSync } from "node:child_process";
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
}
function bar(label, value, max, color) {
  const pct = max > 0 ? value / max * 100 : 0;
  return `<div class="bar-row">
  <div class="bar-label">${esc(label)}</div>
  <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
  <div class="bar-value">${value}</div>
</div>`;
}
function projectCards(report) {
  return report.projects.map((p) => `
    <div class="project-area">
      <div class="area-header">
        <span class="area-name">${esc(p.name)}</span>
        <span class="area-count">~${p.sessionCount} session${p.sessionCount !== 1 ? "s" : ""}</span>
      </div>
      <div class="area-desc">${esc(p.description)}</div>
    </div>`).join("");
}
function strengthCards(strengths) {
  if (!strengths?.length) return '<p class="empty">None identified.</p>';
  return strengths.map((s) => `
    <div class="big-win">
      <div class="big-win-title">${esc(s.title)}</div>
      <div class="big-win-desc">${esc(s.detail)}</div>
    </div>`).join("");
}
function frictionCards(fps) {
  if (!fps?.length) return '<p class="empty">None identified.</p>';
  return fps.map((f) => `
    <div class="friction-category">
      <div class="friction-title">${esc(f.title)}</div>
      <div class="friction-desc">${esc(f.detail)}</div>
      ${f.examples?.length ? `<ul class="friction-examples">${f.examples.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
    </div>`).join("");
}
function configSuggestion(s, idx) {
  return `
    <div class="claude-md-item">
      <div style="flex:1">
        <div class="cmd-code" id="rule-${idx}">${esc(s.rule)}</div>
        <div class="cmd-why">${esc(s.description)}</div>
      </div>
      <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('rule-${idx}').innerText)">Copy</button>
    </div>`;
}
function featureCards(features) {
  if (!features?.length) return '<p class="empty">None identified.</p>';
  return features.map((f) => `
    <div class="feature-card">
      <div class="feature-title">${esc(typeof f === "string" ? f : f.title)}</div>
      ${typeof f !== "string" && f.why ? `<div class="feature-oneliner">${esc(f.why)}</div>` : ""}
    </div>`).join("");
}
function toolBars(report) {
  const tools = report.topTools ?? [];
  if (!tools.length) return '<p class="empty">No tool data available.</p>';
  const max = tools[0]?.count ?? 1;
  return tools.map((t) => bar(t.name, t.count, max, "#0891b2")).join("");
}
function renderReport(report) {
  const date = report.generatedAt?.slice(0, 10) ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const topToolsMax = report.topTools?.[0]?.count ?? 1;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>opencode Insights \u2014 ${date}</title>
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
        <div class="glance-section"><strong>What&apos;s working:</strong> ${esc(report.atAGlance?.workingWell ?? "")}</div>
        <div class="glance-section"><strong>What&apos;s hindering you:</strong> ${esc(report.atAGlance?.hindering ?? "")}</div>
        <div class="glance-section"><strong>Quick wins to try:</strong> ${esc(report.atAGlance?.quickWins ?? "")}</div>
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
        ${report.workflowInsights?.frictionPoints?.length ? report.workflowInsights.frictionPoints.map((f) => bar(f.title, f.examples?.length ?? 1, Math.max(...report.workflowInsights.frictionPoints.map((fp) => fp.examples?.length ?? 1)), "#ef4444")).join("") : '<p class="empty">None identified.</p>'}
      </div>
    </div>

    <h2 id="section-profile">How You Work</h2>
    <div class="narrative">
      <p>${esc(report.behavioralProfile ?? report.workflowInsights?.behavioralProfile ?? "")}</p>
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
        ${(report.codeQualityInsights?.recurringPatterns ?? []).map((p) => `<li style="margin-bottom:6px">${esc(p)}</li>`).join("")}
      </ul>
      <p><strong>Recommendations:</strong></p>
      <ul style="margin: 8px 0 0 20px; font-size:14px; color:#475569;">
        ${(report.codeQualityInsights?.recommendations ?? []).map((r) => `<li style="margin-bottom:6px">${esc(r)}</li>`).join("")}
      </ul>
    </div>

    <h2 id="section-config">opencode Config Suggestions</h2>
    ${report.opencodeConfigSuggestions?.length ? `<div class="claude-md-section">${report.opencodeConfigSuggestions.map((s, i) => configSuggestion(s, i)).join("")}</div>` : '<p class="empty">None identified.</p>'}

    <h2 id="section-features">Features to Try</h2>
    <p class="section-intro">opencode features you&apos;re not fully using yet.</p>
    ${featureCards(report.featureRecommendations ?? [])}

  </div>
</body>
</html>`;
}
function saveAndOpenReport(report) {
  const dataDir = process.env.OPENCODE_DATA_DIR ?? path4.join(os4.homedir(), ".local", "share", "opencode");
  const outDir = path4.join(dataDir, "insights");
  const outPath = path4.join(outDir, "report.html");
  fs4.mkdirSync(outDir, { recursive: true });
  fs4.writeFileSync(outPath, renderReport(report), "utf-8");
  const opener = process.platform === "win32" ? `start "" "${outPath}"` : process.platform === "darwin" ? `open "${outPath}"` : `xdg-open "${outPath}"`;
  try {
    execSync(opener);
  } catch {
  }
  return outPath;
}

// src/index.ts
function parseArgs() {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf("--days");
  let days = 30;
  if (daysIdx !== -1 && args[daysIdx + 1]) {
    const n = parseInt(args[daysIdx + 1], 10);
    if (isNaN(n) || n < 1) {
      console.error("--days must be a positive integer");
      process.exit(1);
    }
    days = n;
  }
  const topicIdx = args.indexOf("--topic");
  const topic = topicIdx !== -1 ? args[topicIdx + 1] : void 0;
  if (topicIdx !== -1 && !topic) {
    console.error('--topic requires a value, e.g. --topic "typescript"');
    process.exit(1);
  }
  const limitIdx = args.indexOf("--limit");
  let limit;
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    const n = parseInt(args[limitIdx + 1], 10);
    if (isNaN(n) || n < 1) {
      console.error("--limit must be a positive integer");
      process.exit(1);
    }
    limit = n;
  }
  const errors = args.includes("--errors");
  return { days, topic, errors, limit };
}
async function main() {
  const { days, topic, errors, limit } = parseArgs();
  process.stderr.write(`Reading sessions from opencode.db... `);
  let sessions;
  try {
    sessions = readSessions(days);
  } catch (e) {
    console.error(`
Error: ${e.message}`);
    process.exit(1);
  }
  process.stderr.write(`(${sessions.length} sessions found)
`);
  if (sessions.length === 0) {
    console.error(`No sessions found in the last ${days} days.`);
    process.exit(0);
  }
  if (limit && sessions.length > limit) {
    sessions = sessions.slice(-limit);
    process.stderr.write(`Session limit: using ${sessions.length} most recent sessions
`);
  }
  if (topic) {
    const needle = topic.toLowerCase();
    const before = sessions.length;
    sessions = sessions.filter((s) => serializeSession(s).toLowerCase().includes(needle));
    process.stderr.write(`Topic filter "${topic}": ${sessions.length}/${before} sessions match
`);
    if (sessions.length === 0) {
      console.error(`No sessions matched topic "${topic}".`);
      process.exit(0);
    }
  }
  const mode = errors ? "error" : "full";
  process.stderr.write(`Extracting facets [mode: ${mode}] (${sessions.length} sessions)...
`);
  const facets = [];
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const label = (s.title ?? s.id.slice(0, 12)).slice(0, 40);
    process.stderr.write(`  [${i + 1}/${sessions.length}] ${label} ... `);
    const start = Date.now();
    const facet = errors ? await extractErrorFacet(s) : await extractFacet(s);
    const elapsed = ((Date.now() - start) / 1e3).toFixed(1);
    process.stderr.write(`done (${elapsed}s)
`);
    facets.push(facet);
  }
  process.stderr.write(`Synthesizing report...
`);
  const report = await synthesizeReport(facets, days);
  const outPath = saveAndOpenReport(report);
  process.stderr.write(`Report saved to ${outPath}
`);
}
main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
