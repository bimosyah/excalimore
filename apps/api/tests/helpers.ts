import { Hono } from 'hono'
import { injectContext } from '../src/auth/middleware'
import { hashPassword } from '../src/auth/password'
import type { AppEnv } from '../src/context'
import { type DbClient, createDbClient } from '../src/db/client'
import { type NewUserRow, type UserRow, users } from '../src/db/schema'
import { type Env, loadEnv } from '../src/env'

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

/**
 * Build an app preloaded with `ctx.var.user` to skip the cookie/session dance.
 * Use this in route integration tests to focus on route logic.
 */
export function buildAuthedApp(user: UserRow) {
  const db = getTestDb()
  const env: Env = loadEnv()
  const app = new Hono<AppEnv>()
  app.use('*', injectContext(db, env))
  app.use('*', async (c, next) => {
    c.set('user', user)
    c.set('sessionId', 'test-session')
    await next()
  })
  return { app, db, env }
}

/**
 * Stable CSRF token for tests. Mutating route requests must include both:
 *   Cookie:        excalimore_csrf=<TEST_CSRF>
 *   X-CSRF-Token:  <TEST_CSRF>
 */
export const TEST_CSRF = 'test-csrf-token-fixed'

/** Returns headers + cookie pair for mutating requests in route tests. */
export function csrfHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Cookie: `excalimore_csrf=${TEST_CSRF}`,
    'X-CSRF-Token': TEST_CSRF,
    ...extra,
  }
}
