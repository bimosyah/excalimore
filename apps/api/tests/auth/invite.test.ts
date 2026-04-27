import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { consumeInviteToken, generateInviteToken } from '../../src/auth/invite'
import type { DbClient } from '../../src/db/client'
import { inviteTokens, users } from '../../src/db/schema'
import { createTestUser, getTestDb } from '../helpers'

let db: DbClient

beforeAll(() => {
  db = getTestDb()
})

afterEach(async () => {
  await db.delete(inviteTokens)
  await db.delete(users)
})

describe('generateInviteToken', () => {
  it('creates a token with default 7-day expiry', async () => {
    const { row: admin } = await createTestUser(db, { role: 'admin', password: 'pw' })
    const token = await generateInviteToken(db, { createdBy: admin.id })
    const stored = await db.select().from(inviteTokens).where(eq(inviteTokens.token, token))
    expect(stored).toHaveLength(1)
    expect(stored[0]!.usedAt).toBeNull()
    const ttlMs = stored[0]!.expiresAt.getTime() - Date.now()
    expect(ttlMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000)
    expect(ttlMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000 + 1000)
  })

  it('records optional scene grant', async () => {
    const { row: admin } = await createTestUser(db, { role: 'admin', password: 'pw' })
    const token = await generateInviteToken(db, {
      createdBy: admin.id,
      sceneId: undefined, // no scene_id reference needed for this assertion path
      permission: 'view',
    })
    const stored = await db.select().from(inviteTokens).where(eq(inviteTokens.token, token))
    expect(stored[0]!.permission).toBe('view')
  })
})

describe('consumeInviteToken', () => {
  it('returns the token row and marks it used', async () => {
    const { row: admin } = await createTestUser(db, { role: 'admin', password: 'pw' })
    const { row: invitee } = await createTestUser(db, { password: 'pw' })
    const token = await generateInviteToken(db, { createdBy: admin.id })

    const consumed = await consumeInviteToken(db, token, invitee.id)
    expect(consumed).not.toBeNull()
    expect(consumed!.usedBy).toBe(invitee.id)
    expect(consumed!.usedAt).not.toBeNull()
  })

  it('returns null on second consumption attempt', async () => {
    const { row: admin } = await createTestUser(db, { role: 'admin', password: 'pw' })
    const { row: invitee } = await createTestUser(db, { password: 'pw' })
    const token = await generateInviteToken(db, { createdBy: admin.id })
    await consumeInviteToken(db, token, invitee.id)
    const second = await consumeInviteToken(db, token, invitee.id)
    expect(second).toBeNull()
  })

  it('returns null for unknown token', async () => {
    const { row: invitee } = await createTestUser(db, { password: 'pw' })
    expect(await consumeInviteToken(db, 'nope', invitee.id)).toBeNull()
  })

  it('returns null for expired token', async () => {
    const { row: admin } = await createTestUser(db, { role: 'admin', password: 'pw' })
    const { row: invitee } = await createTestUser(db, { password: 'pw' })
    const token = await generateInviteToken(db, { createdBy: admin.id, expiresInSeconds: -1 })
    expect(await consumeInviteToken(db, token, invitee.id)).toBeNull()
  })
})
