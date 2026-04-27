# Excalimore Implementation Plan — Phase 2: Auth

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the roll-your-own auth module on top of the Phase 1 foundation. End state: a fresh deployment prints a bootstrap token to stdout, the operator visits `/signup?bootstrap=...` to create the admin, then can issue invite tokens that let invitees sign up against specific scenes. Every authenticated request uses a DB-backed session cookie with CSRF protection and per-IP/per-user rate limits.

**Architecture:** Hand-rolled. `argon2` is the only auth-related dependency. Sessions are random 32-byte tokens stored in `sessions` table. CSRF uses double-submit cookie. Rate limit is in-memory token bucket (single-instance assumption). Bootstrap and invite tokens are stored in their own tables and consumed once.

**Tech Stack:** argon2 ^0.41.0 (only new dep), `crypto.randomBytes` + `crypto.timingSafeEqual` from Node, Hono middleware composition, Drizzle for all DB ops.

**Spec reference:** [`../specs/2026-04-27-excalimore-design.md`](../specs/2026-04-27-excalimore-design.md), §6 (auth API surface) and §8 (auth flow).

**Phase 1 prerequisite:** All 8 tables migrated; `apps/api` boots with healthcheck; `@excalimore/types` exports `SignupRequest`, `LoginRequest`, `User`, `CreateInviteRequest`, `CreateInviteResponse`.

---

## Phase 2 File Structure

After Phase 2, `apps/api` adds:

```
apps/api/
├── src/
│   ├── auth/
│   │   ├── index.ts              # NEW — public exports for routes/middleware
│   │   ├── password.ts           # NEW — argon2id wrapper
│   │   ├── ids.ts                # NEW — random token + UUID helpers
│   │   ├── session.ts            # NEW — DB-backed session lifecycle
│   │   ├── cookie.ts             # NEW — cookie set/clear helpers
│   │   ├── csrf.ts               # NEW — double-submit cookie validation
│   │   ├── rate-limit.ts         # NEW — in-memory token bucket
│   │   ├── invite.ts             # NEW — invite token generate + consume
│   │   ├── bootstrap.ts          # NEW — first-run admin token
│   │   ├── middleware.ts         # NEW — Hono middleware factories
│   │   └── routes.ts             # NEW — /api/auth/* handlers
│   ├── lib/
│   │   └── http-errors.ts        # NEW — typed error helpers (HTTPException with status + code)
│   ├── context.ts                # NEW — Hono context typing for ctx.var.user, ctx.var.db
│   └── index.ts                  # MODIFY — wire auth router, run bootstrap detection
├── tests/
│   ├── auth/
│   │   ├── password.test.ts      # NEW — unit
│   │   ├── ids.test.ts           # NEW — unit
│   │   ├── csrf.test.ts          # NEW — unit
│   │   ├── rate-limit.test.ts    # NEW — unit
│   │   ├── session.test.ts       # NEW — integration vs Postgres
│   │   ├── invite.test.ts        # NEW — integration
│   │   ├── bootstrap.test.ts     # NEW — integration
│   │   └── flow.test.ts          # NEW — end-to-end signup → login → me → logout
│   └── helpers.ts                # NEW — buildApp(), createTestUser()
```

---

## Tasks

### Task 1: Add argon2 dependency

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Add argon2 to dependencies**

Edit `apps/api/package.json`, add to `dependencies`:

```json
"argon2": "^0.41.0"
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: argon2 added, native binary built (this can take 30-60s on first install). No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore(api): add argon2 dependency for password hashing"
```

---

### Task 2: ID and token generators

**Files:**
- Create: `apps/api/src/auth/ids.ts`
- Create: `apps/api/tests/auth/ids.test.ts`

These are the primitives used by sessions, invites, bootstrap, and CSRF tokens. Build first because everything else depends on them.

- [ ] **Step 1: Write failing test**

Create `apps/api/tests/auth/ids.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { constantTimeEqual, generateToken } from '../../src/auth/ids'

describe('generateToken', () => {
  it('returns a base64url string of expected length for 32 bytes', () => {
    const token = generateToken(32)
    // 32 bytes of random data encoded as base64url ≈ 43 chars (no padding).
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token.length).toBeGreaterThanOrEqual(42)
    expect(token.length).toBeLessThanOrEqual(44)
  })

  it('produces different values each call', () => {
    const set = new Set(Array.from({ length: 100 }, () => generateToken(32)))
    expect(set.size).toBe(100)
  })

  it('respects requested byte length', () => {
    const short = generateToken(16)
    const long = generateToken(64)
    expect(short.length).toBeLessThan(long.length)
  })
})

describe('constantTimeEqual', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeEqual('hello', 'hello')).toBe(true)
  })

  it('returns false for different strings of same length', () => {
    expect(constantTimeEqual('hello', 'world')).toBe(false)
  })

  it('returns false for strings of different length without leaking length info', () => {
    // Different length must return false but never throw.
    expect(constantTimeEqual('a', 'abc')).toBe(false)
    expect(constantTimeEqual('abc', 'a')).toBe(false)
  })

  it('handles empty strings', () => {
    expect(constantTimeEqual('', '')).toBe(true)
    expect(constantTimeEqual('', 'a')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test (it fails — module missing)**

Run: `pnpm --filter @excalimore/api test tests/auth/ids.test.ts`
Expected: failure resolving import path.

- [ ] **Step 3: Implement**

Create `apps/api/src/auth/ids.ts`:

```ts
import { randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Generate a URL-safe random token of `bytes` random bytes encoded as base64url.
 * Used for session ids, invite tokens, bootstrap tokens, and CSRF tokens.
 */
export function generateToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url')
}

/**
 * Compare two strings in constant time to avoid leaking length-dependent timing.
 * Returns false for unequal lengths without short-circuiting.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) {
    // timingSafeEqual throws on length mismatch; do a dummy compare to keep
    // the cost roughly equal regardless of input lengths.
    timingSafeEqual(aBuf, aBuf)
    return false
  }
  return timingSafeEqual(aBuf, bBuf)
}
```

- [ ] **Step 4: Run test (passes)**

Run: `pnpm --filter @excalimore/api test tests/auth/ids.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/ids.ts apps/api/tests/auth/ids.test.ts
git commit -m "feat(api): add token generator and constant-time compare helpers"
```

---

### Task 3: Password hashing wrapper

**Files:**
- Create: `apps/api/src/auth/password.ts`
- Create: `apps/api/tests/auth/password.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/tests/auth/password.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../src/auth/password'

describe('hashPassword', () => {
  it('produces an argon2id hash starting with $argon2id$', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).toMatch(/^\$argon2id\$/)
  })

  it('produces different hashes for the same password (different salt)', async () => {
    const hashA = await hashPassword('same-password')
    const hashB = await hashPassword('same-password')
    expect(hashA).not.toBe(hashB)
  })
})

describe('verifyPassword', () => {
  it('verifies the correct password', async () => {
    const hash = await hashPassword('hunter2')
    expect(await verifyPassword(hash, 'hunter2')).toBe(true)
  })

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('hunter2')
    expect(await verifyPassword(hash, 'hunter3')).toBe(false)
  })

  it('returns false on malformed hash rather than throwing', async () => {
    expect(await verifyPassword('not-a-real-hash', 'whatever')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test (fails)**

Run: `pnpm --filter @excalimore/api test tests/auth/password.test.ts`
Expected: import error.

- [ ] **Step 3: Implement**

Create `apps/api/src/auth/password.ts`:

```ts
import argon2 from 'argon2'

// OWASP-recommended argon2id parameters for interactive logins, 2026.
// Tune with benchmarking on the target box if first-login feels slow (>250ms).
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, HASH_OPTIONS)
}

/**
 * Returns true iff the provided plaintext matches the stored hash.
 * Returns false (does not throw) on malformed/invalid hash strings — so
 * callers can treat any failure uniformly without leaking error shape.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(storedHash, plain)
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run test (passes)**

Run: `pnpm --filter @excalimore/api test tests/auth/password.test.ts`
Expected: 5 tests pass. (Each test does a hash; total runtime ~500ms-1s.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/password.ts apps/api/tests/auth/password.test.ts
git commit -m "feat(api): add argon2id password hashing wrapper"
```

---

### Task 4: Cookie helpers

**Files:**
- Create: `apps/api/src/auth/cookie.ts`

The plan keeps this thin — it's a small wrapper around Hono's cookie helpers so other modules don't have to repeat the cookie attribute config. No tests at this layer; `session.test.ts` and `flow.test.ts` exercise it via real requests.

- [ ] **Step 1: Implement**

Create `apps/api/src/auth/cookie.ts`:

```ts
import type { Context } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'

export const SESSION_COOKIE = 'excalimore_session'
export const CSRF_COOKIE = 'excalimore_csrf'

interface SessionCookieOptions {
  maxAgeSeconds: number
  secure: boolean
}

export function setSessionCookie(c: Context, value: string, opts: SessionCookieOptions): void {
  setCookie(c, SESSION_COOKIE, value, {
    httpOnly: true,
    secure: opts.secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: opts.maxAgeSeconds,
  })
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

/**
 * CSRF cookie is intentionally NOT HttpOnly — frontend JS reads it and echoes
 * the value as the X-CSRF-Token header on mutating requests (double-submit pattern).
 */
export function setCsrfCookie(c: Context, value: string, secure: boolean): void {
  setCookie(c, CSRF_COOKIE, value, {
    httpOnly: false,
    secure,
    sameSite: 'Lax',
    path: '/',
  })
}

export function clearCsrfCookie(c: Context): void {
  deleteCookie(c, CSRF_COOKIE, { path: '/' })
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @excalimore/api typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/auth/cookie.ts
git commit -m "feat(api): add session and CSRF cookie helpers"
```

---

### Task 5: HTTP error helpers

**Files:**
- Create: `apps/api/src/lib/http-errors.ts`

Used by routes to throw structured errors. Hono's `HTTPException` is fine but we wrap it so route code stays terse and error codes are typed.

- [ ] **Step 1: Implement**

Create `apps/api/src/lib/http-errors.ts`:

```ts
import { HTTPException } from 'hono/http-exception'

type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid_input'
  | 'rate_limited'
  | 'internal'

const STATUS_BY_CODE = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invalid_input: 422,
  rate_limited: 429,
  internal: 500,
} as const satisfies Record<ErrorCode, number>

export function httpError(code: ErrorCode, message: string): HTTPException {
  const status = STATUS_BY_CODE[code]
  return new HTTPException(status, {
    message,
    res: new Response(JSON.stringify({ error: code, message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  })
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @excalimore/api typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/http-errors.ts
git commit -m "feat(api): add typed HTTP error helper"
```

---

### Task 6: Hono context typing

**Files:**
- Create: `apps/api/src/context.ts`

Centralized typing for variables we attach to the Hono context (current user, db client). All middleware and routes import from here.

- [ ] **Step 1: Implement**

Create `apps/api/src/context.ts`:

```ts
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
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @excalimore/api typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/context.ts
git commit -m "feat(api): add typed Hono context shape"
```

---

### Task 7: Test helpers

**Files:**
- Create: `apps/api/tests/helpers.ts`

A small shared module so each integration test does not re-implement app construction. Used by `session.test.ts`, `invite.test.ts`, `bootstrap.test.ts`, and `flow.test.ts`.

- [ ] **Step 1: Implement**

Create `apps/api/tests/helpers.ts`:

```ts
import { Hono } from 'hono'
import { createDbClient, type DbClient } from '../src/db/client'
import type { AppEnv } from '../src/context'
import { hashPassword } from '../src/auth/password'
import { users, type NewUserRow } from '../src/db/schema'

export function getTestDb(): DbClient {
  return createDbClient(process.env.DATABASE_URL ?? '')
}

export function buildBareApp() {
  return new Hono<AppEnv>()
}

export async function createTestUser(
  db: DbClient,
  overrides: Partial<NewUserRow> & { password: string } = { password: 'hunter2hunter2' },
) {
  const { password, ...rest } = overrides
  const [row] = await db
    .insert(users)
    .values({
      email: rest.email ?? `u-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: rest.name ?? 'Test User',
      passwordHash: await hashPassword(password),
      role: rest.role ?? 'user',
    })
    .returning()
  if (!row) throw new Error('failed to create test user')
  return { row, password }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @excalimore/api typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/api/tests/helpers.ts
git commit -m "test(api): add buildBareApp and createTestUser helpers"
```

---

### Task 8: Session lifecycle (DB-backed)

**Files:**
- Create: `apps/api/src/auth/session.ts`
- Create: `apps/api/tests/auth/session.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/tests/auth/session.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createSession, getSession, invalidateSession } from '../../src/auth/session'
import { sessions } from '../../src/db/schema'
import { createTestUser, getTestDb } from '../helpers'
import type { DbClient } from '../../src/db/client'

let db: DbClient

beforeAll(() => {
  db = getTestDb()
})

afterEach(async () => {
  await db.delete(sessions)
})

describe('createSession', () => {
  it('creates a session row and returns its id', async () => {
    const { row: user } = await createTestUser(db)
    const id = await createSession(db, user.id, 60) // 60 seconds
    expect(id.length).toBeGreaterThan(20)

    const stored = await db.select().from(sessions).where(eq(sessions.id, id))
    expect(stored).toHaveLength(1)
    expect(stored[0]!.userId).toBe(user.id)
  })
})

describe('getSession', () => {
  it('returns the session and user when valid', async () => {
    const { row: user } = await createTestUser(db)
    const id = await createSession(db, user.id, 60)
    const result = await getSession(db, id)
    expect(result?.user.id).toBe(user.id)
    expect(result?.session.id).toBe(id)
  })

  it('returns null for unknown session id', async () => {
    expect(await getSession(db, 'does-not-exist')).toBeNull()
  })

  it('returns null for expired session', async () => {
    const { row: user } = await createTestUser(db)
    const id = await createSession(db, user.id, -1) // already expired
    expect(await getSession(db, id)).toBeNull()
  })
})

describe('invalidateSession', () => {
  it('deletes the session', async () => {
    const { row: user } = await createTestUser(db)
    const id = await createSession(db, user.id, 60)
    await invalidateSession(db, id)
    expect(await getSession(db, id)).toBeNull()
  })

  it('is a no-op for unknown session id', async () => {
    await expect(invalidateSession(db, 'nope')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test (fails)**

Run: `pnpm --filter @excalimore/api test tests/auth/session.test.ts`
Expected: import error / function missing.

- [ ] **Step 3: Implement**

Create `apps/api/src/auth/session.ts`:

```ts
import { eq } from 'drizzle-orm'
import type { DbClient } from '../db/client'
import { type SessionRow, type UserRow, sessions, users } from '../db/schema'
import { generateToken } from './ids'

const SESSION_TOKEN_BYTES = 32

export async function createSession(
  db: DbClient,
  userId: string,
  maxAgeSeconds: number,
): Promise<string> {
  const id = generateToken(SESSION_TOKEN_BYTES)
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000)
  await db.insert(sessions).values({ id, userId, expiresAt })
  return id
}

export interface SessionWithUser {
  session: SessionRow
  user: UserRow
}

export async function getSession(
  db: DbClient,
  sessionId: string,
): Promise<SessionWithUser | null> {
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  if (row.session.expiresAt.getTime() <= Date.now()) {
    // Eagerly clean up expired sessions when we encounter them.
    await db.delete(sessions).where(eq(sessions.id, sessionId))
    return null
  }
  return row
}

export async function invalidateSession(db: DbClient, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId))
}
```

- [ ] **Step 4: Run test (passes)**

Run: `pnpm --filter @excalimore/api test tests/auth/session.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/session.ts apps/api/tests/auth/session.test.ts
git commit -m "feat(api): add DB-backed session lifecycle (create/get/invalidate)"
```

---

### Task 9: CSRF double-submit cookie

**Files:**
- Create: `apps/api/src/auth/csrf.ts`
- Create: `apps/api/tests/auth/csrf.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/tests/auth/csrf.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { generateCsrfToken, verifyCsrf } from '../../src/auth/csrf'

describe('generateCsrfToken', () => {
  it('returns a non-empty random string', () => {
    const a = generateCsrfToken()
    const b = generateCsrfToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(20)
  })
})

describe('verifyCsrf', () => {
  it('accepts matching cookie and header', () => {
    const token = generateCsrfToken()
    expect(verifyCsrf(token, token)).toBe(true)
  })

  it('rejects mismatched cookie and header', () => {
    expect(verifyCsrf(generateCsrfToken(), generateCsrfToken())).toBe(false)
  })

  it('rejects when cookie is missing', () => {
    expect(verifyCsrf(undefined, 'header-only')).toBe(false)
  })

  it('rejects when header is missing', () => {
    expect(verifyCsrf('cookie-only', undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test (fails)**

Run: `pnpm --filter @excalimore/api test tests/auth/csrf.test.ts`
Expected: import error.

- [ ] **Step 3: Implement**

Create `apps/api/src/auth/csrf.ts`:

```ts
import { constantTimeEqual, generateToken } from './ids'

const CSRF_TOKEN_BYTES = 32

export function generateCsrfToken(): string {
  return generateToken(CSRF_TOKEN_BYTES)
}

/**
 * Double-submit cookie pattern: the value carried in the CSRF cookie must equal
 * the value sent in the X-CSRF-Token header. Both must be present.
 */
export function verifyCsrf(cookieValue: string | undefined, headerValue: string | undefined): boolean {
  if (!cookieValue || !headerValue) return false
  return constantTimeEqual(cookieValue, headerValue)
}
```

- [ ] **Step 4: Run test (passes)**

Run: `pnpm --filter @excalimore/api test tests/auth/csrf.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/csrf.ts apps/api/tests/auth/csrf.test.ts
git commit -m "feat(api): add CSRF double-submit token helpers"
```

---

### Task 10: Rate limit (in-memory token bucket)

**Files:**
- Create: `apps/api/src/auth/rate-limit.ts`
- Create: `apps/api/tests/auth/rate-limit.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/tests/auth/rate-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createRateLimiter } from '../../src/auth/rate-limit'

describe('createRateLimiter', () => {
  it('allows up to limit requests within the window', () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000 })
    expect(rl.check('k')).toBe(true)
    expect(rl.check('k')).toBe(true)
    expect(rl.check('k')).toBe(true)
    expect(rl.check('k')).toBe(false) // 4th in window
  })

  it('tracks separate keys independently', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000 })
    expect(rl.check('a')).toBe(true)
    expect(rl.check('b')).toBe(true)
    expect(rl.check('a')).toBe(false)
    expect(rl.check('b')).toBe(false)
  })

  it('refills tokens after the window passes', () => {
    let now = 0
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now })
    expect(rl.check('k')).toBe(true)
    expect(rl.check('k')).toBe(false)
    now = 1500
    expect(rl.check('k')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test (fails)**

Run: `pnpm --filter @excalimore/api test tests/auth/rate-limit.test.ts`
Expected: import error.

- [ ] **Step 3: Implement**

Create `apps/api/src/auth/rate-limit.ts`:

```ts
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
```

- [ ] **Step 4: Run test (passes)**

Run: `pnpm --filter @excalimore/api test tests/auth/rate-limit.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/rate-limit.ts apps/api/tests/auth/rate-limit.test.ts
git commit -m "feat(api): add in-memory fixed-window rate limiter"
```

---

### Task 11: Hono middleware (session + CSRF + rate-limit + db injection)

**Files:**
- Create: `apps/api/src/auth/middleware.ts`

This is plumbing that wires the building blocks above into Hono. No new tests at this layer — `flow.test.ts` exercises the assembled pipeline end-to-end.

- [ ] **Step 1: Implement**

Create `apps/api/src/auth/middleware.ts`:

```ts
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
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @excalimore/api typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/auth/middleware.ts
git commit -m "feat(api): add auth middleware (session/csrf/rate-limit/role)"
```

---

### Task 12: Invite token lifecycle

**Files:**
- Create: `apps/api/src/auth/invite.ts`
- Create: `apps/api/tests/auth/invite.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/tests/auth/invite.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { consumeInviteToken, generateInviteToken } from '../../src/auth/invite'
import { inviteTokens } from '../../src/db/schema'
import type { DbClient } from '../../src/db/client'
import { createTestUser, getTestDb } from '../helpers'

let db: DbClient

beforeAll(() => {
  db = getTestDb()
})

afterEach(async () => {
  await db.delete(inviteTokens)
})

describe('generateInviteToken', () => {
  it('creates a token with default 7-day expiry', async () => {
    const { row: admin } = await createTestUser(db, { role: 'admin', password: 'pw' })
    const token = await generateInviteToken(db, { createdBy: admin.id })
    const stored = await db.select().from(inviteTokens).where(eq(inviteTokens.token, token))
    expect(stored).toHaveLength(1)
    expect(stored[0]!.usedAt).toBeNull()
    const ttlMs = stored[0]!.expiresAt.getTime() - Date.now()
    expect(ttlMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000)
    expect(ttlMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000 + 1000)
  })

  it('records optional scene grant', async () => {
    const { row: admin } = await createTestUser(db, { role: 'admin', password: 'pw' })
    const token = await generateInviteToken(db, {
      createdBy: admin.id,
      sceneId: '00000000-0000-0000-0000-000000000000',
      permission: 'view',
    })
    const stored = await db.select().from(inviteTokens).where(eq(inviteTokens.token, token))
    expect(stored[0]!.permission).toBe('view')
    expect(stored[0]!.sceneId).toBe('00000000-0000-0000-0000-000000000000')
  })
})

describe('consumeInviteToken', () => {
  it('returns the token row and marks it used', async () => {
    const { row: admin } = await createTestUser(db, { role: 'admin', password: 'pw' })
    const { row: invitee } = await createTestUser(db, { password: 'pw' })
    const token = await generateInviteToken(db, { createdBy: admin.id })

    const consumed = await consumeInviteToken(db, token, invitee.id)
    expect(consumed).not.toBeNull()
    expect(consumed!.usedBy).toBe(invitee.id)
    expect(consumed!.usedAt).not.toBeNull()
  })

  it('returns null on second consumption attempt', async () => {
    const { row: admin } = await createTestUser(db, { role: 'admin', password: 'pw' })
    const { row: invitee } = await createTestUser(db, { password: 'pw' })
    const token = await generateInviteToken(db, { createdBy: admin.id })
    await consumeInviteToken(db, token, invitee.id)
    const second = await consumeInviteToken(db, token, invitee.id)
    expect(second).toBeNull()
  })

  it('returns null for unknown token', async () => {
    const { row: invitee } = await createTestUser(db, { password: 'pw' })
    expect(await consumeInviteToken(db, 'nope', invitee.id)).toBeNull()
  })

  it('returns null for expired token', async () => {
    const { row: admin } = await createTestUser(db, { role: 'admin', password: 'pw' })
    const { row: invitee } = await createTestUser(db, { password: 'pw' })
    const token = await generateInviteToken(db, { createdBy: admin.id, expiresInSeconds: -1 })
    expect(await consumeInviteToken(db, token, invitee.id)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test (fails)**

Run: `pnpm --filter @excalimore/api test tests/auth/invite.test.ts`
Expected: import error.

- [ ] **Step 3: Implement**

Create `apps/api/src/auth/invite.ts`:

```ts
import { and, eq, isNull } from 'drizzle-orm'
import type { DbClient } from '../db/client'
import { type InviteTokenRow, inviteTokens } from '../db/schema'
import { generateToken } from './ids'

const INVITE_TOKEN_BYTES = 32
const DEFAULT_EXPIRY_SECONDS = 7 * 24 * 60 * 60

export interface GenerateInviteOptions {
  createdBy: string
  sceneId?: string
  permission?: 'view' | 'edit'
  expiresInSeconds?: number
}

export async function generateInviteToken(
  db: DbClient,
  opts: GenerateInviteOptions,
): Promise<string> {
  const token = generateToken(INVITE_TOKEN_BYTES)
  const ttl = opts.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS
  const expiresAt = new Date(Date.now() + ttl * 1000)
  await db.insert(inviteTokens).values({
    token,
    sceneId: opts.sceneId ?? null,
    permission: opts.permission ?? null,
    createdBy: opts.createdBy,
    expiresAt,
  })
  return token
}

/**
 * Atomically marks an invite token as used and returns the resulting row,
 * or null if the token is unknown / already used / expired.
 */
export async function consumeInviteToken(
  db: DbClient,
  token: string,
  consumedBy: string,
): Promise<InviteTokenRow | null> {
  const now = new Date()
  const result = await db
    .update(inviteTokens)
    .set({ usedBy: consumedBy, usedAt: now })
    .where(and(eq(inviteTokens.token, token), isNull(inviteTokens.usedAt)))
    .returning()

  const row = result[0]
  if (!row) return null
  if (row.expiresAt.getTime() <= now.getTime()) {
    // Roll back: this token had already expired before consumption — treat as invalid.
    await db
      .update(inviteTokens)
      .set({ usedBy: null, usedAt: null })
      .where(eq(inviteTokens.token, token))
    return null
  }
  return row
}
```

- [ ] **Step 4: Run test (passes)**

Run: `pnpm --filter @excalimore/api test tests/auth/invite.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/invite.ts apps/api/tests/auth/invite.test.ts
git commit -m "feat(api): add invite token generate and atomic consume"
```

---

### Task 13: Bootstrap (first-run admin token)

**Files:**
- Create: `apps/api/src/auth/bootstrap.ts`
- Create: `apps/api/tests/auth/bootstrap.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/tests/auth/bootstrap.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  consumeBootstrapToken,
  detectFirstRunAndIssueToken,
} from '../../src/auth/bootstrap'
import { bootstrapTokens, users } from '../../src/db/schema'
import type { DbClient } from '../../src/db/client'
import { createTestUser, getTestDb } from '../helpers'

let db: DbClient

beforeAll(() => {
  db = getTestDb()
})

afterEach(async () => {
  await db.delete(bootstrapTokens)
  await db.delete(users)
})

describe('detectFirstRunAndIssueToken', () => {
  it('issues a token when no users exist', async () => {
    const token = await detectFirstRunAndIssueToken(db, 60)
    expect(token).not.toBeNull()
  })

  it('returns null when at least one user already exists', async () => {
    await createTestUser(db, { password: 'pw' })
    const token = await detectFirstRunAndIssueToken(db, 60)
    expect(token).toBeNull()
  })
})

describe('consumeBootstrapToken', () => {
  it('returns true and marks used for valid unused token', async () => {
    const token = await detectFirstRunAndIssueToken(db, 60)
    expect(token).not.toBeNull()
    expect(await consumeBootstrapToken(db, token!)).toBe(true)
  })

  it('returns false on second consumption attempt', async () => {
    const token = await detectFirstRunAndIssueToken(db, 60)
    await consumeBootstrapToken(db, token!)
    expect(await consumeBootstrapToken(db, token!)).toBe(false)
  })

  it('returns false for unknown token', async () => {
    expect(await consumeBootstrapToken(db, 'nope')).toBe(false)
  })

  it('returns false for expired token', async () => {
    const token = await detectFirstRunAndIssueToken(db, -1)
    expect(await consumeBootstrapToken(db, token!)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test (fails)**

Run: `pnpm --filter @excalimore/api test tests/auth/bootstrap.test.ts`
Expected: import error.

- [ ] **Step 3: Implement**

Create `apps/api/src/auth/bootstrap.ts`:

```ts
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DbClient } from '../db/client'
import { bootstrapTokens, users } from '../db/schema'
import { generateToken } from './ids'

const BOOTSTRAP_TOKEN_BYTES = 32

/**
 * Returns a one-time token if the users table is empty. Returns null otherwise.
 * The intent is for the operator to consume this token via the signup endpoint
 * to create the first admin account.
 */
export async function detectFirstRunAndIssueToken(
  db: DbClient,
  expiresInSeconds: number,
): Promise<string | null> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users)
  if ((count ?? 0) > 0) return null

  const token = generateToken(BOOTSTRAP_TOKEN_BYTES)
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000)
  await db.insert(bootstrapTokens).values({ token, expiresAt })
  return token
}

/**
 * Atomically marks the token used. Returns true on success, false if the
 * token is unknown, already used, or expired.
 */
export async function consumeBootstrapToken(db: DbClient, token: string): Promise<boolean> {
  const now = new Date()
  const result = await db
    .update(bootstrapTokens)
    .set({ usedAt: now })
    .where(and(eq(bootstrapTokens.token, token), isNull(bootstrapTokens.usedAt)))
    .returning()

  const row = result[0]
  if (!row) return false
  if (row.expiresAt.getTime() <= now.getTime()) {
    // Roll back: expired tokens are not consumed.
    await db
      .update(bootstrapTokens)
      .set({ usedAt: null })
      .where(eq(bootstrapTokens.token, token))
    return false
  }
  return true
}
```

- [ ] **Step 4: Run test (passes)**

Run: `pnpm --filter @excalimore/api test tests/auth/bootstrap.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/bootstrap.ts apps/api/tests/auth/bootstrap.test.ts
git commit -m "feat(api): add bootstrap first-run admin token"
```

---

### Task 14: Auth routes (signup, login, logout, me, invite)

**Files:**
- Create: `apps/api/src/auth/routes.ts`
- Create: `apps/api/src/auth/index.ts`

This task wires the building blocks into HTTP handlers. The end-to-end test in Task 15 verifies the assembled flow.

- [ ] **Step 1: Implement `apps/api/src/auth/routes.ts`**

```ts
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { CreateInviteRequestSchema, LoginRequestSchema, SignupRequestSchema } from '@excalimore/types'
import type { AppEnv } from '../context'
import { httpError } from '../lib/http-errors'
import { consumeBootstrapToken, detectFirstRunAndIssueToken } from './bootstrap'
import { clearCsrfCookie, clearSessionCookie, setCsrfCookie, setSessionCookie } from './cookie'
import { generateCsrfToken } from './csrf'
import { consumeInviteToken, generateInviteToken } from './invite'
import { hashPassword, verifyPassword } from './password'
import { rateLimit, requireAdmin, requireAuth } from './middleware'
import { createSession, invalidateSession } from './session'
import { shareGrants, users } from '../db/schema'

export function buildAuthRouter(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // Strict rate limit for credential endpoints.
  const credentialLimit = rateLimit({ limit: 5, windowMs: 60_000 })

  app.post('/signup', credentialLimit, async (c) => {
    const json = await c.req.json().catch(() => null)
    const body = SignupRequestSchema.safeParse(json)
    if (!body.success) throw httpError('invalid_input', 'invalid signup body')
    const { token, email, password, name } = body.data
    const db = c.var.db
    const env = c.var.env

    // Path A: invite token → regular user, optional scene grant.
    // Path B: bootstrap token → admin user, no scene grant.
    let role: 'user' | 'admin' = 'user'
    let pendingGrant: { sceneId: string; permission: 'view' | 'edit' } | null = null

    // Try bootstrap first (rare but cheaper to short-circuit).
    if (await consumeBootstrapToken(db, token)) {
      role = 'admin'
    } else {
      // Reserve a placeholder user id by inserting after token consumption fails;
      // we need the user id to record consumption, so create the user provisionally first.
      const passwordHash = await hashPassword(password)
      const inserted = await db
        .insert(users)
        .values({ email, name, passwordHash, role: 'user' })
        .returning()
        .catch((err) => {
          // Unique violation on email
          throw httpError('conflict', `email already registered`)
        })
      const newUser = inserted[0]
      if (!newUser) throw httpError('internal', 'failed to create user')

      const consumed = await consumeInviteToken(db, token, newUser.id)
      if (!consumed) {
        // Roll back the user we just created — token wasn't valid.
        await db.delete(users).where(eq(users.id, newUser.id))
        throw httpError('invalid_input', 'invalid or expired token')
      }

      if (consumed.sceneId && consumed.permission) {
        await db.insert(shareGrants).values({
          sceneId: consumed.sceneId,
          userId: newUser.id,
          permission: consumed.permission,
          grantedBy: consumed.createdBy,
        })
      }

      // Issue session and return.
      const sessionId = await createSession(db, newUser.id, env.SESSION_MAX_AGE)
      setSessionCookie(c, sessionId, {
        maxAgeSeconds: env.SESSION_MAX_AGE,
        secure: env.PUBLIC_URL.startsWith('https://'),
      })
      setCsrfCookie(c, generateCsrfToken(), env.PUBLIC_URL.startsWith('https://'))
      return c.json({
        user: { id: newUser.id, email: newUser.email, name: newUser.name },
        redirectTo: consumed.sceneId ? `/scenes/${consumed.sceneId}` : '/',
      })
    }

    // Bootstrap path: create the admin user.
    const passwordHash = await hashPassword(password)
    const inserted = await db
      .insert(users)
      .values({ email, name, passwordHash, role })
      .returning()
      .catch(() => {
        throw httpError('conflict', 'email already registered')
      })
    const newUser = inserted[0]
    if (!newUser) throw httpError('internal', 'failed to create admin')

    const sessionId = await createSession(db, newUser.id, env.SESSION_MAX_AGE)
    setSessionCookie(c, sessionId, {
      maxAgeSeconds: env.SESSION_MAX_AGE,
      secure: env.PUBLIC_URL.startsWith('https://'),
    })
    setCsrfCookie(c, generateCsrfToken(), env.PUBLIC_URL.startsWith('https://'))
    return c.json({
      user: { id: newUser.id, email: newUser.email, name: newUser.name, role: 'admin' },
      redirectTo: '/',
    })
  })

  app.post('/login', credentialLimit, async (c) => {
    const json = await c.req.json().catch(() => null)
    const body = LoginRequestSchema.safeParse(json)
    if (!body.success) throw httpError('invalid_input', 'invalid login body')
    const { email, password } = body.data
    const db = c.var.db
    const env = c.var.env

    const found = await db.select().from(users).where(eq(users.email, email)).limit(1)
    const user = found[0]
    if (!user) {
      // Burn time on a dummy verify so failures don't reveal whether the email exists.
      await verifyPassword('$argon2id$dummy$', password)
      throw httpError('unauthorized', 'invalid email or password')
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw httpError('unauthorized', 'invalid email or password')
    }

    // Rotate session id at login: prior session ids (if any) are not reused.
    const sessionId = await createSession(db, user.id, env.SESSION_MAX_AGE)
    setSessionCookie(c, sessionId, {
      maxAgeSeconds: env.SESSION_MAX_AGE,
      secure: env.PUBLIC_URL.startsWith('https://'),
    })
    setCsrfCookie(c, generateCsrfToken(), env.PUBLIC_URL.startsWith('https://'))
    return c.json({ user: { id: user.id, email: user.email, name: user.name } })
  })

  app.post('/logout', async (c) => {
    if (c.var.sessionId) await invalidateSession(c.var.db, c.var.sessionId)
    clearSessionCookie(c)
    clearCsrfCookie(c)
    return c.json({ ok: true })
  })

  app.get('/me', requireAuth(), async (c) => {
    const u = c.var.user!
    return c.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role } })
  })

  app.post('/invite', requireAuth(), requireAdmin(), async (c) => {
    const json = await c.req.json().catch(() => ({}))
    const body = CreateInviteRequestSchema.safeParse(json)
    if (!body.success) throw httpError('invalid_input', 'invalid invite body')
    const env = c.var.env
    const created = c.var.user!

    const ttl = body.data.expiresAt
      ? Math.max(60, Math.floor((Date.parse(body.data.expiresAt) - Date.now()) / 1000))
      : undefined
    const token = await generateInviteToken(c.var.db, {
      createdBy: created.id,
      sceneId: body.data.sceneId,
      permission: body.data.permission,
      expiresInSeconds: ttl,
    })
    return c.json({ token, url: `${env.PUBLIC_URL}/signup?token=${encodeURIComponent(token)}` })
  })

  return app
}

// Re-export the bootstrap detector for the app boot script.
export { detectFirstRunAndIssueToken }
```

- [ ] **Step 2: Implement `apps/api/src/auth/index.ts`**

```ts
export { buildAuthRouter } from './routes'
export { detectFirstRunAndIssueToken } from './bootstrap'
export {
  injectContext,
  loadSession,
  requireAuth,
  requireAdmin,
  csrfProtect,
  rateLimit,
} from './middleware'
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @excalimore/api typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/auth/routes.ts apps/api/src/auth/index.ts
git commit -m "feat(api): add /api/auth routes (signup, login, logout, me, invite)"
```

---

### Task 15: End-to-end flow integration test

**Files:**
- Create: `apps/api/tests/auth/flow.test.ts`

This is the integration test that exercises the assembled middleware + routes against a real Postgres + a real Hono app. If this passes, Phase 2 is genuinely working.

- [ ] **Step 1: Write the test**

Create `apps/api/tests/auth/flow.test.ts`:

```ts
import { Hono } from 'hono'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  buildAuthRouter,
  detectFirstRunAndIssueToken,
  injectContext,
  loadSession,
} from '../../src/auth'
import type { AppEnv } from '../../src/context'
import { bootstrapTokens, inviteTokens, sessions, shareGrants, users } from '../../src/db/schema'
import { loadEnv } from '../../src/env'
import { getTestDb } from '../helpers'

function buildTestApp() {
  const db = getTestDb()
  const env = loadEnv()
  const app = new Hono<AppEnv>()
  app.use('*', injectContext(db, env))
  app.use('*', loadSession())
  app.route('/api/auth', buildAuthRouter())
  return { app, db, env }
}

const { app, db, env } = buildTestApp()

afterEach(async () => {
  await db.delete(sessions)
  await db.delete(shareGrants)
  await db.delete(inviteTokens)
  await db.delete(bootstrapTokens)
  await db.delete(users)
})

function getCookie(res: Response, name: string): string | undefined {
  const setCookie = res.headers.getSetCookie?.() ?? []
  for (const line of setCookie) {
    const [pair] = line.split(';')
    const [k, v] = pair!.split('=')
    if (k === name) return decodeURIComponent(v ?? '')
  }
  return undefined
}

describe('end-to-end auth flow', () => {
  it('completes bootstrap → invite → signup → me → logout', async () => {
    // 1. Bootstrap: API issues token because users table is empty.
    const bootstrapToken = await detectFirstRunAndIssueToken(db, env.BOOTSTRAP_TOKEN_TTL)
    expect(bootstrapToken).not.toBeNull()

    // 2. Operator signs up as admin via bootstrap token.
    const adminSignup = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: bootstrapToken,
        email: 'admin@excalimore.test',
        password: 'admin-password',
        name: 'Admin',
      }),
    })
    expect(adminSignup.status).toBe(200)
    const adminCookie = getCookie(adminSignup, 'excalimore_session')
    expect(adminCookie).toBeTruthy()

    // 3. Admin generates an invite token.
    const inviteRes = await app.request('/api/auth/invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `excalimore_session=${adminCookie}`,
      },
      body: JSON.stringify({}),
    })
    expect(inviteRes.status).toBe(200)
    const { token: inviteToken } = (await inviteRes.json()) as { token: string }

    // 4. Invitee signs up using the invite token.
    const guestSignup = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: inviteToken,
        email: 'guest@excalimore.test',
        password: 'guest-password',
        name: 'Guest',
      }),
    })
    expect(guestSignup.status).toBe(200)
    const guestCookie = getCookie(guestSignup, 'excalimore_session')
    expect(guestCookie).toBeTruthy()

    // 5. Guest hits /me — should get their identity.
    const meRes = await app.request('/api/auth/me', {
      headers: { Cookie: `excalimore_session=${guestCookie}` },
    })
    expect(meRes.status).toBe(200)
    const meBody = (await meRes.json()) as { user: { email: string; role: string } }
    expect(meBody.user.email).toBe('guest@excalimore.test')
    expect(meBody.user.role).toBe('user')

    // 6. Guest logs out — subsequent /me with same cookie returns 401.
    const logoutRes = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: `excalimore_session=${guestCookie}` },
    })
    expect(logoutRes.status).toBe(200)

    const meAfter = await app.request('/api/auth/me', {
      headers: { Cookie: `excalimore_session=${guestCookie}` },
    })
    expect(meAfter.status).toBe(401)
  })

  it('rejects login with wrong password', async () => {
    // Seed a user via the bootstrap path.
    const bootstrapToken = await detectFirstRunAndIssueToken(db, 60)
    await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: bootstrapToken,
        email: 'user@excalimore.test',
        password: 'real-password',
        name: 'User',
      }),
    })

    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@excalimore.test', password: 'wrong' }),
    })
    expect(loginRes.status).toBe(401)
  })

  it('rejects /me without a session cookie', async () => {
    const res = await app.request('/api/auth/me')
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @excalimore/api test tests/auth/flow.test.ts`
Expected: 3 tests pass. The "complete flow" test exercises the full bootstrap→invite→signup→me→logout chain end-to-end.

- [ ] **Step 3: Commit**

```bash
git add apps/api/tests/auth/flow.test.ts
git commit -m "test(api): end-to-end auth flow integration test"
```

---

### Task 16: Wire auth into app boot

**Files:**
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Replace `apps/api/src/index.ts`**

```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import {
  buildAuthRouter,
  csrfProtect,
  detectFirstRunAndIssueToken,
  injectContext,
  loadSession,
} from './auth'
import type { AppEnv } from './context'
import { createDbClient } from './db/client'
import { loadEnv } from './env'

const env = loadEnv()
const db = createDbClient(env.DATABASE_URL)

const app = new Hono<AppEnv>()

app.use('*', injectContext(db, env))
app.use('*', loadSession())
app.use('/api/*', csrfProtect())

app.get('/api/health', (c) => c.json({ status: 'ok', service: 'excalimore-api' }))

app.route('/api/auth', buildAuthRouter())

app.notFound((c) => c.json({ error: 'Not Found' }, 404))

app.onError((err, c) => {
  // HTTPException already carries a Response; let Hono surface it.
  if ('getResponse' in err && typeof err.getResponse === 'function') {
    return err.getResponse()
  }
  console.error(err)
  return c.json({ error: 'Internal Server Error' }, 500)
})

const bootstrapToken = await detectFirstRunAndIssueToken(db, env.BOOTSTRAP_TOKEN_TTL)
if (bootstrapToken) {
  console.log('')
  console.log('==========================================================')
  console.log('No users found. Bootstrap admin via:')
  console.log(`  ${env.PUBLIC_URL}/signup?bootstrap=${bootstrapToken}`)
  console.log(`  (valid for ${env.BOOTSTRAP_TOKEN_TTL} seconds)`)
  console.log('==========================================================')
  console.log('')
}

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`excalimore-api listening on http://localhost:${info.port}`)
})
```

- [ ] **Step 2: Boot and verify the bootstrap log**

Make sure dev DB is running and migrated, then drop existing users for a clean first-run:

```bash
docker compose -f apps/api/docker-compose.dev.yml exec -T postgres \
  psql -U excalimore -d excalimore -c "TRUNCATE users CASCADE;"
```

Start API:

```bash
cd apps/api && pnpm dev
```

Expected output includes:

```
==========================================================
No users found. Bootstrap admin via:
  http://localhost:5173/signup?bootstrap=<long token>
  (valid for 3600 seconds)
==========================================================
excalimore-api listening on http://localhost:3000
```

Stop with Ctrl-C.

- [ ] **Step 3: Manual smoke test**

In one shell run `pnpm dev`. In another, run:

```bash
TOKEN=<paste bootstrap token from logs>

curl -sS -i -X POST http://localhost:3000/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"email\":\"bimo@example.com\",\"password\":\"hunter2hunter\",\"name\":\"Bimo\"}"
```

Expected: 200 with `Set-Cookie: excalimore_session=…` and `excalimore_csrf=…`. Body: `{"user":{...,"role":"admin"},"redirectTo":"/"}`.

Then:

```bash
curl -sS -i http://localhost:3000/api/auth/me \
  -H "Cookie: excalimore_session=<paste from previous>"
```

Expected: 200 with `{"user":{...,"role":"admin"}}`.

- [ ] **Step 4: Run full test suite**

Run: `pnpm --filter @excalimore/api test`
Expected: all auth tests + earlier healthcheck/schema tests pass (~30 tests total).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): wire auth router and run bootstrap detection on boot"
```

---

### Task 17: Documentation

**Files:**
- Create: `docs/auth.md`

- [ ] **Step 1: Create `docs/auth.md`**

```markdown
# Auth in Excalimore

This document describes how authentication works for operators (people running Excalimore) and contributors (people reading the source).

## Concepts

- **Bootstrap token** — issued once when the database has no users. Lets the very first operator create the admin account.
- **Invite token** — created by an admin. Single-use. Optionally pre-grants a scene to whoever consumes it.
- **Session** — random 32-byte token stored in a DB-backed `sessions` table. Carried in the `excalimore_session` HttpOnly cookie.
- **CSRF token** — random per-session token in the (non-HttpOnly) `excalimore_csrf` cookie. The frontend must echo it as the `X-CSRF-Token` header on every mutating request.

## First-run bootstrap

When the API container starts and the `users` table is empty, it prints a one-time URL to stdout:

\`\`\`
==========================================================
No users found. Bootstrap admin via:
  https://excalimore.example.com/signup?bootstrap=<token>
  (valid for 3600 seconds)
==========================================================
\`\`\`

Visit the URL, set email + password + name, and the first user is created with role `admin`. Subsequent boots skip this step.

## Invite flow (admin)

1. `POST /api/auth/invite` with optional `{ sceneId, permission }`.
2. Backend returns `{ token, url }` where `url` is `${PUBLIC_URL}/signup?token=...`.
3. Share the URL with the invitee through any channel.
4. Invitee opens the URL, enters email + password + name, and signs up.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/signup` | Body `{ token, email, password, name }` — token is invite OR bootstrap. |
| POST | `/api/auth/login` | Body `{ email, password }`. Sets session cookie. |
| POST | `/api/auth/logout` | Invalidates session and clears cookies. |
| GET  | `/api/auth/me` | Requires session. Returns current user. |
| POST | `/api/auth/invite` | Admin only. Body `{ sceneId?, permission?, expiresAt? }`. |

## Cookies

| Name | HttpOnly | Purpose |
|---|---|---|
| `excalimore_session` | yes | Carries the session id. Lives for `SESSION_MAX_AGE` seconds (default 30 days). |
| `excalimore_csrf` | **no** | Read by frontend JS to populate the `X-CSRF-Token` header. |

`SameSite=Lax`, `Secure` when `PUBLIC_URL` is HTTPS.

## CSRF model

We use the double-submit cookie pattern. On every mutating method (`POST`/`PUT`/`PATCH`/`DELETE`):

1. Frontend reads `excalimore_csrf` cookie.
2. Frontend includes the value as the `X-CSRF-Token` header.
3. Server compares the cookie ↔ header with `crypto.timingSafeEqual`.

`SameSite=Lax` blocks cross-origin POSTs from being sent with the cookie at all, providing a second layer.

## Rate limits

- `/api/auth/login` and `/api/auth/signup`: 5 requests / minute / IP.
- All other authenticated endpoints: 60 requests / minute / user (Phase 3).

In-memory only; multi-instance deployments need a shared store.

## Password policy

- Stored as argon2id (`memoryCost=19456 KiB`, `timeCost=2`, `parallelism=1`).
- Minimum 8 characters at the schema layer (`SignupRequestSchema`).
- No upper bound on entropy — pick a passphrase, not a password.

## What we deliberately did not build (yet)

- Forgot-password (no SMTP infra in MVP). Workaround: admin resets via DB / future CLI.
- Email verification (invite link is implicit verification).
- OAuth providers.
- 2FA / TOTP / passkeys.
- Logout-all-devices.
- Self-serve password change UI.

These are additive on top of the existing schema.
```

- [ ] **Step 2: Commit**

```bash
git add docs/auth.md
git commit -m "docs: add auth.md describing bootstrap, invite, and cookie model"
```

---

## Phase 2 Done Criteria

Tick when **all** of the following are true:

- [ ] `pnpm --filter @excalimore/api typecheck` clean.
- [ ] `pnpm --filter @excalimore/api test` passes — at minimum these test files exist and pass: `ids.test.ts`, `password.test.ts`, `csrf.test.ts`, `rate-limit.test.ts`, `session.test.ts`, `invite.test.ts`, `bootstrap.test.ts`, `flow.test.ts`.
- [ ] Running the API on a fresh empty DB prints the bootstrap URL to stdout.
- [ ] Bootstrap signup → admin → invite → invitee signup → /me → logout works end-to-end via `curl`.
- [ ] Wrong password on `/api/auth/login` returns 401.
- [ ] `/api/auth/me` without cookie returns 401.
- [ ] `pnpm lint` reports no errors.
- [ ] CI green on the Phase 2 PR.

When all checked: open Phase 3 plan-writing session.
