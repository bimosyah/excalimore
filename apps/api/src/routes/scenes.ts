import {
  CreateSceneRequestSchema,
  ExcalidrawSceneDataSchema,
  UpdateSceneRequestSchema,
} from '@excalimore/types'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { getSceneAccess, roleAllows } from '../access'
import { csrfProtect, requireAuth } from '../auth/middleware'
import type { AppEnv } from '../context'
import { scenes, shareGrants } from '../db/schema'
import { httpError } from '../lib/http-errors'
import { buildGrantsRouter } from './grants'

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
  const base = {
    id: row.id,
    ownerId: row.ownerId,
    folderId: row.folderId,
    name: row.name,
    thumbnailUrl: row.thumbnailUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
  return includeData ? { ...base, data: ExcalidrawSceneDataSchema.parse(row.data) } : base
}

export function buildScenesRouter(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth())

  app.get('/', async (c) => {
    const me = c.var.user
    if (!me) throw httpError('unauthorized', 'authentication required')
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
          ...serialize(r, false),
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
    const me = c.var.user
    if (!me) throw httpError('unauthorized', 'authentication required')
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
    const me = c.var.user
    if (!me) throw httpError('unauthorized', 'authentication required')
    const role = await getSceneAccess(c.var.db, me.id, id)
    if (!roleAllows(role, 'view')) throw httpError('not_found', 'scene not found')
    const rows = await c.var.db.select().from(scenes).where(eq(scenes.id, id))
    const row = rows[0]
    if (!row) throw httpError('not_found', 'scene not found')
    return c.json({ scene: serialize(row, true), role })
  })

  app.patch('/:id', csrfProtect(), async (c) => {
    const id = c.req.param('id')
    const me = c.var.user
    if (!me) throw httpError('unauthorized', 'authentication required')
    const db = c.var.db
    const role = await getSceneAccess(db, me.id, id)
    if (role === 'none') throw httpError('not_found', 'scene not found')

    const body = UpdateSceneRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw httpError('invalid_input', 'invalid scene body')

    const update: Record<string, unknown> = {}
    if (body.data.data !== undefined) {
      if (!roleAllows(role, 'edit')) {
        throw httpError('forbidden', 'edit permission required to save scene data')
      }
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
    const me = c.var.user
    if (!me) throw httpError('unauthorized', 'authentication required')
    const db = c.var.db
    const role = await getSceneAccess(db, me.id, id)
    if (role === 'none') throw httpError('not_found', 'scene not found')
    if (role !== 'owner') throw httpError('forbidden', 'only the owner can delete a scene')
    await db.delete(scenes).where(eq(scenes.id, id))
    return c.json({ ok: true })
  })

  app.route('/:sceneId/grants', buildGrantsRouter())

  return app
}
