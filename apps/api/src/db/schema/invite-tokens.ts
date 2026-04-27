import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { scenes } from './scenes'
import { users } from './users'

export const inviteTokens = pgTable('invite_tokens', {
  token: text('token').primaryKey(),
  sceneId: uuid('scene_id').references(() => scenes.id, { onDelete: 'cascade' }),
  permission: text('permission'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' }),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type InviteTokenRow = typeof inviteTokens.$inferSelect
export type NewInviteTokenRow = typeof inviteTokens.$inferInsert
