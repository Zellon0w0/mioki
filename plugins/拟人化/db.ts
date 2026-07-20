import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'

export interface ChatMessage {
  id?: number
  sessionId: string
  userId: string
  nickname: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface UserProfile {
  userId: string
  personaName: string
  nickname: string
  favorability: number
  impressions: string
  updatedAt: number
}

export interface SessionPersona {
  sessionId: string
  characterName: string
  systemPrompt: string
  updatedAt: number
}

let dbInstance: DatabaseSync | null = null

export function initDb(dbPath: string): DatabaseSync {
  if (dbInstance) return dbInstance

  const dir = join(dbPath, '..')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const db = new DatabaseSync(dbPath)

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessionId TEXT NOT NULL,
      userId TEXT NOT NULL,
      nickname TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_history_session ON chat_history(sessionId, timestamp)
  `)

  // Drop old table to migrate to personaName joint key
  try {
    const testStmt = db.prepare(`SELECT personaName FROM user_profiles LIMIT 1`)
    testStmt.get()
  } catch (e) {
    // Column doesn't exist, drop and recreate
    db.exec(`DROP TABLE IF EXISTS user_profiles`)
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      userId TEXT NOT NULL,
      personaName TEXT NOT NULL DEFAULT 'default',
      nickname TEXT NOT NULL,
      favorability REAL NOT NULL DEFAULT 0.0,
      impressions TEXT NOT NULL DEFAULT '',
      updatedAt INTEGER NOT NULL,
      PRIMARY KEY (userId, personaName)
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_personas (
      sessionId TEXT PRIMARY KEY,
      characterName TEXT NOT NULL,
      systemPrompt TEXT NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)

  dbInstance = db
  return db
}

export function addChatMessage(msg: ChatMessage) {
  if (!dbInstance) throw new Error('Database not initialized')
  const stmt = dbInstance.prepare(`
    INSERT INTO chat_history (sessionId, userId, nickname, role, content, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  stmt.run(msg.sessionId, msg.userId, msg.nickname, msg.role, msg.content, msg.timestamp)
}

export function getRecentChatHistory(sessionId: string, limit = 20): ChatMessage[] {
  if (!dbInstance) throw new Error('Database not initialized')
  const stmt = dbInstance.prepare(`
    SELECT sessionId, userId, nickname, role, content, timestamp
    FROM chat_history
    WHERE sessionId = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `)
  const rows = stmt.all(sessionId, limit) as any[]
  return rows.reverse()
}

export function searchChatHistory(query: string, limit = 10): ChatMessage[] {
  if (!dbInstance) throw new Error('Database not initialized')
  const stmt = dbInstance.prepare(`
    SELECT sessionId, userId, nickname, role, content, timestamp
    FROM chat_history
    WHERE content LIKE ?
    ORDER BY timestamp DESC
    LIMIT ?
  `)
  return stmt.all(`%${query}%`, limit) as any[]
}

export function getUserProfile(userId: string, personaName: string, defaultNickname = ''): UserProfile {
  if (!dbInstance) throw new Error('Database not initialized')
  const stmt = dbInstance.prepare(`
    SELECT userId, personaName, nickname, favorability, impressions, updatedAt
    FROM user_profiles
    WHERE userId = ? AND personaName = ?
  `)
  const row = stmt.get(userId, personaName) as any
  if (row) {
    return row as UserProfile
  }

  const newProfile: UserProfile = {
    userId,
    personaName,
    nickname: defaultNickname || userId,
    favorability: 0.0,
    impressions: '初次见面。',
    updatedAt: Date.now()
  }

  const insertStmt = dbInstance.prepare(`
    INSERT INTO user_profiles (userId, personaName, nickname, favorability, impressions, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  insertStmt.run(newProfile.userId, newProfile.personaName, newProfile.nickname, newProfile.favorability, newProfile.impressions, newProfile.updatedAt)

  return newProfile
}

export function updateUserProfile(userId: string, personaName: string, nickname: string, favorabilityChange: number, impressions: string): UserProfile {
  if (!dbInstance) throw new Error('Database not initialized')
  const profile = getUserProfile(userId, personaName, nickname)
  const newFavorability = Math.max(-100, Math.min(100, profile.favorability + favorabilityChange))
  
  const stmt = dbInstance.prepare(`
    UPDATE user_profiles
    SET nickname = ?, favorability = ?, impressions = ?, updatedAt = ?
    WHERE userId = ? AND personaName = ?
  `)
  stmt.run(
    nickname || profile.nickname,
    newFavorability,
    impressions || profile.impressions,
    Date.now(),
    userId,
    personaName
  )

  return {
    userId,
    personaName,
    nickname: nickname || profile.nickname,
    favorability: newFavorability,
    impressions: impressions || profile.impressions,
    updatedAt: Date.now()
  }
}

export function getSessionPersona(sessionId: string): SessionPersona | null {
  if (!dbInstance) throw new Error('Database not initialized')
  const stmt = dbInstance.prepare(`
    SELECT sessionId, characterName, systemPrompt, updatedAt
    FROM session_personas
    WHERE sessionId = ?
  `)
  const row = stmt.get(sessionId) as any
  return row ? (row as SessionPersona) : null
}

export function setSessionPersona(sessionId: string, characterName: string, systemPrompt: string) {
  if (!dbInstance) throw new Error('Database not initialized')
  const stmt = dbInstance.prepare(`
    INSERT INTO session_personas (sessionId, characterName, systemPrompt, updatedAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(sessionId) DO UPDATE SET
      characterName = excluded.characterName,
      systemPrompt = excluded.systemPrompt,
      updatedAt = excluded.updatedAt
  `)
  stmt.run(sessionId, characterName, systemPrompt, Date.now())
}

export function clearSessionPersona(sessionId: string) {
  if (!dbInstance) throw new Error('Database not initialized')
  const stmt = dbInstance.prepare(`
    DELETE FROM session_personas
    WHERE sessionId = ?
  `)
  stmt.run(sessionId)
}

export function closeDb() {
  if (dbInstance) {
    try {
      (dbInstance as any).close()
    } catch {}
    dbInstance = null
  }
}
