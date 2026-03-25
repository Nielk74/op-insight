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
      s.id        AS sid,
      s.time_created,
      s.time_updated,
      s.data      AS sdata,
      m.id        AS mid,
      m.time_created AS mtime,
      m.data      AS mdata,
      p.id        AS pid,
      p.data      AS pdata
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
      let sdata: { projectId?: string } = {}
      try { sdata = JSON.parse(row['sdata'] as string) } catch { continue }

      sessionMap.set(sid, {
        id: sid,
        projectId: sdata.projectId ?? '',
        createdAt: row['time_created'] as number,
        updatedAt: row['time_updated'] as number,
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

    let pdata: { type?: string; content?: string } = {}
    try { pdata = JSON.parse(row['pdata'] as string) } catch { continue }

    messageMap.get(mid)!.parts.push({
      type: pdata.type ?? 'text',
      content: pdata.content ?? '',
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
