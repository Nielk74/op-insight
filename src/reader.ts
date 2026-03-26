import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Session, Message, MessagePart } from './types.js'

export function getDbPath(): string {
  const dataDir = process.env.OPENCODE_DATA_DIR
    ?? path.join(os.homedir(), '.local', 'share', 'opencode')
  return path.join(dataDir, 'opencode.db')
}

export function readSessionsFromDb(
  db: Database.Database,
  days: number,
  currentSessionId: string | undefined
): Session[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000

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
    ${currentSessionId ? 'AND s.id != ?' : ''}
    ORDER BY s.id, m.time_created, p.id
  `).all(
    ...(currentSessionId ? [cutoff, currentSessionId] : [cutoff])
  ) as Array<Record<string, unknown>>

  // Group rows by session -> message -> parts
  const sessionMap = new Map<string, Session>()
  const messageMap = new Map<string, Message>()

  for (const row of rows) {
    const sid = row['sid'] as string

    if (!sessionMap.has(sid)) {
      sessionMap.set(sid, {
        id: sid,
        projectId: (row['sprojectid'] as string) ?? '',
        createdAt: row['screated'] as number,
        updatedAt: row['supdated'] as number,
        messages: [],
      })
    }

    const mid = row['mid'] as string | null
    if (!mid) continue

    if (!messageMap.has(mid)) {
      let mdata: { role?: string } = {}
      try { mdata = JSON.parse(row['mdata'] as string) } catch { continue }

      const msg: Message = {
        role: (mdata.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        parts: [],
      }
      messageMap.set(mid, msg)
      sessionMap.get(sid)!.messages.push(msg)
    }

    const pid = row['pid'] as string | null
    if (!pid) continue

    let pdata: { type?: string; text?: string; content?: string } = {}
    try { pdata = JSON.parse(row['pdata'] as string) } catch { continue }

    messageMap.get(mid)!.parts.push({
      type: pdata.type ?? 'text',
      content: pdata.text ?? pdata.content ?? '',
    })
  }

  return Array.from(sessionMap.values())
}

export function readSessions(days: number): Session[] {
  const dbPath = getDbPath()

  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `opencode database not found at ${dbPath}. Is opencode installed and has it been used?`
    )
  }

  const db = new Database(dbPath, { readonly: true })
  const currentSessionId = process.env.OPENCODE_SESSION_ID

  try {
    return readSessionsFromDb(db, days, currentSessionId)
  } finally {
    db.close()
  }
}
