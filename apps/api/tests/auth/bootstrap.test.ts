import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { consumeBootstrapToken, detectFirstRunAndIssueToken } from '../../src/auth/bootstrap'
import type { DbClient } from '../../src/db/client'
import { bootstrapTokens, users } from '../../src/db/schema'
import { createTestUser, getTestDb } from '../helpers'

let db: DbClient

beforeAll(() => {
  db = getTestDb()
})

afterEach(async () => {
  await db.delete(bootstrapTokens)
  await db.delete(users)
})

describe('detectFirstRunAndIssueToken', () => {
  it('issues a token when no users exist', async () => {
    const token = await detectFirstRunAndIssueToken(db, 60)
    expect(token).not.toBeNull()
  })

  it('returns null when at least one user already exists', async () => {
    await createTestUser(db, { password: 'pw' })
    const token = await detectFirstRunAndIssueToken(db, 60)
    expect(token).toBeNull()
  })
})

describe('consumeBootstrapToken', () => {
  it('returns true and marks used for valid unused token', async () => {
    const token = await detectFirstRunAndIssueToken(db, 60)
    expect(token).not.toBeNull()
    expect(await consumeBootstrapToken(db, token!)).toBe(true)
  })

  it('returns false on second consumption attempt', async () => {
    const token = await detectFirstRunAndIssueToken(db, 60)
    await consumeBootstrapToken(db, token!)
    expect(await consumeBootstrapToken(db, token!)).toBe(false)
  })

  it('returns false for unknown token', async () => {
    expect(await consumeBootstrapToken(db, 'nope')).toBe(false)
  })

  it('returns false for expired token', async () => {
    const token = await detectFirstRunAndIssueToken(db, -1)
    expect(await consumeBootstrapToken(db, token!)).toBe(false)
  })
})
