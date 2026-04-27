import { Hono } from 'hono'
import { hashPassword } from '../src/auth/password'
import type { AppEnv } from '../src/context'
import { type DbClient, createDbClient } from '../src/db/client'
import { type NewUserRow, users } from '../src/db/schema'

export function getTestDb(): DbClient {
  return createDbClient(process.env.DATABASE_URL ?? '')
}

export function buildBareApp() {
  return new Hono<AppEnv>()
}

export async function createTestUser(
  db: DbClient,
  overrides: Partial<NewUserRow> & { password: string } = { password: 'hunter2hunter2' },
) {
  const { password, ...rest } = overrides
  const [row] = await db
    .insert(users)
    .values({
      email: rest.email ?? `u-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: rest.name ?? 'Test User',
      passwordHash: await hashPassword(password),
      role: rest.role ?? 'user',
    })
    .returning()
  if (!row) throw new Error('failed to create test user')
  return { row, password }
}
