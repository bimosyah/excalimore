import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DbClient } from '../db/client'
import { bootstrapTokens, users } from '../db/schema'
import { generateToken } from './ids'

const BOOTSTRAP_TOKEN_BYTES = 32

/**
 * Returns a one-time token if the users table is empty. Returns null otherwise.
 * The intent is for the operator to consume this token via the signup endpoint
 * to create the first admin account.
 */
export async function detectFirstRunAndIssueToken(
  db: DbClient,
  expiresInSeconds: number,
): Promise<string | null> {
  const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(users)
  if ((result?.count ?? 0) > 0) return null

  const token = generateToken(BOOTSTRAP_TOKEN_BYTES)
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000)
  await db.insert(bootstrapTokens).values({ token, expiresAt })
  return token
}

/**
 * Atomically marks the token used. Returns true on success, false if the
 * token is unknown, already used, or expired.
 */
export async function consumeBootstrapToken(db: DbClient, token: string): Promise<boolean> {
  const now = new Date()
  const result = await db
    .update(bootstrapTokens)
    .set({ usedAt: now })
    .where(and(eq(bootstrapTokens.token, token), isNull(bootstrapTokens.usedAt)))
    .returning()

  const row = result[0]
  if (!row) return false
  if (row.expiresAt.getTime() <= now.getTime()) {
    // Roll back: expired tokens are not consumed.
    await db.update(bootstrapTokens).set({ usedAt: null }).where(eq(bootstrapTokens.token, token))
    return false
  }
  return true
}
