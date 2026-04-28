import { CreateGrantRequestSchema } from '@excalimore/types'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { csrfProtect, requireAuth } from '../auth/middleware'
import type { AppEnv } from '../context'
import { scenes, shareGrants, users } from '../db/schema'
import { httpError } from '../lib/http-errors'

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

function serializeWithUser(row: {
  id: string
  sceneId: string
  userId: string
  permission: string
  grantedBy: string
  createdAt: Date
  userEmail: string | null
  userName: string | null
}) {
  return {
    ...serialize(row),
    userEmail: row.userEmail,
    userName: row.userName,
  }
}

export function buildGrantsRouter(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth())

  // Every grant op requires scene ownership.
  app.use('*', async (c, next) => {
    const sceneId = c.req.param('sceneId')
    const me = c.var.user
    if (!me) throw httpError('unauthorized', 'authentication required')
    if (!sceneId) throw httpError('not_found', 'scene not found')
    const sceneRow = await c.var.db
      .select({ ownerId: scenes.ownerId })
      .from(scenes)
      .where(eq(scenes.id, sceneId))
      .limit(1)
    const scene = sceneRow[0]
    if (!scene) throw httpError('not_found', 'scene not found')
    if (scene.ownerId !== me.id) {
      throw httpError('forbidden', 'only the scene owner can manage grants')
    }
    await next()
  })

  app.get('/', async (c) => {
    const sceneId = c.req.param('sceneId') ?? ''
    // Left join users so the UI can render a meaningful identity (email + name)
    // instead of opaque user ids. The join is "left" so a grant whose user has
    // since been deleted still surfaces — the UI shows null fields.
    const rows = await c.var.db
      .select({
        id: shareGrants.id,
        sceneId: shareGrants.sceneId,
        userId: shareGrants.userId,
        permission: shareGrants.permission,
        grantedBy: shareGrants.grantedBy,
        createdAt: shareGrants.createdAt,
        userEmail: users.email,
        userName: users.name,
      })
      .from(shareGrants)
      .leftJoin(users, eq(users.id, shareGrants.userId))
      .where(eq(shareGrants.sceneId, sceneId))
    return c.json({ grants: rows.map(serializeWithUser) })
  })

  app.post('/', csrfProtect(), async (c) => {
    const sceneId = c.req.param('sceneId') ?? ''
    const body = CreateGrantRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw httpError('invalid_input', 'invalid grant body')
    const me = c.var.user
    if (!me) throw httpError('unauthorized', 'authentication required')
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
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw httpError('conflict', 'scene already shared with this user')
      }
      throw err
    }
  })

  app.delete('/:grantId', csrfProtect(), async (c) => {
    const sceneId = c.req.param('sceneId') ?? ''
    const grantId = c.req.param('grantId') ?? ''
    const result = await c.var.db
      .delete(shareGrants)
      .where(and(eq(shareGrants.id, grantId), eq(shareGrants.sceneId, sceneId)))
      .returning()
    if (result.length === 0) throw httpError('not_found', 'grant not found')
    return c.json({ ok: true })
  })

  return app
}
