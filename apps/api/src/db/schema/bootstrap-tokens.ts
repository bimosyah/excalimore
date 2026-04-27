import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const bootstrapTokens = pgTable('bootstrap_tokens', {
  token: text('token').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type BootstrapTokenRow = typeof bootstrapTokens.$inferSelect
export type NewBootstrapTokenRow = typeof bootstrapTokens.$inferInsert
