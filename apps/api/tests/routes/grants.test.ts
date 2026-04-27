import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildScenesRouter } from '../../src/routes/scenes'
import type { DbClient } from '../../src/db/client'
import { scenes, shareGrants, users } from '../../src/db/schema'
import { buildAuthedApp, createTestUser, csrfHeaders, getTestDb } from '../helpers'

let db: DbClient

beforeAll(async () => {
  db = getTestDb()
  await db.delete(shareGrants)
  await db.delete(scenes)
  await db.delete(users)
})

afterEach(async () => {
  await db.delete(shareGrants)
  await db.delete(scenes)
  await db.delete(users)
})

const EMPTY_SCENE_DATA = { type: 'excalidraw', elements: [], appState: {}, files: {} }

describe('POST /scenes/:sceneId/grants', () => {
  it('owner can grant view permission', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()

    const { app } = buildAuthedApp(alice)
    app.route('/scenes', buildScenesRouter())
    const res = await app.request(`/scenes/${scene!.id}/grants`, {
      method: 'POST',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ userId: bob.id, permission: 'view' }),
    })
    expect(res.status).toBe(200)
    const grants = await db.select().from(shareGrants).where(eq(shareGrants.sceneId, scene!.id))
    expect(grants).toHaveLength(1)
    expect(grants[0]!.permission).toBe('view')
  })

  it('non-owner cannot grant', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    const { row: carol } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()
    await db
      .insert(shareGrants)
      .values({ sceneId: scene!.id, userId: bob.id, permission: 'edit', grantedBy: alice.id })

    const { app } = buildAuthedApp(bob)
    app.route('/scenes', buildScenesRouter())
    const res = await app.request(`/scenes/${scene!.id}/grants`, {
      method: 'POST',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ userId: carol.id, permission: 'view' }),
    })
    expect(res.status).toBe(403)
  })

  it('rejects duplicate grant for same user', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()
    await db
      .insert(shareGrants)
      .values({ sceneId: scene!.id, userId: bob.id, permission: 'view', grantedBy: alice.id })

    const { app } = buildAuthedApp(alice)
    app.route('/scenes', buildScenesRouter())
    const res = await app.request(`/scenes/${scene!.id}/grants`, {
      method: 'POST',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ userId: bob.id, permission: 'edit' }),
    })
    expect(res.status).toBe(409)
  })
})

describe('GET /scenes/:sceneId/grants', () => {
  it('owner sees all grants for the scene', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()
    await db
      .insert(shareGrants)
      .values({ sceneId: scene!.id, userId: bob.id, permission: 'edit', grantedBy: alice.id })

    const { app } = buildAuthedApp(alice)
    app.route('/scenes', buildScenesRouter())
    const res = await app.request(`/scenes/${scene!.id}/grants`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { grants: Array<{ userId: string; permission: string }> }
    expect(body.grants).toHaveLength(1)
    expect(body.grants[0]!.userId).toBe(bob.id)
  })
})

describe('DELETE /scenes/:sceneId/grants/:grantId', () => {
  it('owner can revoke a grant', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()
    const [grant] = await db
      .insert(shareGrants)
      .values({ sceneId: scene!.id, userId: bob.id, permission: 'view', grantedBy: alice.id })
      .returning()

    const { app } = buildAuthedApp(alice)
    app.route('/scenes', buildScenesRouter())
    const res = await app.request(`/scenes/${scene!.id}/grants/${grant!.id}`, {
      method: 'DELETE',
      headers: csrfHeaders(),
    })
    expect(res.status).toBe(200)
    const remaining = await db.select().from(shareGrants).where(eq(shareGrants.sceneId, scene!.id))
    expect(remaining).toHaveLength(0)
  })
})
