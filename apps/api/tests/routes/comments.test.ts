import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildCommentItemRouter } from '../../src/routes/comments'
import { buildScenesRouter } from '../../src/routes/scenes'
import type { DbClient } from '../../src/db/client'
import { comments, scenes, shareGrants, users } from '../../src/db/schema'
import { buildAuthedApp, createTestUser, csrfHeaders, getTestDb } from '../helpers'

let db: DbClient

beforeAll(async () => {
  db = getTestDb()
  await db.delete(comments)
  await db.delete(shareGrants)
  await db.delete(scenes)
  await db.delete(users)
})

afterEach(async () => {
  await db.delete(comments)
  await db.delete(shareGrants)
  await db.delete(scenes)
  await db.delete(users)
})

const EMPTY_SCENE_DATA = { type: 'excalidraw', elements: [], appState: {}, files: {} }

function mountFull(app: ReturnType<typeof buildAuthedApp>['app']) {
  app.route('/scenes', buildScenesRouter())
  app.route('/comments', buildCommentItemRouter())
}

describe('POST /scenes/:sceneId/comments', () => {
  it('owner creates a comment', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()

    const { app } = buildAuthedApp(alice)
    mountFull(app)

    const res = await app.request(`/scenes/${scene!.id}/comments`, {
      method: 'POST',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ elementId: 'elem1', body: 'looks good' }),
    })
    expect(res.status).toBe(200)
    const { comment } = (await res.json()) as { comment: { body: string; authorId: string } }
    expect(comment.body).toBe('looks good')
    expect(comment.authorId).toBe(alice.id)
  })

  it('view-grant holder can create a comment', async () => {
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
    mountFull(app)

    const res = await app.request(`/scenes/${scene!.id}/comments`, {
      method: 'POST',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ elementId: 'elem1', body: 'feedback' }),
    })
    expect(res.status).toBe(200)
  })

  it('stranger cannot create a comment', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: stranger } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()

    const { app } = buildAuthedApp(stranger)
    mountFull(app)

    const res = await app.request(`/scenes/${scene!.id}/comments`, {
      method: 'POST',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ elementId: 'e', body: 'x' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('GET /scenes/:sceneId/comments', () => {
  it('returns scene comments to a viewer; excludes resolved by default', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()
    await db.insert(comments).values([
      { sceneId: scene!.id, authorId: alice.id, elementId: 'a', body: 'open' },
      { sceneId: scene!.id, authorId: alice.id, elementId: 'b', body: 'done', resolved: true },
    ])

    const { app } = buildAuthedApp(alice)
    mountFull(app)
    const res = await app.request(`/scenes/${scene!.id}/comments`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { comments: Array<{ body: string; resolved: boolean }> }
    expect(body.comments).toHaveLength(1)
    expect(body.comments[0]!.body).toBe('open')

    const resAll = await app.request(`/scenes/${scene!.id}/comments?include_resolved=true`)
    const bodyAll = (await resAll.json()) as { comments: unknown[] }
    expect(bodyAll.comments).toHaveLength(2)
  })
})

describe('PATCH /comments/:id', () => {
  it('author can edit own comment body', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()
    const [comment] = await db
      .insert(comments)
      .values({ sceneId: scene!.id, authorId: alice.id, elementId: 'a', body: 'old' })
      .returning()

    const { app } = buildAuthedApp(alice)
    mountFull(app)
    const res = await app.request(`/comments/${comment!.id}`, {
      method: 'PATCH',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ body: 'new' }),
    })
    expect(res.status).toBe(200)
    const after = await db.select().from(comments).where(eq(comments.id, comment!.id))
    expect(after[0]!.body).toBe('new')
  })

  it('non-author non-owner cannot edit', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()
    await db
      .insert(shareGrants)
      .values({ sceneId: scene!.id, userId: bob.id, permission: 'view', grantedBy: alice.id })
    const [comment] = await db
      .insert(comments)
      .values({ sceneId: scene!.id, authorId: alice.id, elementId: 'a', body: 'alices' })
      .returning()

    const { app } = buildAuthedApp(bob)
    mountFull(app)
    const res = await app.request(`/comments/${comment!.id}`, {
      method: 'PATCH',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ body: 'hijack' }),
    })
    expect(res.status).toBe(403)
  })

  it('scene owner can resolve any comment', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()
    await db
      .insert(shareGrants)
      .values({ sceneId: scene!.id, userId: bob.id, permission: 'view', grantedBy: alice.id })
    const [comment] = await db
      .insert(comments)
      .values({ sceneId: scene!.id, authorId: bob.id, elementId: 'a', body: 'bobs' })
      .returning()

    const { app } = buildAuthedApp(alice)
    mountFull(app)
    const res = await app.request(`/comments/${comment!.id}`, {
      method: 'PATCH',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ resolved: true }),
    })
    expect(res.status).toBe(200)
    const after = await db.select().from(comments).where(eq(comments.id, comment!.id))
    expect(after[0]!.resolved).toBe(true)
  })
})

describe('DELETE /comments/:id', () => {
  it('author can delete own comment', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()
    const [comment] = await db
      .insert(comments)
      .values({ sceneId: scene!.id, authorId: alice.id, elementId: 'a', body: 'gone' })
      .returning()

    const { app } = buildAuthedApp(alice)
    mountFull(app)
    const res = await app.request(`/comments/${comment!.id}`, {
      method: 'DELETE',
      headers: csrfHeaders(),
    })
    expect(res.status).toBe(200)
    const after = await db.select().from(comments).where(eq(comments.id, comment!.id))
    expect(after).toHaveLength(0)
  })
})
