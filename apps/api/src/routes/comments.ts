import { CreateCommentRequestSchema, UpdateCommentRequestSchema } from '@excalimore/types'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getSceneAccess, roleAllows } from '../access'
import { csrfProtect, requireAuth } from '../auth/middleware'
import type { AppEnv } from '../context'
import { comments, scenes } from '../db/schema'
import { eventBroker } from '../events/broker'
import { httpError } from '../lib/http-errors'

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

/** /scenes/:sceneId/comments — list & create. */
export function buildCommentsRouter(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth())

  app.get('/', async (c) => {
    const sceneId = c.req.param('sceneId') ?? ''
    const me = c.var.user
    if (!me) throw httpError('unauthorized', 'authentication required')
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
    const sceneId = c.req.param('sceneId') ?? ''
    const me = c.var.user
    if (!me) throw httpError('unauthorized', 'authentication required')
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
    const payload = serialize(row)
    eventBroker.publish(sceneId, { type: 'comment.created', payload })
    return c.json({ comment: payload })
  })

  return app
}

/** /comments/:id — patch & delete (author or scene owner). */
export function buildCommentItemRouter(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth())

  app.patch('/:id', csrfProtect(), async (c) => {
    const id = c.req.param('id')
    const me = c.var.user
    if (!me) throw httpError('unauthorized', 'authentication required')
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

    const [updated] = await db.select().from(comments).where(eq(comments.id, id))
    if (updated) {
      const eventType = body.data.resolved === true ? 'comment.resolved' : 'comment.updated'
      eventBroker.publish(updated.sceneId, { type: eventType, payload: serialize(updated) })
    }
    return c.json({ ok: true })
  })

  app.delete('/:id', csrfProtect(), async (c) => {
    const id = c.req.param('id')
    const me = c.var.user
    if (!me) throw httpError('unauthorized', 'authentication required')
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
