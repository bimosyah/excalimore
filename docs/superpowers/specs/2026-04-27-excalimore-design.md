# Excalimore — Design Spec

**Date:** 2026-04-27
**Status:** Draft (pre-implementation)
**Repo:** `github.com/bimosyah/excalimore`
**License:** MIT

## 1. Goal

Self-hostable application that wraps the open-source `@excalidraw/excalidraw` editor and adds three feature gaps the proprietary Excalidraw+ tier covers:

- **Unlimited scenes** organized in nested folders
- **Anchored comments** pinned to canvas elements
- **Account-based access** with invite-only signup

Excalimore must remain a *layer* on top of upstream Excalidraw, not a fork. The editor package is consumed unchanged so that follow-on upstream releases can be adopted by bumping the dependency.

## 2. Non-Goals

- Not a fork of `excalidraw/excalidraw`. The editor is consumed as a published npm package only.
- Not feature-parity with Excalidraw+. We deliberately omit: voice/screen sharing, live presentations, multi-cursor real-time collab, AI features, team/workspace management.
- Not multi-tenant in MVP. One deployed instance == one owner with invited collaborators.
- Not horizontally scalable in MVP. Single backend instance is assumed (in-memory presence tracking, single Postgres).

## 3. Scope (locked decisions from brainstorm)

| # | Decision | Choice |
|---|---|---|
| 1 | User scope | **Personal + invited** — owner is admin, others arrive via invite link, no self-signup |
| 2 | Comment scope | **Anchored to canvas elements** for MVP; board-level threads deferred |
| 3 | Sharing model | **Account-based** — invitee creates account via invite token, then has identity for comments |
| 4 | Real-time scope | **Async only** — REST + SSE for comment notifications, no live multi-cursor edit |
| 5 | Tech stack | **Monorepo** (pnpm workspaces + Turborepo): `apps/web` (Vite + React), `apps/api` (Hono), `packages/types` (TypeScript + Zod) |
| 6a | Project name | **Excalimore** |
| 6b | License | **MIT** |
| 6c | Repo split | OSS repo at `github.com/bimosyah/excalimore` (monorepo); deployer-specific infra (e.g. `~/Work/bimosyahputro.com/infra/excalimore/`) lives outside the OSS repo |

## 4. Architecture overview

```
                ┌─────────────────────────────────────┐
                │      Browser (one tab per scene)    │
                │                                     │
                │  ┌──────────────┐  ┌─────────────┐  │
                │  │ <Excalidraw  │  │ Comment     │  │
                │  │   />         │  │ Overlay     │  │
                │  │  (editor)    │  │ Layer       │  │
                │  └──────┬───────┘  └──────┬──────┘  │
                │         │  excalidrawAPI  │         │
                │         └────────┬────────┘         │
                │                  ▼                  │
                │      Sync & State Manager           │
                │      (debounce, fetch, SSE client)  │
                └──────────────┬──────────────────────┘
                               │ HTTPS (REST + SSE)
                ┌──────────────▼──────────────────────┐
                │       Caddy (reverse proxy)         │
                │   excalimore.<deployer-domain>      │
                └──────────────┬──────────────────────┘
                               │
                ┌──────────────▼──────────────────────┐
                │      Hono API (apps/api)            │
                │   /auth · /scenes · /folders ·      │
                │   /comments · /events (SSE)         │
                │   middleware: session · CSRF · RL   │
                └──────────────┬──────────────────────┘
                               │
                ┌──────────────▼──────────────────────┐
                │           Postgres                  │
                │   users · scenes · folders ·        │
                │   comments · share_grants ·         │
                │   invite_tokens · sessions ·        │
                │   bootstrap_tokens                  │
                └─────────────────────────────────────┘
```

### Architectural approach: server-authoritative, REST-first

- Server is single source of truth for scenes and comments.
- Browser fetches scene JSON when opening a route, hydrates `<Excalidraw />`, and pushes changes back as debounced PATCH (2s of inactivity).
- Anchored comments render as a sibling React layer above the canvas, reading `excalidrawAPI` viewport state to position pins. Comments do **not** live inside the Excalidraw scene JSON; they are stored in a separate table.
- Live comment delivery uses Server-Sent Events on a per-scene channel.

### Three monorepo packages

| Package | Purpose |
|---|---|
| `apps/web` | Vite + React + TanStack Router SPA. Imports `@excalidraw/excalidraw`. Builds to static files served by Caddy (in front-end image) plus reverse-proxy to the API. |
| `apps/api` | Hono backend on Node 22 (Bun is acceptable but not required). Drizzle ORM → Postgres. Hand-rolled auth module. |
| `packages/types` | Shared TypeScript types and Zod schemas (`Scene`, `Folder`, `Comment`, `User`, etc.). Single source of truth for FE↔BE contracts. |

## 5. Data model

Postgres schema. All tables have `id uuid` PK (default `gen_random_uuid()`), `created_at timestamptz` (default `now()`); `updated_at timestamptz` where mutation is expected.

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `email` | text UNIQUE NOT NULL | |
| `name` | text NOT NULL | |
| `password_hash` | text NOT NULL | argon2id |
| `role` | text NOT NULL DEFAULT 'user' | `'user'` or `'admin'` |
| `created_at` | timestamptz | |

### `folders`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid FK → users.id | |
| `parent_id` | uuid FK → folders.id NULLABLE | self-ref; NULL = root |
| `name` | text NOT NULL | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

App-level constraint: nesting depth capped at 5 to avoid recursion bugs.

### `scenes`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid FK → users.id NOT NULL | |
| `folder_id` | uuid FK → folders.id NULLABLE | NULL = root |
| `name` | text NOT NULL | |
| `data` | jsonb NOT NULL | Excalidraw scene JSON: `{ type, version, source, elements, appState, files }` |
| `thumbnail_url` | text NULLABLE | optional rendered preview path |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

`data` matches the native `.excalidraw` file format so import/export is direct copy.

### `comments`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `scene_id` | uuid FK → scenes.id NOT NULL | |
| `author_id` | uuid FK → users.id NOT NULL | |
| `element_id` | text NOT NULL | id of element from Excalidraw scene |
| `x_offset` | int NOT NULL DEFAULT 0 | px offset within element |
| `y_offset` | int NOT NULL DEFAULT 0 | px offset within element |
| `last_known_x` | float | scene-space x of element when comment was made (for orphan rendering) |
| `last_known_y` | float | scene-space y of element when comment was made |
| `body` | text NOT NULL | |
| `resolved` | bool NOT NULL DEFAULT false | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Orphan handling: if `element_id` no longer exists in scene `data` at render time, render at `(last_known_x, last_known_y)` with a "deleted element" badge.

### `share_grants`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `scene_id` | uuid FK → scenes.id NOT NULL | |
| `user_id` | uuid FK → users.id NOT NULL | |
| `permission` | text NOT NULL | `'view'` or `'edit'` |
| `granted_by` | uuid FK → users.id NOT NULL | |
| `created_at` | timestamptz | |

UNIQUE (`scene_id`, `user_id`).

### `invite_tokens`

| Column | Type | Notes |
|---|---|---|
| `token` | text PK | random 32-byte URL-safe |
| `scene_id` | uuid FK → scenes.id NULLABLE | optional pre-grant |
| `permission` | text NULLABLE | required iff `scene_id IS NOT NULL` |
| `created_by` | uuid FK → users.id NOT NULL | |
| `expires_at` | timestamptz NOT NULL | |
| `used_by` | uuid FK → users.id NULLABLE | |
| `used_at` | timestamptz NULLABLE | |
| `created_at` | timestamptz | |

Single-use: when consumed, `used_by` and `used_at` are set; further attempts rejected.

### `sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | random 32-byte URL-safe (matches cookie value) |
| `user_id` | uuid FK → users.id NOT NULL | |
| `expires_at` | timestamptz NOT NULL | |
| `created_at` | timestamptz | |

DB-backed (not JWT) for revocability.

### `bootstrap_tokens`

| Column | Type | Notes |
|---|---|---|
| `token` | text PK | random 32-byte URL-safe |
| `expires_at` | timestamptz NOT NULL | |
| `used_at` | timestamptz NULLABLE | |

Used only on first run when `users` is empty (see §8 Auth).

### Out of MVP

- Folder sharing (only scenes shareable in MVP)
- Comment threads (replies)
- Comment mentions
- Scene version history
- Audit log

## 6. API surface

All endpoints under `/api`. Cookie session auth. JSON request/response. Zod validation at the boundary.

### Auth — `/api/auth`

| Method | Path | Body / Query | Auth |
|---|---|---|---|
| POST | `/auth/signup` | `{ token, email, password, name }` | invite or bootstrap token |
| POST | `/auth/login` | `{ email, password }` | — |
| POST | `/auth/logout` | — | session |
| GET | `/auth/me` | — | session |
| POST | `/auth/invite` | `{ scene_id?, permission?, expires_at? }` → `{ token, url }` | session (admin) |

### Folders — `/api/folders`

| Method | Path | Body / Query | Auth |
|---|---|---|---|
| GET | `/folders` | — (returns full tree for owner) | owner |
| POST | `/folders` | `{ name, parent_id? }` | owner |
| PATCH | `/folders/:id` | `{ name?, parent_id? }` | owner |
| DELETE | `/folders/:id` | `?cascade=true` | owner |

### Scenes — `/api/scenes`

| Method | Path | Body / Query | Auth |
|---|---|---|---|
| GET | `/scenes` | `?folder_id=&shared=true` | session |
| POST | `/scenes` | `{ name, folder_id? }` | owner |
| GET | `/scenes/:id` | — (returns full scene incl. `data`) | view |
| PATCH | `/scenes/:id` | `{ name?, folder_id?, data? }` | edit (data) / owner (folder_id) |
| DELETE | `/scenes/:id` | — | owner |
| GET | `/scenes/:id/grants` | — | owner |
| POST | `/scenes/:id/grants` | `{ user_id, permission }` | owner |
| DELETE | `/scenes/:id/grants/:gid` | — | owner |

### Comments — `/api/scenes/:id/comments` & `/api/comments`

| Method | Path | Body / Query | Auth |
|---|---|---|---|
| GET | `/scenes/:id/comments` | `?include_resolved=false` | view |
| POST | `/scenes/:id/comments` | `{ element_id, x_offset, y_offset, body, last_known_x, last_known_y }` | view |
| PATCH | `/comments/:id` | `{ body?, resolved? }` | author or owner |
| DELETE | `/comments/:id` | — | author or owner |

### Events (SSE) — `/api/events`

| Method | Path | Stream events | Auth |
|---|---|---|---|
| GET | `/events?scene_id=:id` | `comment.created`, `comment.updated`, `comment.resolved`, `scene.updated` | view |

### Access control rules

The `Auth` column in the route tables above shows the **minimum** level required. Higher roles inherit lower:

```
admin  ⊇  owner  ⊇  edit  ⊇  view  ⊇  session
```

| Role | Capabilities |
|---|---|
| `owner` | All operations on their own scenes/folders. Implicitly counts as `edit` and `view` on those scenes. |
| `edit` | Has `share_grants.permission='edit'`. Read scene data, save scene data, create/edit/delete own comments. |
| `view` | Has `share_grants.permission='view'`. Read scene data, read comments, **create** own comments. Cannot save scene data, cannot edit/delete others' comments. |
| `session` | Authenticated user (any role). |
| `admin` | `users.role='admin'`. Generate invites. Bootstrap-created. |

`view` users can author comments deliberately — feedback is the primary reason a viewer opens a shared scene.

## 7. Comment overlay mechanism

### Component layout

```
<SceneEditor>
  <Excalidraw ref={apiRef} onChange={handleChange} ... />
  <CommentOverlay apiRef={apiRef}>      // absolute, pointer-events: none
    <CommentPin />*                      // pointer-events: auto on pin
    <CommentComposer />?                 // when adding/editing
    <OffscreenIndicators />              // edge markers for off-viewport pins
  </CommentOverlay>
  <CommentSidebar>                       // resizable side panel
    <CommentList />
    <CommentFilters />
  </CommentSidebar>
</SceneEditor>
```

`CommentOverlay` is a sibling of `<Excalidraw />`, **not** a child. It does not modify the editor.

### Coordinate transformation

Excalidraw exposes viewport state via `excalidrawAPI.getAppState()`:

```ts
const { scrollX, scrollY, zoom } = api.getAppState()
const element = api.getSceneElements().find(e => e.id === comment.element_id)

// scene-space anchor point
const sceneX = element.x + comment.x_offset
const sceneY = element.y + comment.y_offset

// screen-space (CSS pixels relative to canvas container)
const screenX = (sceneX + scrollX) * zoom.value
const screenY = (sceneY + scrollY) * zoom.value
```

Note: `scrollX/scrollY` in Excalidraw are an offset (not a DOM scroll position); positive values move scene content right/down.

### Re-render triggers

`CommentOverlay` subscribes to `<Excalidraw onChange={...} />`. The callback fires on viewport changes (zoom/pan) as well as element changes. On each callback, recompute pin positions for visible comments.

### UI states (add-comment flow)

```
[idle]
  ─── click "+ Comment" ──────────► [pick-element]
[pick-element]
  ─── hover element ──────────────► (highlight border)
  ─── click element ──────────────► [composing]  (input popover at click pos)
  ─── Esc ────────────────────────► [idle]
[composing]
  ─── submit ─► POST /api/scenes/:id/comments ─► [idle]  (pin renders)
  ─── Esc / blur ─────────────────► [idle]
```

### Edge cases

| Case | Behavior |
|---|---|
| Element deleted | Render pin at `(last_known_x, last_known_y)` with red ⚠️ badge. Sidebar entry shows "(deleted element)" caption. Comment can be resolved/deleted normally. |
| Pin off-viewport | Render edge indicator (counter chip) on the side facing the pin. Click pans canvas to pin. |
| Overlapping pins | Cluster: single badge with count. Click expands to a vertical stack of mini-pins. |
| Extreme zoom | Pin display size clamped (min 16px, max 32px). Hit-target stays accurate to scene-space. |

### Real-time sync

When the editor opens a scene:

1. `GET /api/scenes/:id/comments` → seed local comment state.
2. `EventSource('/api/events?scene_id=:id')` → subscribe to per-scene channel.
3. On `comment.created`/`comment.updated`/`comment.resolved`: update local state, re-render pins.
4. Local mutations are optimistic: render pin immediately, POST in the background, reconcile id/timestamp on response.

### Why comments are not part of `scenes.data`

Storing comments in a separate table (rather than inside the JSONB scene) means:

- Saving the scene cannot accidentally lose comments.
- Permission boundaries are independent: a `view` user can write a comment without touching scene data.
- Comments survive scene rollbacks (when scene history is added later).

## 8. Auth (roll your own)

Rationale: minimal dependencies, OSS longevity, and a tight MVP scope (no OAuth/2FA initially) make a hand-rolled auth module a deliberate choice. The only auth-adjacent dependency is `argon2`, because rolling your own password hash is not safe.

### Module layout — `apps/api/src/auth/`

```
auth/
├── password.ts          # argon2id wrapper (hash, verify)
├── session.ts           # createSession, getSession, invalidateSession
├── cookie.ts            # setSessionCookie, clearSessionCookie
├── csrf.ts              # double-submit cookie pattern
├── rate-limit.ts        # in-memory token bucket per-IP & per-user
├── invite.ts            # generateInviteToken, consumeInviteToken
├── bootstrap.ts         # detectFirstRun, generateBootstrapToken
├── middleware.ts        # session, csrf, rate-limit (Hono middleware)
└── routes.ts            # /auth/* handlers
```

Estimated total: ~350–450 lines. Each file has one responsibility.

### Password handling

- `argon2id` only. Time cost / memory cost / parallelism use the OWASP recommended defaults (m=19456, t=2, p=1) at MVP; these are tunable.
- All non-password secret comparisons (invite/bootstrap tokens, session ids) use `crypto.timingSafeEqual` to avoid timing leaks.

### Sessions

- 32-byte random token (URL-safe base64) generated by `crypto.randomBytes`.
- Stored in `sessions` table (id = token, user_id, expires_at).
- Cookie: `Set-Cookie: session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<SESSION_MAX_AGE>`.
- **Session id rotates on login** (old session invalidated, new one issued) — guards against fixation.
- Logout deletes the row and clears the cookie.

### CSRF

Double-submit cookie pattern:

- A `csrf` cookie holds a random token (HttpOnly **off** so client JS can read it).
- Mutating requests must echo the token in an `X-CSRF-Token` header.
- Server compares cookie ↔ header with `timingSafeEqual`.

`SameSite=Lax` cookies plus this header check effectively defend against CSRF.

### Rate limiting

Token bucket per (IP, route-group). Defaults:

| Route group | Limit |
|---|---|
| `/api/auth/login` | 5 / minute / IP |
| `/api/auth/signup` | 5 / minute / IP |
| Other authenticated | 60 / minute / user |

In-memory; single-instance assumption holds for MVP.

### Bootstrap (first-run admin)

On API startup:

```ts
if (await db.query('SELECT count(*) FROM users') === 0) {
  const token = crypto.randomBytes(32).toString('base64url')
  await db.insert('bootstrap_tokens', { token, expires_at: now + BOOTSTRAP_TOKEN_TTL })
  console.log(`No users found. Bootstrap admin via:\n  ${PUBLIC_URL}/signup?bootstrap=${token}\n  (valid for ${BOOTSTRAP_TOKEN_TTL})`)
}
```

`/api/auth/signup` accepts either `{ token }` (regular invite) or `{ bootstrap }`. The bootstrap branch sets `users.role='admin'` and is rejected if any user already exists (defense-in-depth even if the token leaks).

### Invite flow

1. Owner calls `POST /api/auth/invite` with optional `scene_id`/`permission`. Server creates `invite_tokens` row, returns `{ token, url }` where url is `${PUBLIC_URL}/signup?token=${token}`.
2. Owner shares URL via any channel (Telegram, WA, email — out of scope for the app).
3. Invitee opens URL → form (email, password, name).
4. `POST /api/auth/signup { token, email, password, name }`:
   - validate token (not expired, not used)
   - create user
   - if token has `scene_id`, create matching `share_grants` row
   - mark token used
   - issue session, set cookie
   - response includes `redirect_to` (the shared scene if pre-granted, else `/`)

### Out of MVP

- Forgot-password (no email infra). Workaround: admin resets via DB / future CLI.
- Email verification (invite link is implicit verification).
- OAuth/OIDC providers.
- 2FA / TOTP / passkeys.
- Logout-all-devices.
- Self-serve password change UI (CLI for now).

## 9. Deployment

### Repo split

```
github.com/bimosyah/excalimore  (OSS, MIT)
├── apps/web/                       Vite + React SPA
│   ├── src/
│   ├── Dockerfile                  multi-stage → static + Caddy
│   └── package.json
├── apps/api/                       Hono backend
│   ├── src/
│   ├── drizzle/                    SQL migrations
│   ├── Dockerfile
│   └── package.json
├── packages/types/                 shared TS + Zod
├── deploy/example/
│   ├── docker-compose.yml          generic example
│   ├── .env.example
│   └── README.md
├── docs/                           architecture, contributing, …
├── .github/workflows/
│   ├── ci.yml
│   └── release.yml
├── turbo.json
├── pnpm-workspace.yaml
├── LICENSE                         MIT
└── README.md

[deployer-private path, e.g. ~/Work/bimosyahputro.com/infra/excalimore/]
├── docker-compose.yml              points at ghcr.io/bimosyah/excalimore-{web,api}
├── .env.example
├── .env                            (gitignored)
└── deploy.sh                       rsync + ssh + docker compose up -d
```

### Path-based routing (one subdomain)

Caddy routes `/api/*` and `/events*` to the API container; everything else to the web container. Result: same origin for FE and API, no CORS, single TLS cert, session cookie scoped naturally.

```
excalimore.bimosyahputro.com {
    @api path /api/* /events*
    handle @api {
        reverse_proxy 127.0.0.1:6701
    }
    handle {
        reverse_proxy 127.0.0.1:6700
    }
}
```

Trade-off: `apps/api` must be served under a `/api` prefix. Documented in `deploy/example/README.md`.

### Containers

Three services in deployer compose:

```yaml
services:
  excalimore-web:
    image: ghcr.io/bimosyah/excalimore-web:${TAG:-latest}
    restart: unless-stopped
    ports: ["127.0.0.1:6700:80"]
    depends_on: [excalimore-api]

  excalimore-api:
    image: ghcr.io/bimosyah/excalimore-api:${TAG:-latest}
    restart: unless-stopped
    ports: ["127.0.0.1:6701:3000"]
    environment:
      DATABASE_URL: ${DATABASE_URL}
      SESSION_SECRET: ${SESSION_SECRET}
      PUBLIC_URL: ${PUBLIC_URL}
    depends_on: [excalimore-db]

  excalimore-db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: excalimore
      POSTGRES_USER: excalimore
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - ./pgdata:/var/lib/postgresql/data
```

### Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | full Postgres URL |
| `SESSION_SECRET` | yes | — | 32+ random bytes |
| `PUBLIC_URL` | yes | — | e.g. `https://excalimore.example.com` |
| `PORT` | no | 3000 | API port |
| `RATE_LIMIT_LOGIN` | no | 5/min | |
| `SESSION_MAX_AGE` | no | 30d | |
| `BOOTSTRAP_TOKEN_TTL` | no | 1h | |

### CI/CD

`.github/workflows/ci.yml` (PR + push):

- Install via pnpm
- `turbo lint type-check test`
- Integration tests use `testcontainers` to spin Postgres
- All packages compile without warnings

`.github/workflows/release.yml` (tag push `v*`):

- Build `excalimore-web` and `excalimore-api` images via `docker buildx`
- Push to `ghcr.io/bimosyah/excalimore-{web,api}:<tag>` and `:latest`
- Generate release notes from commit log

### Migrations

Drizzle migrations bundled into the API image. On container start, `apps/api/dist/migrate.js` runs idempotently before the HTTP server binds.

### Deployer workflow (Bimo's own)

`~/Work/bimosyahputro.com/infra/excalimore/deploy.sh`:

```sh
#!/usr/bin/env bash
set -eu
SERVER=hetzner-1
rsync -av --exclude=pgdata docker-compose.yml .env "$SERVER:/srv/excalimore/"
ssh "$SERVER" "cd /srv/excalimore && docker compose pull && docker compose up -d"
```

Caddy entry added to existing `~/Work/bimosyahputro.com/infra/Caddyfile` and pushed via existing process.

## 10. Testing strategy

| Layer | Tool | Scope |
|---|---|---|
| Type-checking | `tsc --noEmit` per package | All packages, including `packages/types` shared schemas |
| Unit | `vitest` | Pure functions: coordinate transforms, password hashing wrapper, rate-limit logic, invite token validation |
| Integration | `vitest` + `testcontainers` | API endpoints against real Postgres, including auth flows, share-grant enforcement, comment lifecycle |
| E2E | `playwright` (deferred from MVP) | Browser tests of editor + comments. Optional in MVP — consider in v0.2. |

Integration tests cover the critical paths: bootstrap, invite, signup, share, scene save, comment CRUD, SSE delivery.

## 11. Out of scope (deferred)

These were explicitly considered and pushed to post-MVP:

- Board-level comment threads (alongside anchored)
- Comment replies / mentions / email notification
- Folder sharing
- Scene version history
- Audit log
- Real-time multi-cursor collaboration
- Forgot-password flow (requires SMTP)
- Email verification
- OAuth / OIDC providers
- 2FA / TOTP / passkeys
- Public signup mode
- Multi-instance scaling (Redis pub/sub for SSE)
- E2E browser tests
- Self-serve password change UI

Each is additive: the chosen architecture admits them without redesign.

## 12. Open questions

None blocking. Items to revisit during implementation:

- Argon2id parameters: start with OWASP defaults; benchmark on target Hetzner box and tune if first-login latency exceeds 250ms.
- SSE reconnection strategy: rely on browser native `EventSource` reconnect; document that brief gap may miss events — clients refetch comment list on reconnect.
- Drizzle vs. Kysely for the ORM: Drizzle picked for migration ergonomics; revisit if it gets in the way.
