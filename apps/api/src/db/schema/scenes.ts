import type { ExcalidrawSceneData } from '@excalimore/types'
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { folders } from './folders'
import { users } from './users'

export const scenes = pgTable('scenes', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  data: jsonb('data').$type<ExcalidrawSceneData>().notNull(),
  thumbnailUrl: text('thumbnail_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type SceneRow = typeof scenes.$inferSelect
export type NewSceneRow = typeof scenes.$inferInsert
