import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { scenes } from './scenes'
import { users } from './users'

export const shareGrants = pgTable(
  'share_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sceneId: uuid('scene_id')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueScenePerUser: unique('share_grants_scene_user_unique').on(table.sceneId, table.userId),
  }),
)

export type ShareGrantRow = typeof shareGrants.$inferSelect
export type NewShareGrantRow = typeof shareGrants.$inferInsert
