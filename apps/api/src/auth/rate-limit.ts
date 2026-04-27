export interface RateLimiterOptions {
  /** Max calls per window. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
  /** Override the clock for tests. */
  now?: () => number
}

export interface RateLimiter {
  /** Returns true if the call is allowed; false if the key is rate-limited. */
  check(key: string): boolean
}

interface Bucket {
  windowStart: number
  count: number
}

/**
 * Fixed-window rate limiter held in memory. Single-instance only — multi-replica
 * deployments need a shared store (Redis, Postgres) to avoid per-replica drift.
 */
export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const buckets = new Map<string, Bucket>()
  const now = opts.now ?? (() => Date.now())

  return {
    check(key: string) {
      const t = now()
      const bucket = buckets.get(key)
      if (!bucket || t - bucket.windowStart >= opts.windowMs) {
        buckets.set(key, { windowStart: t, count: 1 })
        return true
      }
      if (bucket.count >= opts.limit) return false
      bucket.count += 1
      return true
    },
  }
}
