import { eq } from 'drizzle-orm'
import type { DbClient } from '../db/client'
import { type SessionRow, type UserRow, sessions, users } from '../db/schema'
import { generateToken } from './ids'

const SESSION_TOKEN_BYTES = 32

export async function createSession(
  db: DbClient,
  userId: string,
  maxAgeSeconds: number,
): Promise<string> {
  const id = generateToken(SESSION_TOKEN_BYTES)
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000)
  await db.insert(sessions).values({ id, userId, expiresAt })
  return id
}

export interface SessionWithUser {
  session: SessionRow
  user: UserRow
}

export async function getSession(
  db: DbClient,
  sessionId: string,
): Promise<SessionWithUser | null> {
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  if (row.session.expiresAt.getTime() <= Date.now()) {
    // Eagerly clean up expired sessions when we encounter them.
    await db.delete(sessions).where(eq(sessions.id, sessionId))
    return null
  }
  return row
}

export async function invalidateSession(db: DbClient, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId))
}
