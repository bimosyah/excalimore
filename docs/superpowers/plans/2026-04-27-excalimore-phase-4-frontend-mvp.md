# Excalimore Implementation Plan — Phase 4: Frontend MVP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working web frontend the operator can use end-to-end: log in (or complete bootstrap signup), see their scenes and folders in a sidebar, click a scene to open the Excalidraw editor, draw, and have changes saved automatically. Sharing UI and comment overlay are deferred to Phase 5.

**Architecture:** Vite + React 19 SPA, TanStack Router for routes, TanStack Query for server state (cache + invalidation), `@excalidraw/excalidraw` for the editor. CSRF token read from cookie and attached to mutating fetches automatically. No new backend changes — Phase 4 only consumes the API built in Phases 2 & 3.

**Tech Stack:** `@tanstack/react-router` ^1.87, `@tanstack/react-query` ^5.59, `@excalidraw/excalidraw` ^0.18 (verify latest at install), `react-hook-form` ^7.54 + `@hookform/resolvers` ^3.9 + `zod` (already present) for forms. No CSS framework — write small CSS modules or plain CSS for now (Tailwind in Phase 5+ if it gets noisy).

**Spec reference:** [`../specs/2026-04-27-excalimore-design.md`](../specs/2026-04-27-excalimore-design.md), §4 architecture (frontend layout). Phase 4 covers everything except the comment overlay layer (Phase 5) and production deployment (Phase 6).

**Phase 3 prerequisite:** All `/api/auth/*`, `/api/folders`, `/api/scenes`, `/api/comments`, `/api/events` endpoints live and proxied via Vite to `localhost:3000`.

---

## Phase 4 File Structure

```
apps/web/
├── src/
│   ├── api/
│   │   ├── client.ts                  # NEW — typed fetch wrapper with CSRF + zod parsing
│   │   ├── auth.ts                    # NEW — login/signup/logout/me hooks
│   │   ├── folders.ts                 # NEW — list/create/patch/delete hooks
│   │   └── scenes.ts                  # NEW — list/get/save/create hooks
│   ├── routes/
│   │   ├── __root.tsx                 # NEW — root layout (auth gate, providers)
│   │   ├── login.tsx                  # NEW — /login
│   │   ├── signup.tsx                 # NEW — /signup?token=&bootstrap=
│   │   ├── _authed.tsx                # NEW — protected layout (sidebar + outlet)
│   │   ├── _authed.index.tsx          # NEW — / (scene grid)
│   │   ├── _authed.scenes.$id.tsx     # NEW — /scenes/:id (editor)
│   │   └── -components/
│   │       ├── FolderSidebar.tsx      # NEW
│   │       ├── SceneCard.tsx          # NEW
│   │       └── NewSceneButton.tsx     # NEW
│   ├── lib/
│   │   ├── csrf.ts                    # NEW — read excalimore_csrf cookie
│   │   ├── debounce.ts                # NEW — generic debounce
│   │   └── route-tree.ts              # NEW — generated TanStack route tree
│   ├── styles/
│   │   ├── reset.css                  # NEW — minimal reset (replaces existing styles.css)
│   │   └── app.css                    # NEW — sidebar/grid/editor layout
│   ├── app.tsx                        # MODIFY — root component → <RouterProvider />
│   ├── main.tsx                       # MODIFY — add QueryClientProvider
│   └── vite-env.d.ts                  # NEW — augment ImportMetaEnv
├── tests/
│   ├── lib/
│   │   ├── csrf.test.ts               # NEW
│   │   └── debounce.test.ts           # NEW
│   └── api/
│       └── client.test.ts             # NEW — happy/error-path with mocked fetch
└── tsr.config.json                    # NEW — TanStack Router config
```

---

## Tasks

### Task 1: Install Phase 4 dependencies

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add deps**

Edit `apps/web/package.json`. Add to `dependencies`:

```json
"@excalidraw/excalidraw": "^0.18.0",
"@hookform/resolvers": "^3.9.0",
"@tanstack/react-query": "^5.59.0",
"@tanstack/react-router": "^1.87.0",
"react-hook-form": "^7.54.0",
"zod": "^3.23.0"
```

Add to `devDependencies`:

```json
"@tanstack/router-vite-plugin": "^1.87.0",
"@testing-library/react": "^16.1.0",
"jsdom": "^25.0.0"
```

(Versions are floors; install will pick the latest minor.)

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: ~50-80 packages added, no errors. Excalidraw is the largest (~2-3MB) — first install takes ~30s.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add Phase 4 dependencies (TanStack Router/Query, Excalidraw, RHF)"
```

---

### Task 2: CSRF helper + debounce utility

**Files:**
- Create: `apps/web/src/lib/csrf.ts`
- Create: `apps/web/src/lib/debounce.ts`
- Create: `apps/web/tests/lib/csrf.test.ts`
- Create: `apps/web/tests/lib/debounce.test.ts`
- Create: `apps/web/vitest.config.ts`

- [ ] **Step 1: Create vitest config**

`apps/web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
```

- [ ] **Step 2: Write failing tests**

`apps/web/tests/lib/csrf.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { readCsrfToken } from '../../src/lib/csrf'

afterEach(() => {
  document.cookie = 'excalimore_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
})

describe('readCsrfToken', () => {
  it('returns null when cookie is absent', () => {
    expect(readCsrfToken()).toBeNull()
  })

  it('returns the token value when present', () => {
    document.cookie = 'excalimore_csrf=abc123; path=/'
    expect(readCsrfToken()).toBe('abc123')
  })

  it('decodes percent-encoded values', () => {
    document.cookie = `excalimore_csrf=${encodeURIComponent('a/b+c')}; path=/`
    expect(readCsrfToken()).toBe('a/b+c')
  })

  it('ignores other cookies', () => {
    document.cookie = 'other=value; path=/'
    document.cookie = 'excalimore_csrf=token; path=/'
    expect(readCsrfToken()).toBe('token')
  })
})
```

`apps/web/tests/lib/debounce.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { debounce } from '../../src/lib/debounce'

describe('debounce', () => {
  it('calls the function once after the specified delay', async () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced('a')
    debounced('b')
    debounced('c')
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('c')
    vi.useRealTimers()
  })

  it('cancels pending call when cancel() is invoked', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced('a')
    debounced.cancel()
    vi.advanceTimersByTime(100)
    expect(fn).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
```

- [ ] **Step 3: Run tests (fail)**

Run: `pnpm --filter @excalimore/web test`
Expected: import errors.

- [ ] **Step 4: Implement**

`apps/web/src/lib/csrf.ts`:

```ts
const CSRF_COOKIE = 'excalimore_csrf'

/** Read the CSRF token from document.cookie, or null if absent. */
export function readCsrfToken(): string | null {
  const cookies = document.cookie.split(';')
  for (const c of cookies) {
    const [k, v] = c.trim().split('=', 2)
    if (k === CSRF_COOKIE && v) return decodeURIComponent(v)
  }
  return null
}
```

`apps/web/src/lib/debounce.ts`:

```ts
export interface DebouncedFn<Args extends unknown[]> {
  (...args: Args): void
  cancel(): void
}

/**
 * Returns a debounced version of `fn` — calls within `delayMs` of each other
 * coalesce; only the trailing call's args are passed.
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
): DebouncedFn<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastArgs: Args | undefined

  const debounced = ((...args: Args) => {
    lastArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      if (lastArgs) fn(...lastArgs)
      lastArgs = undefined
    }, delayMs)
  }) as DebouncedFn<Args>

  debounced.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    lastArgs = undefined
  }

  return debounced
}
```

- [ ] **Step 5: Run tests (pass)**

Run: `pnpm --filter @excalimore/web test`
Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib apps/web/tests apps/web/vitest.config.ts
git commit -m "feat(web): add CSRF cookie reader and debounce utility"
```

---

### Task 3: Typed API client

**Files:**
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/tests/api/client.test.ts`

A thin fetch wrapper that:
- Sends cookies (`credentials: 'include'`)
- Attaches `X-CSRF-Token` for non-GET requests
- Parses JSON response with a Zod schema
- Throws a typed error on non-2xx

- [ ] **Step 1: Write failing tests**

`apps/web/tests/api/client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ApiError, apiFetch } from '../../src/api/client'

const RESPONSE_SCHEMA = z.object({ ok: z.boolean() })

beforeEach(() => {
  // CSRF cookie present
  document.cookie = 'excalimore_csrf=test-csrf; path=/'
})

afterEach(() => {
  document.cookie = 'excalimore_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
  vi.restoreAllMocks()
})

describe('apiFetch', () => {
  it('returns parsed body on 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const data = await apiFetch('/api/x', { schema: RESPONSE_SCHEMA })
    expect(data).toEqual({ ok: true })
  })

  it('attaches X-CSRF-Token on POST', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    await apiFetch('/api/x', { method: 'POST', body: { a: 1 }, schema: RESPONSE_SCHEMA })
    const init = fetchSpy.mock.calls[0]![1]!
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('test-csrf')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ a: 1 }))
  })

  it('throws ApiError with code on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'unauthorized', message: 'go away' }), {
        status: 401,
      }),
    )
    await expect(apiFetch('/api/x', { schema: RESPONSE_SCHEMA })).rejects.toThrow(ApiError)
  })
})
```

- [ ] **Step 2: Run test (fails)**

Run: `pnpm --filter @excalimore/web test tests/api/client.test.ts`
Expected: import error.

- [ ] **Step 3: Implement**

`apps/web/src/api/client.ts`:

```ts
import type { z } from 'zod'
import { readCsrfToken } from '../lib/csrf'

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

interface ApiOptions<Schema extends z.ZodTypeAny> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  schema: Schema
  signal?: AbortSignal
}

export async function apiFetch<Schema extends z.ZodTypeAny>(
  path: string,
  opts: ApiOptions<Schema>,
): Promise<z.infer<Schema>> {
  const method = opts.method ?? 'GET'
  const headers: Record<string, string> = {}

  let body: BodyInit | undefined
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = readCsrfToken()
    if (csrf) headers['X-CSRF-Token'] = csrf
  }

  const res = await fetch(path, {
    method,
    headers,
    body,
    credentials: 'include',
    signal: opts.signal,
  })

  let parsedBody: unknown = null
  const text = await res.text()
  if (text.length > 0) {
    try {
      parsedBody = JSON.parse(text)
    } catch {
      // Non-JSON body — leave parsedBody as null.
    }
  }

  if (!res.ok) {
    const code = (parsedBody as { error?: string } | null)?.error ?? 'http_error'
    const message =
      (parsedBody as { message?: string } | null)?.message ?? `HTTP ${res.status}`
    throw new ApiError(code, message, res.status)
  }

  return opts.schema.parse(parsedBody)
}
```

- [ ] **Step 4: Run test (pass)**

Run: `pnpm --filter @excalimore/web test tests/api/client.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/tests/api/client.test.ts
git commit -m "feat(web): add typed apiFetch with CSRF attach and zod parsing"
```

---

### Task 4: TanStack Router scaffold + root layout

**Files:**
- Create: `apps/web/src/routes/__root.tsx`
- Create: `apps/web/src/routes/login.tsx` (placeholder)
- Create: `apps/web/src/routes/signup.tsx` (placeholder)
- Create: `apps/web/src/routes/index.tsx` (placeholder)
- Create: `apps/web/src/lib/route-tree.ts` (will be auto-generated)
- Modify: `apps/web/vite.config.ts` — add `TanStackRouterVite` plugin
- Modify: `apps/web/src/app.tsx` — `<RouterProvider />`
- Modify: `apps/web/src/main.tsx` — `<QueryClientProvider>` + remove old smoke test

This task only stands up the routing skeleton. Each route page is a placeholder; subsequent tasks fill them in.

- [ ] **Step 1: Update `apps/web/vite.config.ts`**

```ts
import { TanStackRouterVite } from '@tanstack/router-vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [TanStackRouterVite(), react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/events': 'http://localhost:3000',
    },
  },
})
```

- [ ] **Step 2: Create `apps/web/src/routes/__root.tsx`**

```tsx
import { Outlet, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <>
      <Outlet />
    </>
  )
}
```

- [ ] **Step 3: Create placeholder route files**

`apps/web/src/routes/login.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/login')({
  component: () => <main style={{ padding: '2rem' }}><h1>Login (Task 6)</h1></main>,
})
```

`apps/web/src/routes/signup.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/signup')({
  component: () => <main style={{ padding: '2rem' }}><h1>Signup (Task 7)</h1></main>,
})
```

`apps/web/src/routes/index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: () => <main style={{ padding: '2rem' }}><h1>Home (Task 9)</h1></main>,
})
```

- [ ] **Step 4: Replace `apps/web/src/app.tsx`**

```tsx
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from './lib/route-tree'

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export function App() {
  return <RouterProvider router={router} />
}
```

- [ ] **Step 5: Replace `apps/web/src/main.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false } },
})

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
```

- [ ] **Step 6: Run dev server to generate route tree**

The TanStack Router vite plugin auto-generates `src/lib/route-tree.ts` (or wherever configured). Default location is `src/routeTree.gen.ts`. We point it at `src/lib/route-tree.ts` via config.

Create `apps/web/tsr.config.json`:

```json
{
  "routesDirectory": "./src/routes",
  "generatedRouteTree": "./src/lib/route-tree.ts",
  "routeFileIgnorePrefix": "-"
}
```

Run dev briefly to trigger generation:

```bash
cd apps/web && pnpm dev
# Wait ~3s for the plugin to write src/lib/route-tree.ts, then Ctrl-C.
```

Verify `src/lib/route-tree.ts` was created.

- [ ] **Step 7: Smoke test in browser**

```bash
cd apps/api && pnpm dev &
cd apps/web && pnpm dev
```

Visit `http://localhost:5173/` → "Home (Task 9)". Visit `/login` → placeholder. Visit `/signup` → placeholder. Stop both with Ctrl-C.

Aside: the file `apps/web/src/styles.css` is still imported by `main.tsx`. It currently has the minimal reset. We will replace it in Task 5.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): scaffold TanStack Router with QueryClientProvider and placeholder routes"
```

---

### Task 5: Auth API hooks

**Files:**
- Create: `apps/web/src/api/auth.ts`

These are React Query hooks for the `/api/auth/*` endpoints. The `Me` schema mirrors what `/api/auth/me` returns. The `useMe` query is what protected routes hang off of.

- [ ] **Step 1: Implement `apps/web/src/api/auth.ts`**

```tsx
import { LoginRequestSchema, SignupRequestSchema } from '@excalimore/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { apiFetch } from './client'

const MeSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    role: z.enum(['user', 'admin']),
  }),
})

const SignupResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    role: z.enum(['user', 'admin']).optional(),
  }),
  redirectTo: z.string(),
})

const LoginResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
  }),
})

const LogoutResponseSchema = z.object({ ok: z.boolean() })

export type Me = z.infer<typeof MeSchema>['user']

export function useMe() {
  return useQuery({
    queryKey: ['me'] as const,
    queryFn: async () => {
      try {
        const data = await apiFetch('/api/auth/me', { schema: MeSchema })
        return data.user
      } catch (err) {
        if (err instanceof Error && err.message.includes('401')) return null
        throw err
      }
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: z.infer<typeof LoginRequestSchema>) =>
      apiFetch('/api/auth/login', { method: 'POST', body: vars, schema: LoginResponseSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
}

export function useSignup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: z.infer<typeof SignupRequestSchema>) =>
      apiFetch('/api/auth/signup', { method: 'POST', body: vars, schema: SignupResponseSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      apiFetch('/api/auth/logout', { method: 'POST', schema: LogoutResponseSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @excalimore/web typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api/auth.ts
git commit -m "feat(web): add useMe / useLogin / useSignup / useLogout hooks"
```

---

### Task 6: Login page

**Files:**
- Modify: `apps/web/src/routes/login.tsx`

- [ ] **Step 1: Replace `apps/web/src/routes/login.tsx`**

```tsx
import { LoginRequestSchema } from '@excalimore/types'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { useLogin } from '../api/auth'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

type LoginInput = z.infer<typeof LoginRequestSchema>

function LoginPage() {
  const navigate = useNavigate()
  const login = useLogin()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(LoginRequestSchema) })

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={{ margin: 0 }}>Sign in to Excalimore</h1>
        <form
          onSubmit={handleSubmit(async (values) => {
            await login.mutateAsync(values)
            navigate({ to: '/' })
          })}
          style={formStyle}
        >
          <label style={labelStyle}>
            Email
            <input type="email" autoComplete="email" {...register('email')} style={inputStyle} />
            {errors.email && <span style={errorStyle}>{errors.email.message}</span>}
          </label>
          <label style={labelStyle}>
            Password
            <input
              type="password"
              autoComplete="current-password"
              {...register('password')}
              style={inputStyle}
            />
            {errors.password && <span style={errorStyle}>{errors.password.message}</span>}
          </label>
          {login.error && (
            <div style={errorBannerStyle}>
              {login.error instanceof Error ? login.error.message : 'login failed'}
            </div>
          )}
          <button type="submit" disabled={login.isPending} style={buttonStyle}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p style={{ fontSize: '0.85em', color: '#666', marginTop: '1rem' }}>
          Have an invite? <Link to="/signup">Sign up here</Link>.
        </p>
      </div>
    </main>
  )
}

const pageStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  padding: '2rem',
}
const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 360,
  background: 'white',
  border: '1px solid #e5e5e5',
  borderRadius: 12,
  padding: '2rem',
  boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
}
const formStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.9em' }
const inputStyle: React.CSSProperties = { padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #ddd', fontSize: '1em' }
const buttonStyle: React.CSSProperties = {
  padding: '0.6rem 1rem',
  background: '#1971c2',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  fontSize: '1em',
  cursor: 'pointer',
  marginTop: '0.5rem',
}
const errorStyle: React.CSSProperties = { color: '#c92a2a', fontSize: '0.85em' }
const errorBannerStyle: React.CSSProperties = { ...errorStyle, padding: '0.5rem', background: '#fff5f5', borderRadius: 6 }
```

- [ ] **Step 2: Browser smoke test**

```bash
cd apps/api && pnpm dev &
cd apps/web && pnpm dev
```

Visit `http://localhost:5173/login`. Try login with bad creds → see error banner. Login with admin (after Task 7 bootstrap) succeeds — redirects to `/` placeholder. Stop servers.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/login.tsx
git commit -m "feat(web): implement /login page with react-hook-form + zodResolver"
```

---

### Task 7: Signup page (handles invite & bootstrap tokens)

**Files:**
- Modify: `apps/web/src/routes/signup.tsx`

The signup route reads either `?token=...` (invite) or `?bootstrap=...` (first-run admin) and posts to `/api/auth/signup`.

- [ ] **Step 1: Replace `apps/web/src/routes/signup.tsx`**

```tsx
import { SignupRequestSchema } from '@excalimore/types'
import { zodResolver } from '@hookform/resolvers/zod'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useSignup } from '../api/auth'

const SearchSchema = z.object({
  token: z.string().optional(),
  bootstrap: z.string().optional(),
})

export const Route = createFileRoute('/signup')({
  validateSearch: SearchSchema.parse,
  component: SignupPage,
})

const FormSchema = SignupRequestSchema.omit({ token: true })
type FormInput = z.infer<typeof FormSchema>

function SignupPage() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const signup = useSignup()
  const token = search.token ?? search.bootstrap ?? ''
  const isBootstrap = Boolean(search.bootstrap)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormInput>({ resolver: zodResolver(FormSchema) })

  if (!token) {
    return (
      <main style={pageStyle}>
        <div style={cardStyle}>
          <h1>Invite required</h1>
          <p>This Excalimore instance is invite-only. Open your invite link to sign up.</p>
        </div>
      </main>
    )
  }

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={{ margin: 0 }}>{isBootstrap ? 'Bootstrap admin account' : 'Create your account'}</h1>
        {isBootstrap && (
          <p style={{ fontSize: '0.85em', color: '#666' }}>
            This is a first-run setup link. The user you create will be the admin.
          </p>
        )}
        <form
          onSubmit={handleSubmit(async (values) => {
            const res = await signup.mutateAsync({ ...values, token })
            navigate({ to: res.redirectTo === '/' ? '/' : (res.redirectTo as '/') })
          })}
          style={formStyle}
        >
          <label style={labelStyle}>
            Name
            <input {...register('name')} style={inputStyle} />
            {errors.name && <span style={errorStyle}>{errors.name.message}</span>}
          </label>
          <label style={labelStyle}>
            Email
            <input type="email" autoComplete="email" {...register('email')} style={inputStyle} />
            {errors.email && <span style={errorStyle}>{errors.email.message}</span>}
          </label>
          <label style={labelStyle}>
            Password (min 8 chars)
            <input
              type="password"
              autoComplete="new-password"
              {...register('password')}
              style={inputStyle}
            />
            {errors.password && <span style={errorStyle}>{errors.password.message}</span>}
          </label>
          {signup.error && (
            <div style={errorBannerStyle}>
              {signup.error instanceof Error ? signup.error.message : 'signup failed'}
            </div>
          )}
          <button type="submit" disabled={signup.isPending} style={buttonStyle}>
            {signup.isPending ? 'Creating…' : 'Create account'}
          </button>
        </form>
      </div>
    </main>
  )
}

// (Reuse style constants from login.tsx — duplicate here for now; consolidate in a later phase if it grows.)
const pageStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '2rem' }
const cardStyle: React.CSSProperties = { width: '100%', maxWidth: 360, background: 'white', border: '1px solid #e5e5e5', borderRadius: 12, padding: '2rem', boxShadow: '0 4px 12px rgba(0,0,0,0.04)' }
const formStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.9em' }
const inputStyle: React.CSSProperties = { padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #ddd', fontSize: '1em' }
const buttonStyle: React.CSSProperties = { padding: '0.6rem 1rem', background: '#1971c2', color: 'white', border: 'none', borderRadius: 6, fontSize: '1em', cursor: 'pointer', marginTop: '0.5rem' }
const errorStyle: React.CSSProperties = { color: '#c92a2a', fontSize: '0.85em' }
const errorBannerStyle: React.CSSProperties = { ...errorStyle, padding: '0.5rem', background: '#fff5f5', borderRadius: 6 }
```

- [ ] **Step 2: Browser smoke test**

```bash
docker compose -f apps/api/docker-compose.dev.yml exec -T postgres \
  psql -U excalimore -d excalimore -c "TRUNCATE users, bootstrap_tokens CASCADE;"
cd apps/api && pnpm dev > /tmp/api.log 2>&1 &
cd apps/web && pnpm dev
```

Watch `/tmp/api.log` for the bootstrap URL. Visit `http://localhost:5173/signup?bootstrap=<token>`. Fill the form, submit — should redirect to `/` (home placeholder). Stop servers.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/signup.tsx
git commit -m "feat(web): implement /signup with invite & bootstrap token support"
```

---

### Task 8: Folders & scenes API hooks

**Files:**
- Create: `apps/web/src/api/folders.ts`
- Create: `apps/web/src/api/scenes.ts`

- [ ] **Step 1: `apps/web/src/api/folders.ts`**

```tsx
import { CreateFolderRequestSchema, FolderSchema, UpdateFolderRequestSchema } from '@excalimore/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { apiFetch } from './client'

const ListFoldersSchema = z.object({ folders: z.array(FolderSchema) })
const CreateFolderResponseSchema = z.object({ folder: FolderSchema })
const OkSchema = z.object({ ok: z.boolean() })

export function useFolders() {
  return useQuery({
    queryKey: ['folders'] as const,
    queryFn: async () => {
      const data = await apiFetch('/api/folders', { schema: ListFoldersSchema })
      return data.folders
    },
  })
}

export function useCreateFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: z.infer<typeof CreateFolderRequestSchema>) =>
      apiFetch('/api/folders', { method: 'POST', body: vars, schema: CreateFolderResponseSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['folders'] }),
  })
}

export function useUpdateFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; patch: z.infer<typeof UpdateFolderRequestSchema> }) =>
      apiFetch(`/api/folders/${vars.id}`, {
        method: 'PATCH',
        body: vars.patch,
        schema: OkSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['folders'] }),
  })
}

export function useDeleteFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      apiFetch(`/api/folders/${id}`, { method: 'DELETE', schema: OkSchema }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['folders'] })
      qc.invalidateQueries({ queryKey: ['scenes'] })
    },
  })
}
```

- [ ] **Step 2: `apps/web/src/api/scenes.ts`**

```tsx
import {
  CreateSceneRequestSchema,
  ExcalidrawSceneDataSchema,
  SceneSchema,
  UpdateSceneRequestSchema,
} from '@excalimore/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { apiFetch } from './client'

const ListItemSchema = SceneSchema.omit({ data: true }).extend({
  permission: z.enum(['view', 'edit']).optional(),
})
const ListResponseSchema = z.object({ scenes: z.array(ListItemSchema) })
const SceneDetailSchema = z.object({
  scene: SceneSchema,
  role: z.enum(['owner', 'edit', 'view']).optional(),
})
const CreateResponseSchema = z.object({ scene: SceneSchema })
const OkSchema = z.object({ ok: z.boolean() })

export type SceneListItem = z.infer<typeof ListItemSchema>

export function useScenes(opts: { folderId?: string | null; shared?: boolean } = {}) {
  const params = new URLSearchParams()
  if (opts.folderId) params.set('folder_id', opts.folderId)
  if (opts.shared) params.set('shared', 'true')
  const query = params.toString()
  return useQuery({
    queryKey: ['scenes', opts] as const,
    queryFn: async () => {
      const data = await apiFetch(`/api/scenes${query ? `?${query}` : ''}`, {
        schema: ListResponseSchema,
      })
      return data.scenes
    },
  })
}

export function useScene(id: string | undefined) {
  return useQuery({
    queryKey: ['scene', id] as const,
    enabled: Boolean(id),
    queryFn: async () => apiFetch(`/api/scenes/${id}`, { schema: SceneDetailSchema }),
  })
}

export function useCreateScene() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: z.infer<typeof CreateSceneRequestSchema>) =>
      apiFetch('/api/scenes', { method: 'POST', body: vars, schema: CreateResponseSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scenes'] }),
  })
}

export function useSaveScene(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: z.infer<typeof ExcalidrawSceneDataSchema>) =>
      apiFetch(`/api/scenes/${id}`, {
        method: 'PATCH',
        body: { data } satisfies z.infer<typeof UpdateSceneRequestSchema>,
        schema: OkSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scene', id] }),
  })
}

export function useDeleteScene() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      apiFetch(`/api/scenes/${id}`, { method: 'DELETE', schema: OkSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scenes'] }),
  })
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @excalimore/web typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/folders.ts apps/web/src/api/scenes.ts
git commit -m "feat(web): add folders and scenes hooks (list, create, update, delete, save)"
```

---

### Task 9: Authed layout + scene grid (home)

**Files:**
- Create: `apps/web/src/routes/_authed.tsx`
- Create: `apps/web/src/routes/_authed.index.tsx`
- Create: `apps/web/src/routes/-components/FolderSidebar.tsx`
- Create: `apps/web/src/routes/-components/SceneCard.tsx`
- Create: `apps/web/src/routes/-components/NewSceneButton.tsx`
- Create: `apps/web/src/styles/app.css`
- Modify: `apps/web/src/main.tsx` — switch to importing `app.css`
- Delete: `apps/web/src/routes/index.tsx` (replaced by `_authed.index.tsx`)

The `_authed` segment in TanStack Router file-routing creates a layout that wraps all routes under it; we use it to gate access (redirect to `/login` if `useMe` returns null).

- [ ] **Step 1: Create `apps/web/src/routes/_authed.tsx`**

```tsx
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useLogout, useMe } from '../api/auth'
import { FolderSidebar } from './-components/FolderSidebar'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ location }) => {
    // Lightweight gate: if /api/auth/me 401s, send to /login.
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' })
      if (res.status === 401) {
        throw redirect({ to: '/login', search: { redirect: location.href } as never })
      }
    } catch (err) {
      if (err instanceof Response || (err as { status?: number }).status === 401) {
        throw redirect({ to: '/login' })
      }
    }
  },
  component: AuthedLayout,
})

function AuthedLayout() {
  const me = useMe()
  const logout = useLogout()

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <header className="app-sidebar-header">
          <h2>Excalimore</h2>
          {me.data && (
            <button
              type="button"
              onClick={() => logout.mutateAsync()}
              className="app-link-button"
              disabled={logout.isPending}
            >
              {me.data.name} · sign out
            </button>
          )}
        </header>
        <FolderSidebar />
      </aside>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Create `apps/web/src/routes/_authed.index.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useScenes } from '../api/scenes'
import { NewSceneButton } from './-components/NewSceneButton'
import { SceneCard } from './-components/SceneCard'

export const Route = createFileRoute('/_authed/')({
  component: HomePage,
})

function HomePage() {
  const own = useScenes({})
  const shared = useScenes({ shared: true })

  return (
    <section className="app-page">
      <header className="app-page-header">
        <h1>Your scenes</h1>
        <NewSceneButton />
      </header>
      {own.isLoading ? (
        <p className="muted">Loading…</p>
      ) : (own.data?.length ?? 0) === 0 ? (
        <p className="muted">No scenes yet — click "New scene" to start.</p>
      ) : (
        <div className="scene-grid">{own.data!.map((s) => <SceneCard key={s.id} scene={s} />)}</div>
      )}

      {shared.data && shared.data.length > 0 && (
        <>
          <h2 style={{ marginTop: '2rem' }}>Shared with you</h2>
          <div className="scene-grid">
            {shared.data.map((s) => <SceneCard key={s.id} scene={s} />)}
          </div>
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Create components**

`apps/web/src/routes/-components/FolderSidebar.tsx`:

```tsx
import { useState } from 'react'
import { useCreateFolder, useFolders } from '../../api/folders'

export function FolderSidebar() {
  const folders = useFolders()
  const create = useCreateFolder()
  const [showNew, setShowNew] = useState(false)
  const [name, setName] = useState('')

  if (folders.isLoading) return <p className="muted" style={{ padding: '0 1rem' }}>Loading…</p>

  return (
    <nav className="folder-list">
      <ul>
        {folders.data?.filter((f) => f.parentId === null).map((f) => (
          <li key={f.id}>{f.name}</li>
        ))}
      </ul>
      {!showNew ? (
        <button type="button" onClick={() => setShowNew(true)} className="app-link-button">
          + New folder
        </button>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!name) return
            await create.mutateAsync({ name })
            setName('')
            setShowNew(false)
          }}
          style={{ display: 'flex', gap: '0.25rem' }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus className="folder-input" />
          <button type="submit" className="folder-submit" disabled={create.isPending}>OK</button>
          <button type="button" onClick={() => setShowNew(false)} className="folder-submit">×</button>
        </form>
      )}
    </nav>
  )
}
```

`apps/web/src/routes/-components/SceneCard.tsx`:

```tsx
import { Link } from '@tanstack/react-router'
import type { SceneListItem } from '../../api/scenes'

export function SceneCard({ scene }: { scene: SceneListItem }) {
  return (
    <Link to="/scenes/$id" params={{ id: scene.id }} className="scene-card">
      <div className="scene-card-thumb" />
      <div className="scene-card-body">
        <strong>{scene.name}</strong>
        <small className="muted">
          updated {new Date(scene.updatedAt).toLocaleDateString()}
          {scene.permission && ` · ${scene.permission}`}
        </small>
      </div>
    </Link>
  )
}
```

`apps/web/src/routes/-components/NewSceneButton.tsx`:

```tsx
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useCreateScene } from '../../api/scenes'

export function NewSceneButton() {
  const create = useCreateScene()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className="app-button-primary"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          const res = await create.mutateAsync({ name: 'Untitled scene' })
          navigate({ to: '/scenes/$id', params: { id: res.scene.id } })
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? 'Creating…' : '+ New scene'}
    </button>
  )
}
```

- [ ] **Step 4: Create `apps/web/src/styles/app.css`**

```css
@import 'reset.css';

.app-shell {
  display: grid;
  grid-template-columns: 240px 1fr;
  height: 100vh;
}

.app-sidebar {
  border-right: 1px solid #e5e5e5;
  background: #fafafa;
  overflow-y: auto;
}

.app-sidebar-header {
  padding: 1rem;
  border-bottom: 1px solid #e5e5e5;
}
.app-sidebar-header h2 { margin: 0 0 0.25rem 0; font-size: 1.1em; }

.app-main { overflow-y: auto; }
.app-page { padding: 2rem; }
.app-page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }

.muted { color: #6b6b6b; }

.app-link-button {
  background: none;
  border: none;
  color: #1971c2;
  cursor: pointer;
  font-size: 0.9em;
  padding: 0.25rem 0;
}

.app-button-primary {
  background: #1971c2;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.95em;
}

.folder-list { padding: 0.5rem 1rem; }
.folder-list ul { list-style: none; padding: 0; margin: 0; }
.folder-list li { padding: 0.4rem 0.5rem; cursor: pointer; border-radius: 4px; }
.folder-list li:hover { background: #efefef; }
.folder-input { flex: 1; padding: 0.3rem; border: 1px solid #ccc; border-radius: 4px; font-size: 0.85em; }
.folder-submit { padding: 0.3rem 0.6rem; border: 1px solid #ccc; background: white; border-radius: 4px; cursor: pointer; }

.scene-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1rem;
}
.scene-card {
  display: block;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  background: white;
  text-decoration: none;
  color: inherit;
  overflow: hidden;
  transition: border-color 120ms ease;
}
.scene-card:hover { border-color: #1971c2; }
.scene-card-thumb { aspect-ratio: 16 / 10; background: #f4f4f5; }
.scene-card-body { padding: 0.75rem; }
.scene-card-body strong { display: block; }
.scene-card-body small { display: block; margin-top: 0.25rem; }
```

- [ ] **Step 5: Rename existing styles.css to reset.css**

```bash
mv apps/web/src/styles.css apps/web/src/styles/reset.css
```

(Verify the contents — keep the existing minimal reset.)

- [ ] **Step 6: Update `apps/web/src/main.tsx` import**

Change `import './styles.css'` to `import './styles/app.css'`.

- [ ] **Step 7: Delete old placeholder home route**

```bash
rm apps/web/src/routes/index.tsx
```

The `_authed.index.tsx` now serves `/`.

- [ ] **Step 8: Browser smoke test**

Start API + web, log in, see scene grid (empty), click "+ New scene" → creates scene → navigates to `/scenes/<id>` (still placeholder until Task 10). Click sign out → returns to `/login`.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git rm apps/web/src/routes/index.tsx
git commit -m "feat(web): add authed layout, sidebar, scene grid, new-scene flow"
```

---

### Task 10: Scene editor route

**Files:**
- Create: `apps/web/src/routes/_authed.scenes.$id.tsx`

This task wires up the Excalidraw editor: fetch scene → hydrate editor → debounced save on change.

- [ ] **Step 1: Implement**

```tsx
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawSceneData } from '@excalimore/types'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { useSaveScene, useScene } from '../api/scenes'
import { debounce } from '../lib/debounce'

export const Route = createFileRoute('/_authed/scenes/$id')({
  component: SceneEditorPage,
})

function SceneEditorPage() {
  const { id } = Route.useParams()
  const sceneQ = useScene(id)
  const save = useSaveScene(id)

  const debouncedSave = useMemo(
    () =>
      debounce((data: ExcalidrawSceneData) => {
        save.mutateAsync(data).catch((err) => {
          // Surface failures lightly — full error UX in Phase 5.
          console.error('save failed:', err)
        })
      }, 2000),
    [save],
  )

  const handleChange = useCallback(
    (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      debouncedSave({
        type: 'excalidraw',
        elements: elements as unknown[],
        appState,
        files,
      })
    },
    [debouncedSave],
  )

  if (sceneQ.isLoading) return <p className="muted" style={{ padding: '2rem' }}>Loading scene…</p>
  if (sceneQ.error)
    return (
      <div style={{ padding: '2rem' }}>
        <p>Could not load this scene.</p>
        <Link to="/">← Back to scenes</Link>
      </div>
    )
  if (!sceneQ.data) return null

  const { scene, role } = sceneQ.data
  const canEdit = role === 'owner' || role === 'edit' || role === undefined // owner has no role echoed

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid #e5e5e5',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          background: 'white',
        }}
      >
        <Link to="/" style={{ textDecoration: 'none', color: '#1971c2' }}>← Scenes</Link>
        <strong>{scene.name}</strong>
        {!canEdit && <span className="muted">view-only</span>}
        {save.isPending && <span className="muted">saving…</span>}
      </header>
      <div style={{ flex: 1, position: 'relative' }}>
        <Excalidraw
          initialData={scene.data}
          onChange={canEdit ? (handleChange as never) : undefined}
          viewModeEnabled={!canEdit}
          theme="light"
        />
      </div>
    </div>
  )
}
```

Note: `<Excalidraw />` is a heavy component (~1.5MB gzipped). Vite will code-split automatically since it's only imported in this route. First navigation to a scene will fetch it; subsequent navigations are instant.

- [ ] **Step 2: Browser smoke test**

```bash
cd apps/api && pnpm dev &
cd apps/web && pnpm dev
```

Login → click "+ New scene" → editor loads → draw a rectangle → wait 2 seconds → header shows "saving…" briefly → reload page → drawing persists. Stop servers.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/_authed.scenes.$id.tsx
git commit -m "feat(web): add scene editor route with debounced save"
```

---

### Task 11: README quick start update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update Quick start section in `README.md`**

```markdown
## Quick start (development)

Requires Node 22, pnpm 9, Docker.

```bash
pnpm install
docker compose -f apps/api/docker-compose.dev.yml up -d
cp apps/api/.env.example apps/api/.env
pnpm --filter @excalimore/api db:migrate
pnpm dev
```

Then open `http://localhost:5173`. On first run the API logs a bootstrap URL like
`http://localhost:5173/signup?bootstrap=<token>` — open it in your browser to
create the admin user. Subsequent users join via invite links generated from
the API.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: refresh quick start with Phase 4 web flow"
```

---

### Task 12: Web tests pass + final pipeline check

**Files:**
- (verification only)

- [ ] **Step 1: Full pipeline**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected:
- lint: clean across all packages
- typecheck: clean
- test: all api tests pass plus the new web unit tests (~6 from Task 2 + 3 from Task 3 = 9 web tests)

- [ ] **Step 2: Commit any necessary lint/format fixes**

If anything needs fixing, run `pnpm exec biome check --write .` and commit:

```bash
git add -A
git commit -m "chore: lint cleanup for Phase 4"
```

---

## Phase 4 Done Criteria

Tick when **all** of the following are true:

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass.
- [ ] From a fresh DB, the bootstrap URL flow works end-to-end in the browser: visit `/signup?bootstrap=…` → create admin → land on `/` → create new scene → editor loads.
- [ ] Drawing in the scene editor and waiting 2s persists changes (verified by reload).
- [ ] Sign-out returns to `/login`; visiting `/` while signed-out redirects to `/login`.
- [ ] CI green on the Phase 4 PR.

When all checked: open Phase 5 plan-writing session for the comment overlay.
