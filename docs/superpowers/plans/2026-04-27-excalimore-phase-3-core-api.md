# Excalimore Implementation Plan — Phase 3: Core API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the four resource APIs the editor and frontend depend on — folders, scenes (with sharing), comments, and a per-scene SSE event stream — all gated by the access-control rules from §6 of the spec. End state: a session-cookie holder can create folders, create/save scenes, share scenes with permissions, leave anchored comments, and receive comment notifications via SSE.

**Architecture:** Each resource gets its own router under `src/routes/`. A shared `src/access.ts` module computes the caller's effective role (`owner`/`edit`/`view`/`none`) on a scene, used uniformly across scenes/comments/events. SSE uses an in-memory pub/sub broker keyed by `sceneId`; mutations on comments/scenes broadcast through it. CSRF protection is applied to mutating endpoints; auth establishment endpoints in Phase 2 already opted out.

**Tech Stack:** No new runtime dependencies. Uses existing `hono`, `drizzle-orm`, `postgres`, `zod`, plus Hono's `streamSSE` helper for the event endpoint.

**Spec reference:** [`../specs/2026-04-27-excalimore-design.md`](../specs/2026-04-27-excalimore-design.md), §6 (API surface), §7 (comment overlay — server-side parts).

**Phase 2 prerequisite:** Auth module produces a `ctx.var.user` for authenticated requests; `csrfProtect()` middleware available; `httpError()` helper available; `injectContext` and `loadSession` already wired in `apps/api/src/index.ts`.

---

## Phase 3 File Structure

After Phase 3:

```
apps/api/
├── src/
│   ├── access.ts                       # NEW — getSceneAccess(db,userId,sceneId)
│   ├── routes/
│   │   ├── folders.ts                  # NEW — buildFoldersRouter()
│   │   ├── scenes.ts                   # NEW — buildScenesRouter()
│   │   ├── grants.ts                   # NEW — buildGrantsRouter() — mounted under /scenes/:id
│   │   ├── comments.ts                 # NEW — buildCommentsRouter()
│   │   └── events.ts                   # NEW — buildEventsRouter() (SSE)
│   ├── events/
│   │   └── broker.ts                   # NEW — in-memory pub/sub by sceneId
│   └── index.ts                        # MODIFY — wire new routers
├── tests/
│   ├── access.test.ts                  # NEW — unit tests for access resolver
│   ├── routes/
│   │   ├── folders.test.ts             # NEW — integration
│   │   ├── scenes.test.ts              # NEW — integration
│   │   ├── grants.test.ts              # NEW — integration
│   │   ├── comments.test.ts            # NEW — integration
│   │   └── events.test.ts              # NEW — SSE integration
│   ├── flow.api.test.ts                # NEW — end-to-end (own scene → share → invitee comments → SSE event)
│   └── helpers.ts                      # MODIFY — add buildAuthedApp() & csrf helper
docs/
└── api.md                              # NEW — operator/contributor reference for /api/* endpoints
```

---

## Tasks

### Task 1: Access control resolver

**Files:**
- Create: `apps/api/src/access.ts`
- Create: `apps/api/tests/access.test.ts`

The resolver answers: "what is user X's effective role on scene Y?" — the only function downstream routes need to call to gate behavior.

- [ ] **Step 1: Write failing test**

Create `apps/api/tests/access.test.ts`:

```ts
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
    expect(
      await getSceneAccess(db, alice.id, '00000000-0000-0000-0000-000000000000'),
    ).toBe('none')
  })
})
```

- [ ] **Step 2: Run test (fails)**

Run: `pnpm --filter @excalimore/api test tests/access.test.ts`
Expected: import error.

- [ ] **Step 3: Implement**

Create `apps/api/src/access.ts`:

```ts
import { and, eq } from 'drizzle-orm'
import type { DbClient } from './db/client'
import { scenes, shareGrants } from './db/schema'

export type SceneRole = 'owner' | 'edit' | 'view' | 'none'

/**
 * Returns the caller's effective role on a scene:
 *   - 'owner' — they created the scene
 *   - 'edit'  — they have an `edit` share grant
 *   - 'view'  — they have a `view` share grant
 *   - 'none'  — no relationship (or scene doesn't exist)
 */
export async function getSceneAccess(
  db: DbClient,
  userId: string,
  sceneId: string,
): Promise<SceneRole> {
  const sceneRow = await db
    .select({ ownerId: scenes.ownerId })
    .from(scenes)
    .where(eq(scenes.id, sceneId))
    .limit(1)
  const scene = sceneRow[0]
  if (!scene) return 'none'
  if (scene.ownerId === userId) return 'owner'

  const grantRow = await db
    .select({ permission: shareGrants.permission })
    .from(shareGrants)
    .where(and(eq(shareGrants.sceneId, sceneId), eq(shareGrants.userId, userId)))
    .limit(1)
  const grant = grantRow[0]
  if (!grant) return 'none'
  return grant.permission === 'edit' ? 'edit' : 'view'
}

/** True iff the role permits at least the requested level. */
export function roleAllows(role: SceneRole, required: 'owner' | 'edit' | 'view'): boolean {
  if (role === 'none') return false
  if (required === 'view') return true // any non-none role can view
  if (required === 'edit') return role === 'owner' || role === 'edit'
  return role === 'owner' // 'owner' required
}
```

- [ ] **Step 4: Run test (passes)**

Run: `pnpm --filter @excalimore/api test tests/access.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/access.ts apps/api/tests/access.test.ts
git commit -m "feat(api): add scene access resolver with role hierarchy"
```

---

### Task 2: Folders router (CRUD)

**Files:**
- Create: `apps/api/src/routes/folders.ts`
- Create: `apps/api/tests/routes/folders.test.ts`
- Modify: `apps/api/tests/helpers.ts` — add `buildAuthedApp(user)` helper

Folders are owner-only resources. No sharing. The router is small and self-contained.

- [ ] **Step 1: Extend `apps/api/tests/helpers.ts`**

Add the new function and required imports without duplicating existing imports. Final file should look like:

```ts
import { Hono } from 'hono'
import { hashPassword } from '../src/auth/password'
import { injectContext } from '../src/auth/middleware'
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
```

- [ ] **Step 2: Write the failing tests**

Create `apps/api/tests/routes/folders.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildFoldersRouter } from '../../src/routes/folders'
import type { DbClient } from '../../src/db/client'
import { folders, users } from '../../src/db/schema'
import { buildAuthedApp, createTestUser } from '../helpers'

let db: DbClient

beforeAll(async () => {
  db = (await import('../helpers')).getTestDb()
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
    const [child] = await db
      .insert(folders)
      .values({ ownerId: alice.id, name: 'projects', parentId: root!.id })
      .returning()

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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'new' }),
    })
    expect(res.status).toBe(200)
    const { folder } = (await res.json()) as { folder: { id: string; name: string; ownerId: string } }
    expect(folder.name).toBe('new')
    expect(folder.ownerId).toBe(alice.id)
  })

  it('rejects creating a folder under another users parent', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    const [bobFolder] = await db.insert(folders).values({ ownerId: bob.id, name: 'bob' }).returning()

    const { app } = buildAuthedApp(alice)
    app.route('/folders', buildFoldersRouter())

    const res = await app.request('/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'sneaky', parentId: bobFolder!.id }),
    })
    expect(res.status).toBe(404) // hide existence
  })

  it('rejects nesting deeper than MAX_FOLDER_DEPTH', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    // chain 5 deep, attempt 6th
    let parentId: string | null = null
    for (let i = 0; i < 5; i++) {
      const [row] = await db
        .insert(folders)
        .values({ ownerId: alice.id, name: `level-${i}`, parentId })
        .returning()
      parentId = row!.id
    }

    const { app } = buildAuthedApp(alice)
    app.route('/folders', buildFoldersRouter())

    const res = await app.request('/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'taken' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /folders/:id', () => {
  it('deletes a folder', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const [folder] = await db.insert(folders).values({ ownerId: alice.id, name: 'gone' }).returning()

    const { app } = buildAuthedApp(alice)
    app.route('/folders', buildFoldersRouter())

    const res = await app.request(`/folders/${folder!.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    const after = await db.select().from(folders).where(eq(folders.id, folder!.id))
    expect(after).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run tests (fail)**

Run: `pnpm --filter @excalimore/api test tests/routes/folders.test.ts`
Expected: import error.

- [ ] **Step 4: Implement**

Create `apps/api/src/routes/folders.ts`:

```ts
import { CreateFolderRequestSchema, MAX_FOLDER_DEPTH, UpdateFolderRequestSchema } from '@excalimore/types'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { folders } from '../db/schema'
import { httpError } from '../lib/http-errors'
import { csrfProtect, requireAuth } from '../auth/middleware'

async function depthOf(
  db: AppEnv['Variables']['db'],
  folderId: string,
  ownerId: string,
): Promise<number> {
  let id: string | null = folderId
  let depth = 0
  while (id) {
    const row = await db
      .select({ id: folders.id, parentId: folders.parentId, ownerId: folders.ownerId })
      .from(folders)
      .where(and(eq(folders.id, id), eq(folders.ownerId, ownerId)))
      .limit(1)
    if (!row[0]) return -1 // missing/foreign — caller should reject
    depth += 1
    id = row[0].parentId
    if (depth > MAX_FOLDER_DEPTH + 1) break // safety
  }
  return depth
}

export function buildFoldersRouter(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth())

  app.get('/', async (c) => {
    const owner = c.var.user!
    const rows = await db_list(c.var.db, owner.id)
    return c.json({ folders: rows })
  })

  app.post('/', csrfProtect(), async (c) => {
    const body = CreateFolderRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw httpError('invalid_input', 'invalid folder body')
    const owner = c.var.user!
    const db = c.var.db
    const parentId = body.data.parentId ?? null

    if (parentId) {
      const parentDepth = await depthOf(db, parentId, owner.id)
      if (parentDepth < 0) throw httpError('not_found', 'parent folder not found')
      if (parentDepth >= MAX_FOLDER_DEPTH) {
        throw httpError('invalid_input', `folder nesting capped at ${MAX_FOLDER_DEPTH}`)
      }
    }

    const [row] = await db
      .insert(folders)
      .values({ ownerId: owner.id, name: body.data.name, parentId })
      .returning()
    if (!row) throw httpError('internal', 'failed to create folder')
    return c.json({ folder: serialize(row) })
  })

  app.patch('/:id', csrfProtect(), async (c) => {
    const id = c.req.param('id')
    const body = UpdateFolderRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw httpError('invalid_input', 'invalid folder body')
    const owner = c.var.user!
    const db = c.var.db

    const existing = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, id), eq(folders.ownerId, owner.id)))
      .limit(1)
    if (!existing[0]) throw httpError('not_found', 'folder not found')

    const update: Record<string, unknown> = {}
    if (body.data.name !== undefined) update.name = body.data.name
    if (body.data.parentId !== undefined) {
      const newParentId = body.data.parentId
      if (newParentId !== null) {
        const parentDepth = await depthOf(db, newParentId, owner.id)
        if (parentDepth < 0) throw httpError('not_found', 'parent folder not found')
        if (parentDepth >= MAX_FOLDER_DEPTH) {
          throw httpError('invalid_input', `folder nesting capped at ${MAX_FOLDER_DEPTH}`)
        }
      }
      update.parentId = newParentId
    }
    update.updatedAt = new Date()

    await db.update(folders).set(update).where(eq(folders.id, id))
    return c.json({ ok: true })
  })

  app.delete('/:id', csrfProtect(), async (c) => {
    const id = c.req.param('id')
    const owner = c.var.user!
    const db = c.var.db
    const existing = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, id), eq(folders.ownerId, owner.id)))
      .limit(1)
    if (!existing[0]) throw httpError('not_found', 'folder not found')
    // ON DELETE CASCADE in schema handles child folders.
    await db.delete(folders).where(eq(folders.id, id))
    return c.json({ ok: true })
  })

  return app
}

async function db_list(db: AppEnv['Variables']['db'], ownerId: string) {
  const rows = await db.select().from(folders).where(eq(folders.ownerId, ownerId))
  return rows.map(serialize)
}

function serialize(row: { id: string; ownerId: string; parentId: string | null; name: string; createdAt: Date; updatedAt: Date }) {
  return {
    id: row.id,
    ownerId: row.ownerId,
    parentId: row.parentId,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
```

- [ ] **Step 5: Run tests (pass)**

Run: `pnpm --filter @excalimore/api test tests/routes/folders.test.ts`
Expected: 7 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/folders.ts apps/api/tests/routes/folders.test.ts apps/api/tests/helpers.ts
git commit -m "feat(api): add /folders router with depth-capped nesting"
```

---

### Task 3: Scenes core (list, create, get)

**Files:**
- Create: `apps/api/src/routes/scenes.ts` (skeleton + 3 endpoints; mutate routes added in Task 4)
- Create: `apps/api/tests/routes/scenes.test.ts` (covers Tasks 3-4)

- [ ] **Step 1: Write failing tests for list/create/get**

Create `apps/api/tests/routes/scenes.test.ts` with the list/create/get cases now (mutate cases added in Task 4):

```ts
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildScenesRouter } from '../../src/routes/scenes'
import type { DbClient } from '../../src/db/client'
import { scenes, shareGrants, users } from '../../src/db/schema'
import { buildAuthedApp, createTestUser, getTestDb } from '../helpers'

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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'fresh' }),
    })
    expect(res.status).toBe(200)
    const { scene } = (await res.json()) as { scene: { id: string; name: string; ownerId: string } }
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
```

- [ ] **Step 2: Run tests (fail)**

Run: `pnpm --filter @excalimore/api test tests/routes/scenes.test.ts`
Expected: import error.

- [ ] **Step 3: Implement core scenes router**

Create `apps/api/src/routes/scenes.ts`:

```ts
import {
  CreateSceneRequestSchema,
  ExcalidrawSceneDataSchema,
  UpdateSceneRequestSchema,
} from '@excalimore/types'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { csrfProtect, requireAuth } from '../auth/middleware'
import type { AppEnv } from '../context'
import { scenes, shareGrants } from '../db/schema'
import { httpError } from '../lib/http-errors'
import { getSceneAccess, roleAllows } from '../access'

export function buildScenesRouter(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth())

  app.get('/', async (c) => {
    const me = c.var.user!
    const db = c.var.db
    const shared = c.req.query('shared') === 'true'
    const folderId = c.req.query('folder_id') ?? null

    if (shared) {
      const grants = await db
        .select({ sceneId: shareGrants.sceneId, permission: shareGrants.permission })
        .from(shareGrants)
        .where(eq(shareGrants.userId, me.id))
      if (grants.length === 0) return c.json({ scenes: [] })
      const ids = grants.map((g) => g.sceneId)
      const rows = await db.select().from(scenes).where(inArray(scenes.id, ids))
      const permByScene = new Map(grants.map((g) => [g.sceneId, g.permission]))
      return c.json({
        scenes: rows.map((r) => ({
          ...serialize(r, /* includeData */ false),
          permission: permByScene.get(r.id),
        })),
      })
    }

    const where = folderId
      ? and(eq(scenes.ownerId, me.id), eq(scenes.folderId, folderId))
      : eq(scenes.ownerId, me.id)
    const rows = await db.select().from(scenes).where(where)
    return c.json({ scenes: rows.map((r) => serialize(r, false)) })
  })

  app.post('/', csrfProtect(), async (c) => {
    const body = CreateSceneRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw httpError('invalid_input', 'invalid scene body')
    const me = c.var.user!
    const [row] = await c.var.db
      .insert(scenes)
      .values({
        ownerId: me.id,
        folderId: body.data.folderId ?? null,
        name: body.data.name,
        data: { type: 'excalidraw', elements: [], appState: {}, files: {} },
      })
      .returning()
    if (!row) throw httpError('internal', 'failed to create scene')
    return c.json({ scene: serialize(row, true) })
  })

  app.get('/:id', async (c) => {
    const id = c.req.param('id')
    const me = c.var.user!
    const role = await getSceneAccess(c.var.db, me.id, id)
    if (!roleAllows(role, 'view')) throw httpError('not_found', 'scene not found')
    const rows = await c.var.db.select().from(scenes).where(eq(scenes.id, id))
    const row = rows[0]
    if (!row) throw httpError('not_found', 'scene not found')
    return c.json({ scene: serialize(row, true), role })
  })

  // PATCH/DELETE/grants in Task 4 / Task 5.

  return app
}

function serialize(
  row: {
    id: string
    ownerId: string
    folderId: string | null
    name: string
    data: unknown
    thumbnailUrl: string | null
    createdAt: Date
    updatedAt: Date
  },
  includeData: boolean,
) {
  return {
    id: row.id,
    ownerId: row.ownerId,
    folderId: row.folderId,
    name: row.name,
    thumbnailUrl: row.thumbnailUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(includeData ? { data: ExcalidrawSceneDataSchema.parse(row.data) } : {}),
  }
}
```

- [ ] **Step 4: Run tests (pass)**

Run: `pnpm --filter @excalimore/api test tests/routes/scenes.test.ts`
Expected: 5 tests pass (list × 2, create × 1, get × 3 — actually 6 cases, all in this task).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/scenes.ts apps/api/tests/routes/scenes.test.ts
git commit -m "feat(api): add /scenes list, create, and get with access control"
```

---

### Task 4: Scenes mutations (PATCH, DELETE)

**Files:**
- Modify: `apps/api/src/routes/scenes.ts` (add patch/delete)
- Modify: `apps/api/tests/routes/scenes.test.ts` (add mutation cases)

- [ ] **Step 1: Append tests**

Append to `apps/api/tests/routes/scenes.test.ts`:

```ts
describe('PATCH /scenes/:id', () => {
  it('owner can update name and data', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 'old', data: EMPTY_SCENE_DATA })
      .returning()

    const { app } = buildAuthedApp(alice)
    app.route('/scenes', buildScenesRouter())

    const newData = { type: 'excalidraw', elements: [{ id: 'a', type: 'rectangle' }], appState: {}, files: {} }
    const res = await app.request(`/scenes/${scene!.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: EMPTY_SCENE_DATA }),
    })
    expect(dataOk.status).toBe(200)

    const folderForbidden = await app.request(`/scenes/${scene!.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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

    const res = await app.request(`/scenes/${scene!.id}`, { method: 'DELETE' })
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

    const res = await app.request(`/scenes/${scene!.id}`, { method: 'DELETE' })
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Add PATCH and DELETE to `apps/api/src/routes/scenes.ts`**

Add these handlers above the closing `return app` line:

```ts
  app.patch('/:id', csrfProtect(), async (c) => {
    const id = c.req.param('id')
    const me = c.var.user!
    const db = c.var.db
    const role = await getSceneAccess(db, me.id, id)
    if (role === 'none') throw httpError('not_found', 'scene not found')

    const body = UpdateSceneRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw httpError('invalid_input', 'invalid scene body')

    const update: Record<string, unknown> = {}
    if (body.data.data !== undefined) {
      if (!roleAllows(role, 'edit')) throw httpError('forbidden', 'edit permission required to save scene data')
      update.data = body.data.data
    }
    if (body.data.name !== undefined) {
      if (role !== 'owner') throw httpError('forbidden', 'only the owner can rename a scene')
      update.name = body.data.name
    }
    if (body.data.folderId !== undefined) {
      if (role !== 'owner') throw httpError('forbidden', 'only the owner can move a scene')
      update.folderId = body.data.folderId
    }
    if (Object.keys(update).length === 0) return c.json({ ok: true })
    update.updatedAt = new Date()
    await db.update(scenes).set(update).where(eq(scenes.id, id))
    return c.json({ ok: true })
  })

  app.delete('/:id', csrfProtect(), async (c) => {
    const id = c.req.param('id')
    const me = c.var.user!
    const db = c.var.db
    const role = await getSceneAccess(db, me.id, id)
    if (role === 'none') throw httpError('not_found', 'scene not found')
    if (role !== 'owner') throw httpError('forbidden', 'only the owner can delete a scene')
    await db.delete(scenes).where(eq(scenes.id, id))
    return c.json({ ok: true })
  })
```

- [ ] **Step 3: Run tests (pass)**

Run: `pnpm --filter @excalimore/api test tests/routes/scenes.test.ts`
Expected: 11 tests pass (6 from Task 3 + 5 new).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/scenes.ts apps/api/tests/routes/scenes.test.ts
git commit -m "feat(api): add /scenes PATCH and DELETE with role-aware access"
```

---

### Task 5: Scene grants (sharing)

**Files:**
- Create: `apps/api/src/routes/grants.ts`
- Create: `apps/api/tests/routes/grants.test.ts`

Mounted at `/scenes/:sceneId/grants` from the scenes router (we modify scenes.ts to mount it).

- [ ] **Step 1: Write failing tests**

Create `apps/api/tests/routes/grants.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { buildGrantsRouter } from '../../src/routes/grants'
import type { AppEnv } from '../../src/context'
import type { DbClient } from '../../src/db/client'
import { scenes, shareGrants, users } from '../../src/db/schema'
import { buildAuthedApp, createTestUser, getTestDb } from '../helpers'

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

function mountGrants(app: Hono<AppEnv>) {
  app.route('/scenes/:sceneId/grants', buildGrantsRouter())
}

describe('POST /scenes/:sceneId/grants', () => {
  it('owner can grant view permission', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const { row: bob } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: EMPTY_SCENE_DATA })
      .returning()

    const { app } = buildAuthedApp(alice)
    mountGrants(app)
    const res = await app.request(`/scenes/${scene!.id}/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    mountGrants(app)
    const res = await app.request(`/scenes/${scene!.id}/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    mountGrants(app)
    const res = await app.request(`/scenes/${scene!.id}/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    mountGrants(app)
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
    mountGrants(app)
    const res = await app.request(`/scenes/${scene!.id}/grants/${grant!.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    const remaining = await db.select().from(shareGrants).where(eq(shareGrants.sceneId, scene!.id))
    expect(remaining).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests (fail)**

Run: `pnpm --filter @excalimore/api test tests/routes/grants.test.ts`
Expected: import error.

- [ ] **Step 3: Implement `apps/api/src/routes/grants.ts`**

```ts
import { CreateGrantRequestSchema } from '@excalimore/types'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { csrfProtect, requireAuth } from '../auth/middleware'
import type { AppEnv } from '../context'
import { scenes, shareGrants } from '../db/schema'
import { httpError } from '../lib/http-errors'

export function buildGrantsRouter(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth())

  // All grant operations require scene ownership.
  app.use('*', async (c, next) => {
    const sceneId = c.req.param('sceneId')
    const me = c.var.user!
    const sceneRow = await c.var.db
      .select({ ownerId: scenes.ownerId })
      .from(scenes)
      .where(eq(scenes.id, sceneId))
      .limit(1)
    const scene = sceneRow[0]
    if (!scene) throw httpError('not_found', 'scene not found')
    if (scene.ownerId !== me.id) throw httpError('forbidden', 'only the scene owner can manage grants')
    await next()
  })

  app.get('/', async (c) => {
    const sceneId = c.req.param('sceneId')
    const rows = await c.var.db
      .select()
      .from(shareGrants)
      .where(eq(shareGrants.sceneId, sceneId))
    return c.json({ grants: rows.map(serialize) })
  })

  app.post('/', csrfProtect(), async (c) => {
    const sceneId = c.req.param('sceneId')
    const body = CreateGrantRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw httpError('invalid_input', 'invalid grant body')
    const me = c.var.user!
    try {
      const [row] = await c.var.db
        .insert(shareGrants)
        .values({
          sceneId,
          userId: body.data.userId,
          permission: body.data.permission,
          grantedBy: me.id,
        })
        .returning()
      if (!row) throw httpError('internal', 'failed to create grant')
      return c.json({ grant: serialize(row) })
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
        throw httpError('conflict', 'scene already shared with this user')
      }
      throw err
    }
  })

  app.delete('/:grantId', csrfProtect(), async (c) => {
    const sceneId = c.req.param('sceneId')
    const grantId = c.req.param('grantId')
    const result = await c.var.db
      .delete(shareGrants)
      .where(and(eq(shareGrants.id, grantId), eq(shareGrants.sceneId, sceneId)))
      .returning()
    if (result.length === 0) throw httpError('not_found', 'grant not found')
    return c.json({ ok: true })
  })

  return app
}

function serialize(row: {
  id: string
  sceneId: string
  userId: string
  permission: string
  grantedBy: string
  createdAt: Date
}) {
  return {
    id: row.id,
    sceneId: row.sceneId,
    userId: row.userId,
    permission: row.permission,
    grantedBy: row.grantedBy,
    createdAt: row.createdAt.toISOString(),
  }
}
```

- [ ] **Step 4: Mount grants router under scenes**

In `apps/api/src/routes/scenes.ts`, add an import and mount:

```ts
import { buildGrantsRouter } from './grants'
```

Inside `buildScenesRouter()` before `return app`:

```ts
app.route('/:sceneId/grants', buildGrantsRouter())
```

- [ ] **Step 5: Run tests (pass)**

Run: `pnpm --filter @excalimore/api test tests/routes/grants.test.ts tests/routes/scenes.test.ts`
Expected: 5 grants tests + 11 scenes tests pass (16 total).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/grants.ts apps/api/src/routes/scenes.ts apps/api/tests/routes/grants.test.ts
git commit -m "feat(api): add /scenes/:id/grants for owner-managed sharing"
```

---

### Task 6: Comments router

**Files:**
- Create: `apps/api/src/routes/comments.ts`
- Create: `apps/api/tests/routes/comments.test.ts`

Comments are anchored to a scene. List/create are mounted under `/scenes/:sceneId/comments`; PATCH/DELETE go to `/comments/:commentId`. Per spec §6: any user with at least `view` access can author comments; only the comment author or the scene owner can edit/delete.

- [ ] **Step 1: Write failing tests**

Create `apps/api/tests/routes/comments.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { buildCommentsRouter, buildCommentItemRouter } from '../../src/routes/comments'
import type { AppEnv } from '../../src/context'
import type { DbClient } from '../../src/db/client'
import { comments, scenes, shareGrants, users } from '../../src/db/schema'
import { buildAuthedApp, createTestUser, getTestDb } from '../helpers'

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

function mount(app: Hono<AppEnv>) {
  app.route('/scenes/:sceneId/comments', buildCommentsRouter())
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
    mount(app)

    const res = await app.request(`/scenes/${scene!.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    mount(app)

    const res = await app.request(`/scenes/${scene!.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    mount(app)

    const res = await app.request(`/scenes/${scene!.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    mount(app)
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
    mount(app)
    const res = await app.request(`/comments/${comment!.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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
    mount(app)
    const res = await app.request(`/comments/${comment!.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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
    mount(app)
    const res = await app.request(`/comments/${comment!.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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
    mount(app)
    const res = await app.request(`/comments/${comment!.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    const after = await db.select().from(comments).where(eq(comments.id, comment!.id))
    expect(after).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Implement `apps/api/src/routes/comments.ts`**

```ts
import { CreateCommentRequestSchema, UpdateCommentRequestSchema } from '@excalimore/types'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getSceneAccess, roleAllows } from '../access'
import { csrfProtect, requireAuth } from '../auth/middleware'
import type { AppEnv } from '../context'
import { comments, scenes } from '../db/schema'
import { httpError } from '../lib/http-errors'

/** /scenes/:sceneId/comments — list & create. */
export function buildCommentsRouter(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth())

  app.get('/', async (c) => {
    const sceneId = c.req.param('sceneId')
    const me = c.var.user!
    const role = await getSceneAccess(c.var.db, me.id, sceneId)
    if (!roleAllows(role, 'view')) throw httpError('not_found', 'scene not found')

    const includeResolved = c.req.query('include_resolved') === 'true'
    const where = includeResolved
      ? eq(comments.sceneId, sceneId)
      : and(eq(comments.sceneId, sceneId), eq(comments.resolved, false))
    const rows = await c.var.db.select().from(comments).where(where)
    return c.json({ comments: rows.map(serialize) })
  })

  app.post('/', csrfProtect(), async (c) => {
    const sceneId = c.req.param('sceneId')
    const me = c.var.user!
    const role = await getSceneAccess(c.var.db, me.id, sceneId)
    if (!roleAllows(role, 'view')) throw httpError('not_found', 'scene not found')

    const body = CreateCommentRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw httpError('invalid_input', 'invalid comment body')

    const [row] = await c.var.db
      .insert(comments)
      .values({
        sceneId,
        authorId: me.id,
        elementId: body.data.elementId,
        xOffset: body.data.xOffset,
        yOffset: body.data.yOffset,
        lastKnownX: body.data.lastKnownX ?? null,
        lastKnownY: body.data.lastKnownY ?? null,
        body: body.data.body,
      })
      .returning()
    if (!row) throw httpError('internal', 'failed to create comment')
    return c.json({ comment: serialize(row) })
  })

  return app
}

/** /comments/:id — patch & delete (author or scene owner). */
export function buildCommentItemRouter(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth())

  app.patch('/:id', csrfProtect(), async (c) => {
    const id = c.req.param('id')
    const me = c.var.user!
    const db = c.var.db

    const rows = await db.select().from(comments).where(eq(comments.id, id)).limit(1)
    const comment = rows[0]
    if (!comment) throw httpError('not_found', 'comment not found')

    const sceneOwner = (
      await db
        .select({ ownerId: scenes.ownerId })
        .from(scenes)
        .where(eq(scenes.id, comment.sceneId))
        .limit(1)
    )[0]
    const isAuthor = comment.authorId === me.id
    const isOwner = sceneOwner?.ownerId === me.id
    if (!isAuthor && !isOwner) throw httpError('forbidden', 'cannot modify others comments')

    const body = UpdateCommentRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw httpError('invalid_input', 'invalid comment body')

    const update: Record<string, unknown> = { updatedAt: new Date() }
    if (body.data.body !== undefined) update.body = body.data.body
    if (body.data.resolved !== undefined) update.resolved = body.data.resolved
    await db.update(comments).set(update).where(eq(comments.id, id))
    return c.json({ ok: true })
  })

  app.delete('/:id', csrfProtect(), async (c) => {
    const id = c.req.param('id')
    const me = c.var.user!
    const db = c.var.db
    const rows = await db.select().from(comments).where(eq(comments.id, id)).limit(1)
    const comment = rows[0]
    if (!comment) throw httpError('not_found', 'comment not found')

    const sceneOwner = (
      await db
        .select({ ownerId: scenes.ownerId })
        .from(scenes)
        .where(eq(scenes.id, comment.sceneId))
        .limit(1)
    )[0]
    const isAuthor = comment.authorId === me.id
    const isOwner = sceneOwner?.ownerId === me.id
    if (!isAuthor && !isOwner) throw httpError('forbidden', 'cannot delete others comments')

    await db.delete(comments).where(eq(comments.id, id))
    return c.json({ ok: true })
  })

  return app
}

function serialize(row: {
  id: string
  sceneId: string
  authorId: string
  elementId: string
  xOffset: number
  yOffset: number
  lastKnownX: number | null
  lastKnownY: number | null
  body: string
  resolved: boolean
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    sceneId: row.sceneId,
    authorId: row.authorId,
    elementId: row.elementId,
    xOffset: row.xOffset,
    yOffset: row.yOffset,
    lastKnownX: row.lastKnownX,
    lastKnownY: row.lastKnownY,
    body: row.body,
    resolved: row.resolved,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
```

- [ ] **Step 3: Mount comments listing router under scenes**

In `apps/api/src/routes/scenes.ts`, alongside the existing grants mount, add:

```ts
import { buildCommentsRouter } from './comments'
```

And inside `buildScenesRouter()` before `return app`:

```ts
app.route('/:sceneId/comments', buildCommentsRouter())
```

This mounts the listing/create router at `/api/scenes/:sceneId/comments` once the parent router is wired in Task 8. The item-level router (`/api/comments/:id`) is mounted separately at the app level.

- [ ] **Step 4: Run tests (pass)**

Run: `pnpm --filter @excalimore/api test tests/routes/comments.test.ts`
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/comments.ts apps/api/src/routes/scenes.ts apps/api/tests/routes/comments.test.ts
git commit -m "feat(api): add /scenes/:id/comments and /comments/:id routes"
```

---

### Task 7: SSE event broker + events router

**Files:**
- Create: `apps/api/src/events/broker.ts`
- Create: `apps/api/src/routes/events.ts`
- Create: `apps/api/tests/routes/events.test.ts`
- Modify: `apps/api/src/routes/comments.ts` — broadcast on create/update/delete
- Modify: `apps/api/src/routes/scenes.ts` — broadcast `scene.updated` on data PATCH

The broker is a tiny in-memory pub/sub keyed by `sceneId`. Each SSE subscriber gets a function that pushes events to its writable stream. When a scene is unsubscribed (client disconnect), we drop the entry.

- [ ] **Step 1: Implement broker**

Create `apps/api/src/events/broker.ts`:

```ts
import type { SseEvent } from '@excalimore/types'

type Subscriber = (event: SseEvent) => void

class EventBroker {
  private byScene = new Map<string, Set<Subscriber>>()

  subscribe(sceneId: string, fn: Subscriber): () => void {
    let set = this.byScene.get(sceneId)
    if (!set) {
      set = new Set()
      this.byScene.set(sceneId, set)
    }
    set.add(fn)
    return () => {
      const cur = this.byScene.get(sceneId)
      if (!cur) return
      cur.delete(fn)
      if (cur.size === 0) this.byScene.delete(sceneId)
    }
  }

  publish(sceneId: string, event: SseEvent): void {
    const set = this.byScene.get(sceneId)
    if (!set) return
    for (const fn of set) fn(event)
  }
}

export const eventBroker = new EventBroker()
```

- [ ] **Step 2: Implement events route**

Create `apps/api/src/routes/events.ts`:

```ts
import { streamSSE } from 'hono/streaming'
import { Hono } from 'hono'
import { getSceneAccess, roleAllows } from '../access'
import { requireAuth } from '../auth/middleware'
import type { AppEnv } from '../context'
import { eventBroker } from '../events/broker'
import { httpError } from '../lib/http-errors'

export function buildEventsRouter(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth())

  app.get('/', async (c) => {
    const sceneId = c.req.query('scene_id')
    if (!sceneId) throw httpError('invalid_input', 'scene_id query param required')
    const me = c.var.user!
    const role = await getSceneAccess(c.var.db, me.id, sceneId)
    if (!roleAllows(role, 'view')) throw httpError('not_found', 'scene not found')

    return streamSSE(c, async (stream) => {
      const queue: string[] = []
      const unsub = eventBroker.subscribe(sceneId, (event) => {
        queue.push(JSON.stringify(event))
      })
      try {
        // Initial hello so the client knows the stream is live.
        await stream.writeSSE({ event: 'ready', data: JSON.stringify({ sceneId }) })

        while (!stream.aborted) {
          while (queue.length > 0) {
            const data = queue.shift()!
            await stream.writeSSE({ event: 'message', data })
          }
          // Heartbeat every 15s to keep proxies from idling the connection.
          await stream.sleep(15_000)
          await stream.writeSSE({ event: 'ping', data: 'keepalive' })
        }
      } finally {
        unsub()
      }
    })
  })

  return app
}
```

- [ ] **Step 3: Hook broker into comments router**

In `apps/api/src/routes/comments.ts`, import the broker and publish on every mutation. Add at the top:

```ts
import { eventBroker } from '../events/broker'
```

After the comment is inserted in `app.post('/', ...)`:

```ts
eventBroker.publish(sceneId, { type: 'comment.created', payload: serialize(row) })
```

After update in `app.patch('/:id', ...)` (read row again to get the fresh state):

```ts
const [updated] = await db.select().from(comments).where(eq(comments.id, id))
if (updated) {
  const eventType = body.data.resolved === true ? 'comment.resolved' : 'comment.updated'
  eventBroker.publish(updated.sceneId, {
    type: eventType,
    payload: serialize(updated),
  })
}
```

(`body.data.resolved === true` distinguishes resolution from generic body edits.)

- [ ] **Step 4: Hook broker into scenes router data PATCH**

In `apps/api/src/routes/scenes.ts`, after `await db.update(scenes).set(update)...` in the PATCH handler, if `body.data.data !== undefined`:

```ts
import { eventBroker } from '../events/broker'

// ...inside patch handler, after update finishes:
if (body.data.data !== undefined) {
  eventBroker.publish(id, {
    type: 'scene.updated',
    payload: { sceneId: id, updatedAt: new Date().toISOString() },
  })
}
```

- [ ] **Step 5: Write SSE integration test**

Create `apps/api/tests/routes/events.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { buildCommentsRouter } from '../../src/routes/comments'
import { buildEventsRouter } from '../../src/routes/events'
import type { AppEnv } from '../../src/context'
import type { DbClient } from '../../src/db/client'
import { comments, scenes, shareGrants, users } from '../../src/db/schema'
import { buildAuthedApp, createTestUser, getTestDb } from '../helpers'

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

describe('GET /events?scene_id=...', () => {
  it('streams a comment.created event when a comment is added', async () => {
    const { row: alice } = await createTestUser(db, { password: 'pw' })
    const [scene] = await db
      .insert(scenes)
      .values({ ownerId: alice.id, name: 's', data: { type: 'excalidraw', elements: [], appState: {}, files: {} } })
      .returning()

    const { app } = buildAuthedApp(alice)
    app.route('/events', buildEventsRouter())
    app.route('/scenes/:sceneId/comments', buildCommentsRouter())

    // Open the SSE stream and consume it in the background.
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

    // First, drain the initial 'ready' event.
    await readUntil('event: ready')

    // Trigger a comment creation.
    const post = await app.request(`/scenes/${scene!.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      .values({ ownerId: alice.id, name: 's', data: { type: 'excalidraw', elements: [], appState: {}, files: {} } })
      .returning()

    const { app } = buildAuthedApp(stranger)
    app.route('/events', buildEventsRouter())

    const res = await app.request(`/events?scene_id=${scene!.id}`)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 6: Run tests (pass)**

Run: `pnpm --filter @excalimore/api test tests/routes/events.test.ts`
Expected: 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/events apps/api/src/routes/events.ts apps/api/src/routes/comments.ts apps/api/src/routes/scenes.ts apps/api/tests/routes/events.test.ts
git commit -m "feat(api): add per-scene SSE event stream and comment/scene broadcasts"
```

---

### Task 8: Wire all routers into the app

**Files:**
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Update `apps/api/src/index.ts`**

Replace the file with:

```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import {
  buildAuthRouter,
  detectFirstRunAndIssueToken,
  injectContext,
  loadSession,
} from './auth'
import type { AppEnv } from './context'
import { createDbClient } from './db/client'
import { loadEnv } from './env'
import { buildCommentItemRouter } from './routes/comments'
import { buildEventsRouter } from './routes/events'
import { buildFoldersRouter } from './routes/folders'
import { buildScenesRouter } from './routes/scenes'

const env = loadEnv()
const db = createDbClient(env.DATABASE_URL)

const app = new Hono<AppEnv>()

app.use('*', injectContext(db, env))
app.use('*', loadSession())

app.get('/api/health', (c) => c.json({ status: 'ok', service: 'excalimore-api' }))

app.route('/api/auth', buildAuthRouter())
app.route('/api/folders', buildFoldersRouter())
app.route('/api/scenes', buildScenesRouter())
app.route('/api/comments', buildCommentItemRouter())
app.route('/api/events', buildEventsRouter())

app.notFound((c) => c.json({ error: 'Not Found' }, 404))

app.onError((err, c) => {
  if (typeof (err as { getResponse?: unknown }).getResponse === 'function') {
    return (err as { getResponse: () => Response }).getResponse()
  }
  console.error(err)
  return c.json({ error: 'Internal Server Error' }, 500)
})

const bootstrapToken = await detectFirstRunAndIssueToken(db, env.BOOTSTRAP_TOKEN_TTL)
if (bootstrapToken) {
  console.log('')
  console.log('==========================================================')
  console.log('No users found. Bootstrap admin via:')
  console.log(`  ${env.PUBLIC_URL}/signup?bootstrap=${bootstrapToken}`)
  console.log(`  (valid for ${env.BOOTSTRAP_TOKEN_TTL} seconds)`)
  console.log('==========================================================')
  console.log('')
}

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`excalimore-api listening on http://localhost:${info.port}`)
})
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @excalimore/api typecheck`
Expected: clean.

- [ ] **Step 3: Smoke test**

```bash
docker compose -f apps/api/docker-compose.dev.yml exec -T postgres \
  psql -U excalimore -d excalimore -c "TRUNCATE users, bootstrap_tokens CASCADE;"
cd apps/api && pnpm dev > /tmp/api.log 2>&1 &
DEV_PID=$!
sleep 4
TOKEN=$(grep -oE 'bootstrap=[A-Za-z0-9_-]+' /tmp/api.log | cut -d= -f2)
SIGNUP=$(curl -sS -i -X POST http://localhost:3000/api/auth/signup -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"email\":\"a@b.co\",\"password\":\"hunter2hunter\",\"name\":\"A\"}")
SESSION=$(echo "$SIGNUP" | grep -oE 'excalimore_session=[^;]+' | cut -d= -f2)
CSRF=$(echo "$SIGNUP" | grep -oE 'excalimore_csrf=[^;]+' | cut -d= -f2)

# Create a scene
curl -sS -X POST http://localhost:3000/api/scenes \
  -H 'Content-Type: application/json' \
  -H "Cookie: excalimore_session=$SESSION; excalimore_csrf=$CSRF" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"name":"smoke-scene"}'

# List scenes
curl -sS http://localhost:3000/api/scenes \
  -H "Cookie: excalimore_session=$SESSION"

kill $DEV_PID
```

Expected: scene created, list shows the scene.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): wire folders, scenes, comments, events routers"
```

---

### Task 9: End-to-end integration test

**Files:**
- Create: `apps/api/tests/flow.api.test.ts`

A single happy-path test that exercises the assembled app: admin signs up → creates scene → invites a guest → guest comments → admin sees event via SSE → guest cannot delete admin's comment.

- [ ] **Step 1: Implement**

Create `apps/api/tests/flow.api.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import {
  buildAuthRouter,
  detectFirstRunAndIssueToken,
  injectContext,
  loadSession,
} from '../src/auth'
import type { AppEnv } from '../src/context'
import { buildCommentItemRouter } from '../src/routes/comments'
import { buildEventsRouter } from '../src/routes/events'
import { buildFoldersRouter } from '../src/routes/folders'
import { buildScenesRouter } from '../src/routes/scenes'
import { bootstrapTokens, comments, inviteTokens, scenes, sessions, shareGrants, users } from '../src/db/schema'
import { loadEnv } from '../src/env'
import { getTestDb } from './helpers'

function buildFullApp() {
  const db = getTestDb()
  const env = loadEnv()
  const app = new Hono<AppEnv>()
  app.use('*', injectContext(db, env))
  app.use('*', loadSession())
  app.route('/api/auth', buildAuthRouter())
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
    // 1) Bootstrap admin
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

    // 2) Admin creates a scene
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

    // 3) Admin generates an invite that pre-grants view permission.
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

    // 4) Guest signs up via the invite.
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

    // 5) Guest can read the scene.
    const guestRead = await app.request(`/api/scenes/${scene.id}`, {
      headers: { Cookie: `excalimore_session=${gSess}` },
    })
    expect(guestRead.status).toBe(200)

    // 6) Guest leaves a comment.
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

    // 7) Guest cannot save scene data (view-only).
    const guestSaveAttempt = await app.request(`/api/scenes/${scene.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `excalimore_session=${gSess}; excalimore_csrf=${gCsrf}`,
        'X-CSRF-Token': gCsrf,
      },
      body: JSON.stringify({ data: { type: 'excalidraw', elements: [], appState: {}, files: {} } }),
    })
    expect(guestSaveAttempt.status).toBe(403)

    // 8) Owner can delete the guest's comment.
    const adminDelete = await app.request(`/api/comments/${comment.id}`, {
      method: 'DELETE',
      headers: {
        Cookie: `excalimore_session=${aSess}; excalimore_csrf=${aCsrf}`,
        'X-CSRF-Token': aCsrf,
      },
    })
    expect(adminDelete.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run test (passes)**

Run: `pnpm --filter @excalimore/api test tests/flow.api.test.ts`
Expected: 1 test passes.

- [ ] **Step 3: Run full suite**

Run: `pnpm --filter @excalimore/api test`
Expected: 44 prior + new ones pass — total ~75 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/api/tests/flow.api.test.ts
git commit -m "test(api): full /api flow — admin→scene→invite→guest comment→owner delete"
```

---

### Task 10: API documentation

**Files:**
- Create: `docs/api.md`

- [ ] **Step 1: Create `docs/api.md`**

```markdown
# Excalimore API

All endpoints under `/api`. JSON in, JSON out. Session cookie auth (see [`auth.md`](./auth.md)).

## Conventions

- **Status codes** — `200` for success, `401` unauthorized, `403` forbidden, `404` not found, `409` conflict, `422` invalid input, `429` rate-limited.
- **CSRF** — required on all mutating methods (POST/PATCH/DELETE) for authenticated requests. Frontend reads `excalimore_csrf` cookie and echoes it as the `X-CSRF-Token` header.
- **Errors** — uniform shape `{ "error": "<code>", "message": "<human>" }`.
- **Timestamps** — ISO 8601 UTC strings.

## Folders

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/folders` | session | List folders owned by caller. |
| POST | `/api/folders` | owner | `{ name, parentId? }` — create a folder. Nesting capped at 5. |
| PATCH | `/api/folders/:id` | owner | `{ name?, parentId? }` — rename or move. |
| DELETE | `/api/folders/:id` | owner | Cascades to child folders. |

## Scenes

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/scenes` | session | List own scenes. `?folder_id=` filters by folder. `?shared=true` returns scenes shared with caller (with `permission` field). |
| POST | `/api/scenes` | owner | `{ name, folderId? }` — create empty scene. |
| GET | `/api/scenes/:id` | view+ | Returns full scene including `data` (Excalidraw JSON). |
| PATCH | `/api/scenes/:id` | edit (data) / owner (name, folderId) | Update fields. |
| DELETE | `/api/scenes/:id` | owner | Permanent. |

### Sharing

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/scenes/:id/grants` | owner | List grants on the scene. |
| POST | `/api/scenes/:id/grants` | owner | `{ userId, permission: 'view'\|'edit' }`. Returns 409 if already shared. |
| DELETE | `/api/scenes/:id/grants/:grantId` | owner | Revoke a grant. |

## Comments

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/scenes/:id/comments` | view+ | List comments. `?include_resolved=true` to include resolved. |
| POST | `/api/scenes/:id/comments` | view+ | `{ elementId, xOffset?, yOffset?, lastKnownX?, lastKnownY?, body }`. |
| PATCH | `/api/comments/:id` | author or scene owner | `{ body?, resolved? }`. |
| DELETE | `/api/comments/:id` | author or scene owner | Permanent. |

## Events (SSE)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/events?scene_id=:id` | view+ | Server-Sent Events stream for the scene. |

Event types streamed: `comment.created`, `comment.updated`, `comment.resolved`, `scene.updated`. Plus `ready` (one-time) and periodic `ping` heartbeats every 15s.

The browser native `EventSource` reconnects automatically on disconnect; expect a brief gap during which events may be missed — the client should refetch the comment list on reconnect to reconcile.

## Access control roles

```
admin ⊇ owner ⊇ edit ⊇ view ⊇ session
```

- **owner** — created the resource. All operations.
- **edit** — has `share_grants.permission='edit'`. Read scene, save scene data, manage own comments.
- **view** — has `share_grants.permission='view'`. Read scene + comments, **create** own comments (cannot save scene data, cannot edit/delete others' comments).
- **session** — any authenticated user.
- **admin** — `users.role='admin'`. Currently used only by `/api/auth/invite` (invite generation).
```

- [ ] **Step 2: Commit**

```bash
git add docs/api.md
git commit -m "docs: add api.md describing folders, scenes, sharing, comments, events"
```

---

## Phase 3 Done Criteria

Tick when **all** of the following are true:

- [ ] `pnpm lint` clean.
- [ ] `pnpm typecheck` clean (3 packages).
- [ ] `pnpm test` passes — total ~75 tests across types + api.
- [ ] Smoke test: scene create + list + get + delete works via curl with a real session cookie.
- [ ] SSE `/api/events?scene_id=:id` streams comment events in real time (verified by `events.test.ts` and the curl smoke test).
- [ ] CI green on the Phase 3 PR.

When all checked: open Phase 4 plan-writing session for the frontend MVP.
