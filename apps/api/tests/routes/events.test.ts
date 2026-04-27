import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildEventsRouter } from '../../src/routes/events'
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

describe('GET /events?scene_id=...', () => {
  it('streams a comment.created event when a comment is added', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()

    const { app } = buildAuthedApp(alice)
    app.route('/events', buildEventsRouter())
    app.route('/scenes', buildScenesRouter())

    const sseRes = await app.request(`/events?scene_id=${scene!.id}`)
    expect(sseRes.status).toBe(200)
    expect(sseRes.headers.get('content-type')).toMatch(/event-stream/)

    const reader = sseRes.body!.getReader()
    const decoder = new TextDecoder()

    const readUntil = async (marker: string, timeoutMs = 2000) => {
      const start = Date.now()
      let buf = ''
      while (Date.now() - start < timeoutMs) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value)
        if (buf.includes(marker)) return buf
      }
      throw new Error(`timed out waiting for ${marker}; got: ${buf}`)
    }

    await readUntil('event: ready')

    const post = await app.request(`/scenes/${scene!.id}/comments`, {
      method: 'POST',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ elementId: 'e1', body: 'hi' }),
    })
    expect(post.status).toBe(200)

    const buf = await readUntil('comment.created')
    expect(buf).toContain('comment.created')

    await reader.cancel()
  })

  it('rejects subscription to a scene the user cannot view', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: stranger } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()

    const { app } = buildAuthedApp(stranger)
    app.route('/events', buildEventsRouter())

    const res = await app.request(`/events?scene_id=${scene!.id}`)
    expect(res.status).toBe(404)
  })
})
