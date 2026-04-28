import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildAuthRouter,
  detectFirstRunAndIssueToken,
  injectContext,
  loadSession,
} from '../src/auth'
import type { AppEnv } from '../src/context'
import {
  bootstrapTokens,
  comments,
  inviteTokens,
  scenes,
  sessions,
  shareGrants,
  users,
} from '../src/db/schema'
import { loadEnv } from '../src/env'
import { buildCommentItemRouter } from '../src/routes/comments'
import { buildEventsRouter } from '../src/routes/events'
import { buildFoldersRouter } from '../src/routes/folders'
import { buildScenesRouter } from '../src/routes/scenes'
import { getTestDb } from './helpers'

function buildFullApp() {
  const db = getTestDb()
  const env = loadEnv()
  const app = new Hono<AppEnv>()
  app.use('*', injectContext(db, env))
  app.use('*', loadSession())
  app.route('/api/auth', buildAuthRouter(env))
  app.route('/api/folders', buildFoldersRouter())
  app.route('/api/scenes', buildScenesRouter())
  app.route('/api/comments', buildCommentItemRouter())
  app.route('/api/events', buildEventsRouter())
  return { app, db, env }
}

const { app, db, env } = buildFullApp()

afterEach(async () => {
  await db.delete(comments)
  await db.delete(sessions)
  await db.delete(shareGrants)
  await db.delete(inviteTokens)
  await db.delete(bootstrapTokens)
  await db.delete(scenes)
  await db.delete(users)
})

function getCookie(res: Response, name: string): string | undefined {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';')
    if (!pair) continue
    const idx = pair.indexOf('=')
    if (idx < 0) continue
    if (pair.slice(0, idx) === name) return decodeURIComponent(pair.slice(idx + 1))
  }
  return undefined
}

describe('full API flow', () => {
  it('admin → scene → invite (with grant) → guest comment → owner can delete', async () => {
    const bootstrapToken = await detectFirstRunAndIssueToken(db, env.BOOTSTRAP_TOKEN_TTL)
    const adminSignup = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: bootstrapToken,
        email: 'admin@x.test',
        password: 'admin-password',
        name: 'Admin',
      }),
    })
    expect(adminSignup.status).toBe(200)
    const aSess = getCookie(adminSignup, 'excalimore_session')!
    const aCsrf = getCookie(adminSignup, 'excalimore_csrf')!

    // Admin creates a scene
    const sceneRes = await app.request('/api/scenes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `excalimore_session=${aSess}; excalimore_csrf=${aCsrf}`,
        'X-CSRF-Token': aCsrf,
      },
      body: JSON.stringify({ name: 'shared-scene' }),
    })
    expect(sceneRes.status).toBe(200)
    const { scene } = (await sceneRes.json()) as { scene: { id: string } }

    // Admin generates invite that pre-grants view permission
    const inviteRes = await app.request('/api/auth/invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `excalimore_session=${aSess}; excalimore_csrf=${aCsrf}`,
        'X-CSRF-Token': aCsrf,
      },
      body: JSON.stringify({ sceneId: scene.id, permission: 'view' }),
    })
    expect(inviteRes.status).toBe(200)
    const { token: inviteToken } = (await inviteRes.json()) as { token: string }

    // Guest signs up via invite
    const guestSignup = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: inviteToken,
        email: 'guest@x.test',
        password: 'guest-password',
        name: 'Guest',
      }),
    })
    expect(guestSignup.status).toBe(200)
    const gSess = getCookie(guestSignup, 'excalimore_session')!
    const gCsrf = getCookie(guestSignup, 'excalimore_csrf')!

    // Guest can read the scene
    const guestRead = await app.request(`/api/scenes/${scene.id}`, {
      headers: { Cookie: `excalimore_session=${gSess}` },
    })
    expect(guestRead.status).toBe(200)

    // Guest leaves a comment
    const commentRes = await app.request(`/api/scenes/${scene.id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `excalimore_session=${gSess}; excalimore_csrf=${gCsrf}`,
        'X-CSRF-Token': gCsrf,
      },
      body: JSON.stringify({ elementId: 'el-1', body: 'looks good' }),
    })
    expect(commentRes.status).toBe(200)
    const { comment } = (await commentRes.json()) as { comment: { id: string } }

    // Guest cannot save scene data (view-only)
    const guestSaveAttempt = await app.request(`/api/scenes/${scene.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `excalimore_session=${gSess}; excalimore_csrf=${gCsrf}`,
        'X-CSRF-Token': gCsrf,
      },
      body: JSON.stringify({
        data: { type: 'excalidraw', elements: [], appState: {}, files: {} },
      }),
    })
    expect(guestSaveAttempt.status).toBe(403)

    // Owner can delete the guest's comment
    const adminDelete = await app.request(`/api/comments/${comment.id}`, {
      method: 'DELETE',
      headers: {
        Cookie: `excalimore_session=${aSess}; excalimore_csrf=${aCsrf}`,
        'X-CSRF-Token': aCsrf,
      },
    })
    expect(adminDelete.status).toBe(200)
  })

  // The Share modal (Phase 6) lets non-admin scene owners generate invite
  // links scoped to their own scenes. This test pins that behavior.
  it('non-admin scene owner can invite to a scene they own but not to others', async () => {
    // 1. Bootstrap admin so the server allows invite generation at all.
    const bootstrapToken = await detectFirstRunAndIssueToken(db, env.BOOTSTRAP_TOKEN_TTL)
    const adminSignup = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: bootstrapToken,
        email: 'owner-admin@x.test',
        password: 'admin-password',
        name: 'Admin',
      }),
    })
    expect(adminSignup.status).toBe(200)
    const aSess = getCookie(adminSignup, 'excalimore_session')!
    const aCsrf = getCookie(adminSignup, 'excalimore_csrf')!

    // 2. Admin invites a non-admin user (no scene grant — generic invite).
    const inviteRes = await app.request('/api/auth/invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `excalimore_session=${aSess}; excalimore_csrf=${aCsrf}`,
        'X-CSRF-Token': aCsrf,
      },
      body: JSON.stringify({}),
    })
    expect(inviteRes.status).toBe(200)
    const { token: userInvite } = (await inviteRes.json()) as { token: string }

    // 3. Sign up the regular user via the invite.
    const userSignup = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: userInvite,
        email: 'creator@x.test',
        password: 'creator-password',
        name: 'Creator',
      }),
    })
    expect(userSignup.status).toBe(200)
    const uSess = getCookie(userSignup, 'excalimore_session')!
    const uCsrf = getCookie(userSignup, 'excalimore_csrf')!

    // 4. Regular user creates a scene of their own.
    const sceneRes = await app.request('/api/scenes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `excalimore_session=${uSess}; excalimore_csrf=${uCsrf}`,
        'X-CSRF-Token': uCsrf,
      },
      body: JSON.stringify({ name: 'creator-scene' }),
    })
    expect(sceneRes.status).toBe(200)
    const { scene: ownScene } = (await sceneRes.json()) as { scene: { id: string } }

    // 5. The non-admin scene owner CAN invite collaborators to their scene.
    const ownerInvite = await app.request('/api/auth/invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `excalimore_session=${uSess}; excalimore_csrf=${uCsrf}`,
        'X-CSRF-Token': uCsrf,
      },
      body: JSON.stringify({ sceneId: ownScene.id, permission: 'view' }),
    })
    expect(ownerInvite.status).toBe(200)

    // 6. But they CANNOT create a generic (no-scene) invite.
    const unscopedInvite = await app.request('/api/auth/invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `excalimore_session=${uSess}; excalimore_csrf=${uCsrf}`,
        'X-CSRF-Token': uCsrf,
      },
      body: JSON.stringify({}),
    })
    expect(unscopedInvite.status).toBe(403)

    // 7. And they cannot invite to a scene they don't own (the admin's scene).
    const adminScene = await app.request('/api/scenes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `excalimore_session=${aSess}; excalimore_csrf=${aCsrf}`,
        'X-CSRF-Token': aCsrf,
      },
      body: JSON.stringify({ name: 'admin-scene' }),
    })
    const { scene: adminOwnedScene } = (await adminScene.json()) as { scene: { id: string } }
    const otherSceneInvite = await app.request('/api/auth/invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `excalimore_session=${uSess}; excalimore_csrf=${uCsrf}`,
        'X-CSRF-Token': uCsrf,
      },
      body: JSON.stringify({ sceneId: adminOwnedScene.id, permission: 'view' }),
    })
    expect(otherSceneInvite.status).toBe(403)
  })
})
