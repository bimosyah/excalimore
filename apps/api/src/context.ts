import type { Hono } from 'hono'
import type { DbClient } from './db/client'
import type { UserRow } from './db/schema'
import type { Env } from './env'

/** Variables set on the Hono context by middleware. */
export interface AppVariables {
  db: DbClient
  env: Env
  /** Authenticated user, set by auth middleware. Undefined for public routes. */
  user?: UserRow
  /** Session id if authenticated, used to allow logout to invalidate it. */
  sessionId?: string
}

/** Bindings (env vars) we don't use — kept empty for now. */
export type AppBindings = Record<string, never>

/** Convenience type for `new Hono<AppEnv>()`. */
export interface AppEnv {
  Variables: AppVariables
  Bindings: AppBindings
}

export type AppHono = Hono<AppEnv>
