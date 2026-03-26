// src/reader.ts
import { Database } from 'bun:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SessionFacet } from './types.js'

export function getDbPath(): string {
  const dataDir = process.env.OPENCODE_DATA_DIR
    ?? path.join(os.homedir(), '.local', 'share', 'opencode')
  return path.join(dataDir, 'opencode.db')
}

const KNOWN_TOOLS = ['bash', 'edit', 'read', 'write', 'grep', 'glob', 'webfetch', 'websearch', 'task']
const ERROR_RE = /error|failed|exit code [^0]|enoent|cannot|not found/i
const PATH_RE = /(?:^|\s)([\w.-]+)\/[\w./-]+\.(ts|js|py|lua|go|rs|json|md)/i

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
): SessionFacet[] {
  const dbPath = getDbPath()
  if (!fs.existsSync(dbPath)) {
    throw new Error(`opencode database not found at ${dbPath}`)
  }

  const db = new Database(dbPath, { readonly: true })
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000

  type Row = {
    sid: string; screated: number; mid: string | null;
    mrole: string | null; pdata: string | null
  }

  let rows: Row[]
  try {
    rows = db.query<Row, unknown[]>(`
      SELECT
        s.id           AS sid,
        s.time_created AS screated,
        m.id           AS mid,
        JSON_EXTRACT(m.data, '$.role') AS mrole,
        p.data         AS pdata
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

  // Group by session
  const sessionMap = new Map<string, {
    createdAt: number
    messages: Array<{ role: string; parts: Array<{ type: string; text: string; toolName?: string }> }>
    msgIndex: Map<string, number>
  }>()

  for (const row of rows) {
    if (!sessionMap.has(row.sid)) {
      sessionMap.set(row.sid, { createdAt: row.screated, messages: [], msgIndex: new Map() })
    }
    const sess = sessionMap.get(row.sid)!
    if (!row.mid || !row.pdata) continue
    if (!sess.msgIndex.has(row.mid)) {
      sess.msgIndex.set(row.mid, sess.messages.length)
      sess.messages.push({ role: row.mrole ?? 'user', parts: [] })
    }
    let pdata: { type?: string; text?: string; content?: string; tool?: string } = {}
    try { pdata = JSON.parse(row.pdata) } catch { continue }
    const idx = sess.msgIndex.get(row.mid)
    if (idx === undefined) continue
    sess.messages[idx].parts.push({ type: pdata.type ?? 'text', text: pdata.text ?? pdata.content ?? '', toolName: pdata.tool })
  }

  let facets: SessionFacet[] = []

  for (const [sid, sess] of sessionMap) {
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
    const firstUserMsg = rawFirstMsg.replace(/^"([\s\S]*?)"\s*$/, '$1').slice(0, 200)

    const fullText = allTexts.join(' ')

    if (sess.messages.length === 0) continue
    if (topic && !fullText.toLowerCase().includes(topic.toLowerCase())) continue
    if (errorsOnly && errorSnippets.length === 0) continue

    facets.push({
      sessionId: sid,
      projectName: inferProject(allTexts),
      date: new Date(sess.createdAt).toISOString().slice(0, 10),
      messageCount: sess.messages.length,
      toolsUsed,
      errorSnippets,
      firstUserMessage: firstUserMsg,
    })
  }

  if (limit != null) facets = facets.slice(0, limit)
  return facets
}
