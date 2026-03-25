import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as readerModule from '../src/reader.js'

// We test readSessions by pointing it at a real in-memory SQLite DB
// constructed with the same schema as opencode's DB.
import Database from 'better-sqlite3'

function buildTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      time_created INTEGER,
      data TEXT
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      data TEXT
    );
  `)
  return db
}

describe('readSessions', () => {
  it('returns sessions within the day range', () => {
    const db = buildTestDb()
    const now = Date.now()
    const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000

    // Insert one recent session
    db.prepare(`INSERT INTO session VALUES (?, ?, ?, ?)`).run(
      'ses_recent',
      now - 1000,
      now,
      JSON.stringify({ projectId: 'proj_1' })
    )
    db.prepare(`INSERT INTO message VALUES (?, ?, ?, ?)`).run(
      'msg_1',
      'ses_recent',
      now - 900,
      JSON.stringify({ role: 'user' })
    )
    db.prepare(`INSERT INTO part VALUES (?, ?, ?)`).run(
      'part_1',
      'msg_1',
      JSON.stringify({ type: 'text', content: 'hello' })
    )

    // Insert one old session (outside 30-day window)
    db.prepare(`INSERT INTO session VALUES (?, ?, ?, ?)`).run(
      'ses_old',
      thirtyOneDaysAgo,
      thirtyOneDaysAgo,
      JSON.stringify({ projectId: 'proj_2' })
    )

    const sessions = readerModule.readSessionsFromDb(db, 30, undefined)

    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('ses_recent')
    expect(sessions[0].messages).toHaveLength(1)
    expect(sessions[0].messages[0].parts[0].content).toBe('hello')
    db.close()
  })

  it('excludes session matching currentSessionId', () => {
    const db = buildTestDb()
    const now = Date.now()

    db.prepare(`INSERT INTO session VALUES (?, ?, ?, ?)`).run(
      'ses_current',
      now - 1000,
      now,
      JSON.stringify({ projectId: 'proj_1' })
    )

    const sessions = readerModule.readSessionsFromDb(db, 30, 'ses_current')

    expect(sessions).toHaveLength(0)
    db.close()
  })

  it('skips rows with corrupt JSON in data column', () => {
    const db = buildTestDb()
    const now = Date.now()

    db.prepare(`INSERT INTO session VALUES (?, ?, ?, ?)`).run(
      'ses_corrupt',
      now - 1000,
      now,
      'not-json'
    )
    db.prepare(`INSERT INTO session VALUES (?, ?, ?, ?)`).run(
      'ses_valid',
      now - 1000,
      now,
      JSON.stringify({ projectId: 'proj_1' })
    )

    const sessions = readerModule.readSessionsFromDb(db, 30, undefined)

    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('ses_valid')
    db.close()
  })
})
