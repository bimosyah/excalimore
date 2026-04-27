import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { CreateInviteRequestSchema, LoginRequestSchema, SignupRequestSchema } from '@excalimore/types'
import type { AppEnv } from '../context'
import { shareGrants, users } from '../db/schema'
import { httpError } from '../lib/http-errors'
import { consumeBootstrapToken, detectFirstRunAndIssueToken } from './bootstrap'
import { clearCsrfCookie, clearSessionCookie, setCsrfCookie, setSessionCookie } from './cookie'
import { generateCsrfToken } from './csrf'
import { consumeInviteToken, generateInviteToken } from './invite'
import { rateLimit, requireAdmin, requireAuth } from './middleware'
import { hashPassword, verifyPassword } from './password'
import { createSession, invalidateSession } from './session'

export function buildAuthRouter(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // Strict rate limit for credential endpoints.
  const credentialLimit = rateLimit({ limit: 5, windowMs: 60_000 })

  app.post('/signup', credentialLimit, async (c) => {
    const json = await c.req.json().catch(() => null)
    const body = SignupRequestSchema.safeParse(json)
    if (!body.success) throw httpError('invalid_input', 'invalid signup body')
    const { token, email, password, name } = body.data
    const db = c.var.db
    const env = c.var.env
    const isHttps = env.PUBLIC_URL.startsWith('https://')

    // Path A: bootstrap token → admin user, no scene grant.
    if (await consumeBootstrapToken(db, token)) {
      const passwordHash = await hashPassword(password)
      const inserted = await db
        .insert(users)
        .values({ email, name, passwordHash, role: 'admin' })
        .returning()
        .catch(() => {
          throw httpError('conflict', 'email already registered')
        })
      const adminUser = inserted[0]
      if (!adminUser) throw httpError('internal', 'failed to create admin')

      const sessionId = await createSession(db, adminUser.id, env.SESSION_MAX_AGE)
      setSessionCookie(c, sessionId, { maxAgeSeconds: env.SESSION_MAX_AGE, secure: isHttps })
      setCsrfCookie(c, generateCsrfToken(), isHttps)
      return c.json({
        user: { id: adminUser.id, email: adminUser.email, name: adminUser.name, role: 'admin' },
        redirectTo: '/',
      })
    }

    // Path B: invite token → regular user, optional scene grant.
    // Create user first (we need the id to record consumption), then consume the token.
    // If consumption fails, roll back the user.
    const passwordHash = await hashPassword(password)
    const inserted = await db
      .insert(users)
      .values({ email, name, passwordHash, role: 'user' })
      .returning()
      .catch(() => {
        throw httpError('conflict', 'email already registered')
      })
    const newUser = inserted[0]
    if (!newUser) throw httpError('internal', 'failed to create user')

    const consumed = await consumeInviteToken(db, token, newUser.id)
    if (!consumed) {
      await db.delete(users).where(eq(users.id, newUser.id))
      throw httpError('invalid_input', 'invalid or expired token')
    }

    if (consumed.sceneId && consumed.permission) {
      await db.insert(shareGrants).values({
        sceneId: consumed.sceneId,
        userId: newUser.id,
        permission: consumed.permission,
        grantedBy: consumed.createdBy,
      })
    }

    const sessionId = await createSession(db, newUser.id, env.SESSION_MAX_AGE)
    setSessionCookie(c, sessionId, { maxAgeSeconds: env.SESSION_MAX_AGE, secure: isHttps })
    setCsrfCookie(c, generateCsrfToken(), isHttps)
    return c.json({
      user: { id: newUser.id, email: newUser.email, name: newUser.name },
      redirectTo: consumed.sceneId ? `/scenes/${consumed.sceneId}` : '/',
    })
  })

  app.post('/login', credentialLimit, async (c) => {
    const json = await c.req.json().catch(() => null)
    const body = LoginRequestSchema.safeParse(json)
    if (!body.success) throw httpError('invalid_input', 'invalid login body')
    const { email, password } = body.data
    const db = c.var.db
    const env = c.var.env
    const isHttps = env.PUBLIC_URL.startsWith('https://')

    const found = await db.select().from(users).where(eq(users.email, email)).limit(1)
    const user = found[0]
    if (!user) {
      // Burn time on a dummy verify so failures don't reveal whether the email exists.
      await verifyPassword('$argon2id$dummy$', password)
      throw httpError('unauthorized', 'invalid email or password')
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw httpError('unauthorized', 'invalid email or password')
    }

    // Rotate session id on login: prior sessions remain valid until they expire,
    // but a fresh login always issues a new id (defends against session fixation).
    const sessionId = await createSession(db, user.id, env.SESSION_MAX_AGE)
    setSessionCookie(c, sessionId, { maxAgeSeconds: env.SESSION_MAX_AGE, secure: isHttps })
    setCsrfCookie(c, generateCsrfToken(), isHttps)
    return c.json({ user: { id: user.id, email: user.email, name: user.name } })
  })

  app.post('/logout', async (c) => {
    if (c.var.sessionId) await invalidateSession(c.var.db, c.var.sessionId)
    clearSessionCookie(c)
    clearCsrfCookie(c)
    return c.json({ ok: true })
  })

  app.get('/me', requireAuth(), async (c) => {
    const u = c.var.user
    if (!u) throw httpError('unauthorized', 'authentication required')
    return c.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role } })
  })

  app.post('/invite', requireAuth(), requireAdmin(), async (c) => {
    const json = await c.req.json().catch(() => ({}))
    const body = CreateInviteRequestSchema.safeParse(json)
    if (!body.success) throw httpError('invalid_input', 'invalid invite body')
    const env = c.var.env
    const created = c.var.user
    if (!created) throw httpError('unauthorized', 'authentication required')

    const ttl = body.data.expiresAt
      ? Math.max(60, Math.floor((Date.parse(body.data.expiresAt) - Date.now()) / 1000))
      : undefined
    const token = await generateInviteToken(c.var.db, {
      createdBy: created.id,
      sceneId: body.data.sceneId,
      permission: body.data.permission,
      expiresInSeconds: ttl,
    })
    return c.json({ token, url: `${env.PUBLIC_URL}/signup?token=${encodeURIComponent(token)}` })
  })

  return app
}

// Re-export the bootstrap detector for the app boot script.
export { detectFirstRunAndIssueToken }
