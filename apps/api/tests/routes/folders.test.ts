import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { DbClient } from '../../src/db/client'
import { folders, users } from '../../src/db/schema'
import { buildFoldersRouter } from '../../src/routes/folders'
import { buildAuthedApp, createTestUser, csrfHeaders, getTestDb } from '../helpers'

let db: DbClient

beforeAll(async () => {
  db = getTestDb()
  await db.delete(folders)
  await db.delete(users)
})

afterEach(async () => {
  await db.delete(folders)
  await db.delete(users)
})

describe('GET /folders', () => {
  it('returns a flat list of folders owned by the user', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const [root] = await db.insert(folders).values({ ownerId: alice.id, name: 'work' }).returning()
    await db.insert(folders).values({ ownerId: alice.id, name: 'projects', parentId: root!.id })

    const { app } = buildAuthedApp(alice)
    app.route('/folders', buildFoldersRouter())

    const res = await app.request('/folders')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { folders: Array<{ id: string; name: string }> }
    expect(body.folders).toHaveLength(2)
    expect(body.folders.map((f) => f.name).sort()).toEqual(['projects', 'work'])
  })

  it('does not include other users folders', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    await db.insert(folders).values({ ownerId: bob.id, name: 'bobs-folder' })

    const { app } = buildAuthedApp(alice)
    app.route('/folders', buildFoldersRouter())
    const res = await app.request('/folders')
    const body = (await res.json()) as { folders: unknown[] }
    expect(body.folders).toHaveLength(0)
  })
})

describe('POST /folders', () => {
  it('creates a folder owned by the caller', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { app } = buildAuthedApp(alice)
    app.route('/folders', buildFoldersRouter())

    const res = await app.request('/folders', {
      method: 'POST',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'new' }),
    })
    expect(res.status).toBe(200)
    const { folder } = (await res.json()) as {
      folder: { id: string; name: string; ownerId: string }
    }
    expect(folder.name).toBe('new')
    expect(folder.ownerId).toBe(alice.id)
  })

  it('rejects creating a folder under another users parent', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    const [bobFolder] = await db
      .insert(folders)
      .values({ ownerId: bob.id, name: 'bob' })
      .returning()

    const { app } = buildAuthedApp(alice)
    app.route('/folders', buildFoldersRouter())

    const res = await app.request('/folders', {
      method: 'POST',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'sneaky', parentId: bobFolder!.id }),
    })
    expect(res.status).toBe(404)
  })

  it('rejects nesting deeper than MAX_FOLDER_DEPTH', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    let parentId: string | null = null
    for (let i = 0; i < 5; i++) {
      const currentParent: string | null = parentId
      const result: Array<{ id: string }> = await db
        .insert(folders)
        .values({ ownerId: alice.id, name: `level-${i}`, parentId: currentParent })
        .returning()
      parentId = result[0]!.id
    }

    const { app } = buildAuthedApp(alice)
    app.route('/folders', buildFoldersRouter())

    const res = await app.request('/folders', {
      method: 'POST',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'too-deep', parentId }),
    })
    expect(res.status).toBe(422)
  })
})

describe('PATCH /folders/:id', () => {
  it('renames a folder', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const [folder] = await db.insert(folders).values({ ownerId: alice.id, name: 'old' }).returning()

    const { app } = buildAuthedApp(alice)
    app.route('/folders', buildFoldersRouter())

    const res = await app.request(`/folders/${folder!.id}`, {
      method: 'PATCH',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'new' }),
    })
    expect(res.status).toBe(200)
    const after = await db.select().from(folders).where(eq(folders.id, folder!.id))
    expect(after[0]!.name).toBe('new')
  })

  it('returns 404 when patching another users folder', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    const [folder] = await db.insert(folders).values({ ownerId: bob.id, name: 'bob' }).returning()

    const { app } = buildAuthedApp(alice)
    app.route('/folders', buildFoldersRouter())

    const res = await app.request(`/folders/${folder!.id}`, {
      method: 'PATCH',
      headers: csrfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'taken' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /folders/:id', () => {
  it('deletes a folder', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const [folder] = await db
      .insert(folders)
      .values({ ownerId: alice.id, name: 'gone' })
      .returning()

    const { app } = buildAuthedApp(alice)
    app.route('/folders', buildFoldersRouter())

    const res = await app.request(`/folders/${folder!.id}`, {
      method: 'DELETE',
      headers: csrfHeaders(),
    })
    expect(res.status).toBe(200)
    const after = await db.select().from(folders).where(eq(folders.id, folder!.id))
    expect(after).toHaveLength(0)
  })
})
