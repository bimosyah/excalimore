import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createSession, getSession, invalidateSession } from '../../src/auth/session'
import type { DbClient } from '../../src/db/client'
import { sessions } from '../../src/db/schema'
import { createTestUser, getTestDb } from '../helpers'

let db: DbClient

beforeAll(() => {
  db = getTestDb()
})

afterEach(async () => {
  await db.delete(sessions)
})

describe('createSession', () => {
  it('creates a session row and returns its id', async () => {
    const { row: user } = await createTestUser(db)
    const id = await createSession(db, user.id, 60) // 60 seconds
    expect(id.length).toBeGreaterThan(20)

    const stored = await db.select().from(sessions).where(eq(sessions.id, id))
    expect(stored).toHaveLength(1)
    expect(stored[0]!.userId).toBe(user.id)
  })
})

describe('getSession', () => {
  it('returns the session and user when valid', async () => {
    const { row: user } = await createTestUser(db)
    const id = await createSession(db, user.id, 60)
    const result = await getSession(db, id)
    expect(result?.user.id).toBe(user.id)
    expect(result?.session.id).toBe(id)
  })

  it('returns null for unknown session id', async () => {
    expect(await getSession(db, 'does-not-exist')).toBeNull()
  })

  it('returns null for expired session', async () => {
    const { row: user } = await createTestUser(db)
    const id = await createSession(db, user.id, -1) // already expired
    expect(await getSession(db, id)).toBeNull()
  })
})

describe('invalidateSession', () => {
  it('deletes the session', async () => {
    const { row: user } = await createTestUser(db)
    const id = await createSession(db, user.id, 60)
    await invalidateSession(db, id)
    expect(await getSession(db, id)).toBeNull()
  })

  it('is a no-op for unknown session id', async () => {
    await expect(invalidateSession(db, 'nope')).resolves.toBeUndefined()
  })
})
