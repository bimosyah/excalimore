import type { Context, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import type { AppEnv } from '../context'
import type { DbClient } from '../db/client'
import type { Env } from '../env'
import { httpError } from '../lib/http-errors'
import { CSRF_COOKIE, SESSION_COOKIE } from './cookie'
import { verifyCsrf } from './csrf'
import { type RateLimiter, createRateLimiter } from './rate-limit'
import { getSession } from './session'

/** Inject db + env into every request. */
export function injectContext(db: DbClient, env: Env): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('db', db)
    c.set('env', env)
    await next()
  }
}

/** Populate ctx.var.user if a valid session cookie is present; otherwise do nothing. */
export function loadSession(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const sessionId = getCookie(c, SESSION_COOKIE)
    if (sessionId) {
      const found = await getSession(c.var.db, sessionId)
      if (found) {
        c.set('user', found.user)
        c.set('sessionId', found.session.id)
      }
    }
    await next()
  }
}

/** Reject requests without an authenticated user. */
export function requireAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.var.user) throw httpError('unauthorized', 'authentication required')
    await next()
  }
}

/** Reject requests where the authenticated user is not an admin. */
export function requireAdmin(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.var.user || c.var.user.role !== 'admin') {
      throw httpError('forbidden', 'admin role required')
    }
    await next()
  }
}

/** Enforce CSRF on mutating methods. Safe methods (GET/HEAD/OPTIONS) pass through. */
export function csrfProtect(): MiddlewareHandler<AppEnv> {
  const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])
  return async (c, next) => {
    if (SAFE.has(c.req.method)) return next()
    const cookie = getCookie(c, CSRF_COOKIE)
    const header = c.req.header('x-csrf-token')
    if (!verifyCsrf(cookie, header)) throw httpError('forbidden', 'invalid CSRF token')
    await next()
  }
}

interface RateLimitOptions {
  limit: number
  windowMs: number
  /** Build the bucket key from the request — defaults to client IP. */
  keyFn?: (c: Context<AppEnv>) => string
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler<AppEnv> {
  const limiter: RateLimiter = createRateLimiter({ limit: opts.limit, windowMs: opts.windowMs })
  const keyFn = opts.keyFn ?? ((c) => c.req.header('x-forwarded-for') ?? 'unknown')
  return async (c, next) => {
    if (!limiter.check(keyFn(c))) throw httpError('rate_limited', 'too many requests')
    await next()
  }
}
