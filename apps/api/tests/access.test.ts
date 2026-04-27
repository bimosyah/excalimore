import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getSceneAccess } from '../src/access'
import type { DbClient } from '../src/db/client'
import { scenes, shareGrants, users } from '../src/db/schema'
import { createTestUser, getTestDb } from './helpers'

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

async function makeScene(ownerId: string, name = 'scene') {
  const [row] = await db
    .insert(scenes)
    .values({ ownerId, name, data: { elements: [], appState: {}, files: {} } })
    .returning()
  if (!row) throw new Error('failed to insert scene')
  return row
}

describe('getSceneAccess', () => {
  it('returns owner for the scene owner', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const scene = await makeScene(alice.id)
    expect(await getSceneAccess(db, alice.id, scene.id)).toBe('owner')
  })

  it('returns edit for a user with edit grant', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    const scene = await makeScene(alice.id)
    await db
      .insert(shareGrants)
      .values({ sceneId: scene.id, userId: bob.id, permission: 'edit', grantedBy: alice.id })
    expect(await getSceneAccess(db, bob.id, scene.id)).toBe('edit')
  })

  it('returns view for a user with view grant', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    const scene = await makeScene(alice.id)
    await db
      .insert(shareGrants)
      .values({ sceneId: scene.id, userId: bob.id, permission: 'view', grantedBy: alice.id })
    expect(await getSceneAccess(db, bob.id, scene.id)).toBe('view')
  })

  it('returns none for a user with no grant', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: stranger } = await createTestUser(db, { password: 'pw' })
    const scene = await makeScene(alice.id)
    expect(await getSceneAccess(db, stranger.id, scene.id)).toBe('none')
  })

  it('returns none for unknown scene id', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    expect(await getSceneAccess(db, alice.id, '00000000-0000-0000-0000-000000000000')).toBe('none')
  })
})
