import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { scenes } from './scenes'
import { users } from './users'

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  sceneId: uuid('scene_id')
    .notNull()
    .references(() => scenes.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  elementId: text('element_id').notNull(),
  xOffset: integer('x_offset').notNull().default(0),
  yOffset: integer('y_offset').notNull().default(0),
  lastKnownX: doublePrecision('last_known_x'),
  lastKnownY: doublePrecision('last_known_y'),
  body: text('body').notNull(),
  resolved: boolean('resolved').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type CommentRow = typeof comments.$inferSelect
export type NewCommentRow = typeof comments.$inferInsert
