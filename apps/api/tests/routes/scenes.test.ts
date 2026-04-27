import type { ExcalidrawSceneData } from '@excalimore/types'
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

const EMPTY_SCENE_DATA: ExcalidrawSceneData = {
  type: 'excalidraw',
  elements: [],
  appState: {},
  files: {},
}

describe('GET /scenes', () => {
  it('lists own scenes when shared=false (default)', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    await db.insert(scenes).values({ ownerId: alice.id, name: 'mine', data: EMPTY_SCENE_DATA })

    const { app } = buildAuthedApp(alice)
    app.route('/scenes', buildScenesRouter())

    const res = await app.request('/scenes')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { scenes: Array<{ name: string }> }
    expect(body.scenes).toHaveLength(1)
    expect(body.scenes[0]!.name).toBe('mine')
  })

  it('lists shared scenes when shared=true', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    const [aliceScene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 'alices', data: EMPTY_SCENE_DATA })
      .returning()
    await db.insert(shareGrants).values({
      sceneId: aliceScene!.id,
      userId: bob.id,
      permission: 'view',
      grantedBy: alice.id,
    })

    const { app } = buildAuthedApp(bob)
    app.route('/scenes', buildScenesRouter())

    const res = await app.request('/scenes?shared=true')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { scenes: Array<{ name: string; permission: string }> }
    expect(body.scenes).toHaveLength(1)
    expect(body.scenes[0]!.name).toBe('alices')
    expect(body.scenes[0]!.permission).toBe('view')
  })
})

describe('POST /scenes', () => {
  it('creates a scene owned by the caller', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { app } = buildAuthedApp(alice)
    app.route('/scenes', buildScenesRouter())

    const res = await app.request('/scenes', {
      method: 'POST',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'fresh' }),
    })
    expect(res.status).toBe(200)
    const { scene } = (await res.json()) as {
      scene: { id: string; name: string; ownerId: string }
    }
    expect(scene.name).toBe('fresh')
    expect(scene.ownerId).toBe(alice.id)
  })
})

describe('GET /scenes/:id', () => {
  it('returns scene with data for the owner', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const [created] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: { ...EMPTY_SCENE_DATA, version: 2 } })
      .returning()

    const { app } = buildAuthedApp(alice)
    app.route('/scenes', buildScenesRouter())

    const res = await app.request(`/scenes/${created!.id}`)
    expect(res.status).toBe(200)
    const { scene } = (await res.json()) as { scene: { data: { version?: number } } }
    expect(scene.data.version).toBe(2)
  })

  it('returns 404 to a stranger', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: stranger } = await createTestUser(db, { password: 'pw' })
    const [created] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()

    const { app } = buildAuthedApp(stranger)
    app.route('/scenes', buildScenesRouter())

    const res = await app.request(`/scenes/${created!.id}`)
    expect(res.status).toBe(404)
  })

  it('returns scene to a view-grant holder', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    const [created] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()
    await db
      .insert(shareGrants)
      .values({ sceneId: created!.id, userId: bob.id, permission: 'view', grantedBy: alice.id })

    const { app } = buildAuthedApp(bob)
    app.route('/scenes', buildScenesRouter())

    const res = await app.request(`/scenes/${created!.id}`)
    expect(res.status).toBe(200)
  })
})

describe('PATCH /scenes/:id', () => {
  it('owner can update name and data', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 'old', data: EMPTY_SCENE_DATA })
      .returning()

    const { app } = buildAuthedApp(alice)
    app.route('/scenes', buildScenesRouter())

    const newData = {
      type: 'excalidraw',
      elements: [{ id: 'a', type: 'rectangle' }],
      appState: {},
      files: {},
    }
    const res = await app.request(`/scenes/${scene!.id}`, {
      method: 'PATCH',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'new', data: newData }),
    })
    expect(res.status).toBe(200)
    const after = await db.select().from(scenes).where(eq(scenes.id, scene!.id))
    expect(after[0]!.name).toBe('new')
    expect((after[0]!.data as { elements: unknown[] }).elements).toHaveLength(1)
  })

  it('edit-grant holder can update data but not folder', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()
    await db
      .insert(shareGrants)
      .values({ sceneId: scene!.id, userId: bob.id, permission: 'edit', grantedBy: alice.id })

    const { app } = buildAuthedApp(bob)
    app.route('/scenes', buildScenesRouter())

    const dataOk = await app.request(`/scenes/${scene!.id}`, {
      method: 'PATCH',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ data: EMPTY_SCENE_DATA }),
    })
    expect(dataOk.status).toBe(200)

    const folderForbidden = await app.request(`/scenes/${scene!.id}`, {
      method: 'PATCH',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ folderId: '00000000-0000-0000-0000-000000000000' }),
    })
    expect(folderForbidden.status).toBe(403)
  })

  it('view-grant holder cannot save scene data', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()
    await db
      .insert(shareGrants)
      .values({ sceneId: scene!.id, userId: bob.id, permission: 'view', grantedBy: alice.id })

    const { app } = buildAuthedApp(bob)
    app.route('/scenes', buildScenesRouter())

    const res = await app.request(`/scenes/${scene!.id}`, {
      method: 'PATCH',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ data: EMPTY_SCENE_DATA }),
    })
    expect(res.status).toBe(403)
  })
})

describe('DELETE /scenes/:id', () => {
  it('owner can delete', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()

    const { app } = buildAuthedApp(alice)
    app.route('/scenes', buildScenesRouter())

    const res = await app.request(`/scenes/${scene!.id}`, {
      method: 'DELETE',
      headers: csrfHeaders(),
    })
    expect(res.status).toBe(200)
    const after = await db.select().from(scenes).where(eq(scenes.id, scene!.id))
    expect(after).toHaveLength(0)
  })

  it('edit-grant holder cannot delete', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()
    await db
      .insert(shareGrants)
      .values({ sceneId: scene!.id, userId: bob.id, permission: 'edit', grantedBy: alice.id })

    const { app } = buildAuthedApp(bob)
    app.route('/scenes', buildScenesRouter())

    const res = await app.request(`/scenes/${scene!.id}`, {
      method: 'DELETE',
      headers: csrfHeaders(),
    })
    expect(res.status).toBe(403)
  })
})
