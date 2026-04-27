import {
  CreateFolderRequestSchema,
  MAX_FOLDER_DEPTH,
  UpdateFolderRequestSchema,
} from '@excalimore/types'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { csrfProtect, requireAuth } from '../auth/middleware'
import type { AppEnv } from '../context'
import type { DbClient } from '../db/client'
import { folders } from '../db/schema'
import { httpError } from '../lib/http-errors'

async function depthOf(db: DbClient, folderId: string, ownerId: string): Promise<number> {
  let id: string | null = folderId
  let depth = 0
  while (id) {
    const row = await db
      .select({ id: folders.id, parentId: folders.parentId })
      .from(folders)
      .where(and(eq(folders.id, id), eq(folders.ownerId, ownerId)))
      .limit(1)
    if (!row[0]) return -1
    depth += 1
    id = row[0].parentId
    if (depth > MAX_FOLDER_DEPTH + 1) break
  }
  return depth
}

function serialize(row: {
  id: string
  ownerId: string
  parentId: string | null
  name: string
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    ownerId: row.ownerId,
    parentId: row.parentId,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function buildFoldersRouter(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth())

  app.get('/', async (c) => {
    const owner = c.var.user
    if (!owner) throw httpError('unauthorized', 'authentication required')
    const rows = await c.var.db.select().from(folders).where(eq(folders.ownerId, owner.id))
    return c.json({ folders: rows.map(serialize) })
  })

  app.post('/', csrfProtect(), async (c) => {
    const body = CreateFolderRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw httpError('invalid_input', 'invalid folder body')
    const owner = c.var.user
    if (!owner) throw httpError('unauthorized', 'authentication required')
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
    const owner = c.var.user
    if (!owner) throw httpError('unauthorized', 'authentication required')
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
      if (newParentId !== null && newParentId !== undefined) {
        const parentDepth = await depthOf(db, newParentId, owner.id)
        if (parentDepth < 0) throw httpError('not_found', 'parent folder not found')
        if (parentDepth >= MAX_FOLDER_DEPTH) {
          throw httpError('invalid_input', `folder nesting capped at ${MAX_FOLDER_DEPTH}`)
        }
      }
      update.parentId = newParentId ?? null
    }
    update.updatedAt = new Date()

    await db.update(folders).set(update).where(eq(folders.id, id))
    return c.json({ ok: true })
  })

  app.delete('/:id', csrfProtect(), async (c) => {
    const id = c.req.param('id')
    const owner = c.var.user
    if (!owner) throw httpError('unauthorized', 'authentication required')
    const db = c.var.db
    const existing = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, id), eq(folders.ownerId, owner.id)))
      .limit(1)
    if (!existing[0]) throw httpError('not_found', 'folder not found')
    await db.delete(folders).where(eq(folders.id, id))
    return c.json({ ok: true })
  })

  return app
}
