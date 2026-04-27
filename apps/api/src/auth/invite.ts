import { and, eq, isNull } from 'drizzle-orm'
import type { DbClient } from '../db/client'
import { type InviteTokenRow, inviteTokens } from '../db/schema'
import { generateToken } from './ids'

const INVITE_TOKEN_BYTES = 32
const DEFAULT_EXPIRY_SECONDS = 7 * 24 * 60 * 60

export interface GenerateInviteOptions {
  createdBy: string
  sceneId?: string
  permission?: 'view' | 'edit'
  expiresInSeconds?: number
}

export async function generateInviteToken(
  db: DbClient,
  opts: GenerateInviteOptions,
): Promise<string> {
  const token = generateToken(INVITE_TOKEN_BYTES)
  const ttl = opts.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS
  const expiresAt = new Date(Date.now() + ttl * 1000)
  await db.insert(inviteTokens).values({
    token,
    sceneId: opts.sceneId ?? null,
    permission: opts.permission ?? null,
    createdBy: opts.createdBy,
    expiresAt,
  })
  return token
}

/**
 * Atomically marks an invite token as used and returns the resulting row,
 * or null if the token is unknown / already used / expired.
 */
export async function consumeInviteToken(
  db: DbClient,
  token: string,
  consumedBy: string,
): Promise<InviteTokenRow | null> {
  const now = new Date()
  const result = await db
    .update(inviteTokens)
    .set({ usedBy: consumedBy, usedAt: now })
    .where(and(eq(inviteTokens.token, token), isNull(inviteTokens.usedAt)))
    .returning()

  const row = result[0]
  if (!row) return null
  if (row.expiresAt.getTime() <= now.getTime()) {
    // Roll back: this token had already expired before consumption — treat as invalid.
    await db
      .update(inviteTokens)
      .set({ usedBy: null, usedAt: null })
      .where(eq(inviteTokens.token, token))
    return null
  }
  return row
}
