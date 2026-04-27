import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildAuthRouter,
  detectFirstRunAndIssueToken,
  injectContext,
  loadSession,
} from '../../src/auth'
import type { AppEnv } from '../../src/context'
import { bootstrapTokens, inviteTokens, sessions, shareGrants, users } from '../../src/db/schema'
import { loadEnv } from '../../src/env'
import { getTestDb } from '../helpers'

function buildTestApp() {
  const db = getTestDb()
  const env = loadEnv()
  const app = new Hono<AppEnv>()
  app.use('*', injectContext(db, env))
  app.use('*', loadSession())
  app.route('/api/auth', buildAuthRouter())
  return { app, db, env }
}

const { app, db, env } = buildTestApp()

afterEach(async () => {
  await db.delete(sessions)
  await db.delete(shareGrants)
  await db.delete(inviteTokens)
  await db.delete(bootstrapTokens)
  await db.delete(users)
})

function getCookie(res: Response, name: string): string | undefined {
  const setCookie = res.headers.getSetCookie?.() ?? []
  for (const line of setCookie) {
    const [pair] = line.split(';')
    if (!pair) continue
    const idx = pair.indexOf('=')
    if (idx < 0) continue
    const k = pair.slice(0, idx)
    const v = pair.slice(idx + 1)
    if (k === name) return decodeURIComponent(v)
  }
  return undefined
}

describe('end-to-end auth flow', () => {
  it('completes bootstrap → invite → signup → me → logout', async () => {
    // 1. Bootstrap: API issues token because users table is empty.
    const bootstrapToken = await detectFirstRunAndIssueToken(db, env.BOOTSTRAP_TOKEN_TTL)
    expect(bootstrapToken).not.toBeNull()

    // 2. Operator signs up as admin via bootstrap token.
    const adminSignup = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: bootstrapToken,
        email: 'admin@excalimore.test',
        password: 'admin-password',
        name: 'Admin',
      }),
    })
    expect(adminSignup.status).toBe(200)
    const adminCookie = getCookie(adminSignup, 'excalimore_session')
    expect(adminCookie).toBeTruthy()

    // 3. Admin generates an invite token.
    const inviteRes = await app.request('/api/auth/invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `excalimore_session=${adminCookie}`,
      },
      body: JSON.stringify({}),
    })
    expect(inviteRes.status).toBe(200)
    const { token: inviteToken } = (await inviteRes.json()) as { token: string }

    // 4. Invitee signs up using the invite token.
    const guestSignup = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: inviteToken,
        email: 'guest@excalimore.test',
        password: 'guest-password',
        name: 'Guest',
      }),
    })
    expect(guestSignup.status).toBe(200)
    const guestCookie = getCookie(guestSignup, 'excalimore_session')
    expect(guestCookie).toBeTruthy()

    // 5. Guest hits /me — should get their identity.
    const meRes = await app.request('/api/auth/me', {
      headers: { Cookie: `excalimore_session=${guestCookie}` },
    })
    expect(meRes.status).toBe(200)
    const meBody = (await meRes.json()) as { user: { email: string; role: string } }
    expect(meBody.user.email).toBe('guest@excalimore.test')
    expect(meBody.user.role).toBe('user')

    // 6. Guest logs out — subsequent /me with same cookie returns 401.
    const logoutRes = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: `excalimore_session=${guestCookie}` },
    })
    expect(logoutRes.status).toBe(200)

    const meAfter = await app.request('/api/auth/me', {
      headers: { Cookie: `excalimore_session=${guestCookie}` },
    })
    expect(meAfter.status).toBe(401)
  })

  it('rejects login with wrong password', async () => {
    // Seed a user via the bootstrap path.
    const bootstrapToken = await detectFirstRunAndIssueToken(db, 60)
    await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: bootstrapToken,
        email: 'user@excalimore.test',
        password: 'real-password',
        name: 'User',
      }),
    })

    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@excalimore.test', password: 'wrong' }),
    })
    expect(loginRes.status).toBe(401)
  })

  it('rejects /me without a session cookie', async () => {
    const res = await app.request('/api/auth/me')
    expect(res.status).toBe(401)
  })
})
