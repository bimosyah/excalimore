# Excalimore Implementation Plan — Phase 6: Production Deployment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Phase 1–5 monorepo as production-ready container images, with a generic OSS deploy example, a private Hetzner deploy script for `excalimore.bimosyahputro.com`, and a tag-driven release workflow that publishes to ghcr.io.

**Architecture:** Two services (`excalimore-web`, `excalimore-api`) plus Postgres. Web is built with Vite and served by nginx-alpine; API is built with `tsc` (emit JS to `dist/`) and run as Node 22 alpine. Caddy in front does path-based routing under one subdomain — `/api/*` and `/events*` to the API container, everything else to the web container. Migrations run as part of the API container's entrypoint before the HTTP server binds.

**Tech Stack:** Docker (multi-stage), pnpm 9, Node 22 alpine, nginx alpine, GitHub Actions (`docker/build-push-action`, `docker/login-action`), ghcr.io, Caddy, rsync/ssh.

**Spec reference:** [`../specs/2026-04-27-excalimore-design.md`](../specs/2026-04-27-excalimore-design.md) §9 (Deployment).

---

## Phase Overview

| Phase | Output |
|---|---|
| 1. Foundation | Done. Monorepo runs, schema migrated, CI green. |
| 2. Auth | Done. `auth/` module + integration tests. |
| 3. Core API | Done. `/api/folders`, `/api/scenes`, `/api/comments`, `/api/events`. |
| 4. Frontend MVP | Done. Login/signup/scene routes wired up. |
| 5. Comment overlay | In progress (parallel branch). |
| **6. Deployment** ← this plan | Multi-stage Dockerfiles, ghcr.io release workflow, `deploy/example/`, deploy script + Caddy entry for `bimosyahputro.com` infra, smoke-test playbook. |

---

## Phase 6 File Structure

After Phase 6, the repo will have added:

```
excalimore/
├── apps/
│   ├── api/
│   │   ├── Dockerfile                       # NEW — multi-stage Node 22 alpine
│   │   ├── .dockerignore                    # NEW
│   │   └── package.json                     # MODIFY — build now emits JS
│   └── web/
│       ├── Dockerfile                       # NEW — Vite build → nginx alpine
│       ├── nginx.conf                       # NEW — SPA fallback + gzip
│       └── .dockerignore                    # NEW
├── deploy/
│   └── example/                             # NEW — generic OSS example
│       ├── docker-compose.yml
│       ├── .env.example
│       └── README.md
├── .github/
│   └── workflows/
│       └── release.yml                      # NEW — tag-driven ghcr publish
└── docs/
    └── superpowers/
        └── plans/
            └── 2026-04-27-excalimore-phase-6-deploy.md   # this file

# Outside the OSS repo (Bimo's private infra):
~/Work/bimosyahputro.com/infra/excalimore/
├── docker-compose.yml                       # NEW — local-bound to 127.0.0.1:6700/6701
├── .env.example                             # NEW
└── deploy.sh                                # NEW — rsync + ssh, mirrors deploy-n8n.sh
```

---

## Tasks

### Task 1: Make `apps/api` emit JS for production

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/tsconfig.json`

**Why:** the current API `build` script is `tsc --noEmit` and `tsconfig.json` sets `noEmit: true`. We need a real `dist/` for the runtime image. We'll keep dev (`tsx watch`) and tests (`vitest` + `tsx`) untouched so they continue to use ts source directly.

- [ ] **Step 1: Add a separate build tsconfig**

Create `apps/api/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": false,
    "declarationMap": false,
    "sourceMap": false,
    "tsBuildInfoFile": null
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests", "**/*.test.ts"]
}
```

- [ ] **Step 2: Update `apps/api/package.json` `scripts`**

```json
"build": "tsc -p tsconfig.build.json",
"start": "node dist/index.js",
"start:migrate": "node dist/db/migrate.js",
"typecheck": "tsc --noEmit"
```

Keep `dev` (`tsx watch`) and `db:migrate` (`tsx`) as-is so dev workflows are unchanged.

- [ ] **Step 3: Sanity-check the build**

```bash
pnpm --filter @excalimore/api build
ls apps/api/dist/index.js apps/api/dist/db/migrate.js
```

Expected: both files exist.

- [ ] **Step 4: Run typecheck + tests**

```bash
pnpm typecheck
pnpm --filter @excalimore/api test
```

Tests use `tsx` directly (vitest config) so they're unaffected; they must still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json apps/api/tsconfig.build.json
git commit -m "feat(api): emit JS to dist/ for production builds"
```

---

### Task 2: API `.dockerignore`

**Files:**
- Create: `apps/api/.dockerignore`

- [ ] **Step 1: Write `.dockerignore`**

```
node_modules
dist
.turbo
.env
.env.*
tests
*.test.ts
coverage
docker-compose.dev.yml
Dockerfile
.dockerignore
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/.dockerignore
git commit -m "chore(api): add .dockerignore"
```

---

### Task 3: API multi-stage Dockerfile

**Files:**
- Create: `apps/api/Dockerfile`

Strategy: build the whole monorepo from the repo root in the build stage so workspace deps (`@excalimore/types`) resolve cleanly. The Dockerfile lives in `apps/api/` but expects build context = repo root.

- [ ] **Step 1: Write `apps/api/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22-alpine

# ---- deps stage: install full workspace deps ----
FROM node:${NODE_VERSION} AS deps
WORKDIR /repo
RUN apk add --no-cache python3 make g++ libc6-compat
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build stage: compile TS to dist ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY apps/api apps/api
RUN pnpm --filter @excalimore/api build

# ---- prod-deps stage: prune to runtime deps only ----
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /repo
RUN apk add --no-cache python3 make g++ libc6-compat
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @excalimore/api...

# ---- runtime stage ----
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

# Copy pruned node_modules. pnpm hoists workspace deps into the app's node_modules.
COPY --from=prod-deps /repo/node_modules /app/node_modules
COPY --from=prod-deps /repo/apps/api/node_modules /app/node_modules
COPY --from=build /repo/apps/api/dist /app/dist
COPY --from=build /repo/apps/api/drizzle /app/drizzle
COPY --from=build /repo/apps/api/package.json /app/package.json

# Migrate then start. argon2 is a native module, hence the build deps in deps/prod-deps.
EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
```

Notes:
- `argon2` is a native addon — `python3/make/g++` are required at install time on alpine.
- `prod-deps` re-installs from the lockfile with `--prod --filter @excalimore/api...` (the trailing `...` includes workspace deps).
- We could split migration into a separate compose service, but the spec says "runs the migration once on start, then the API server". A `sh -c` chain is the simplest correct shape.

- [ ] **Step 2: Verify locally**

```bash
docker buildx build -f apps/api/Dockerfile -t excalimore-api:dev --load .
docker images excalimore-api:dev
```

Expected: image builds, size roughly 200–300 MB. Note the size for the PR.

- [ ] **Step 3: Commit**

```bash
git add apps/api/Dockerfile
git commit -m "feat(api): multi-stage Dockerfile (build + prune + runtime)"
```

---

### Task 4: Web `.dockerignore` and nginx config

**Files:**
- Create: `apps/web/.dockerignore`
- Create: `apps/web/nginx.conf`

- [ ] **Step 1: `apps/web/.dockerignore`**

```
node_modules
dist
.turbo
.env
.env.*
tests
e2e
playwright-report
test-results
playwright/.cache
Dockerfile
.dockerignore
```

- [ ] **Step 2: `apps/web/nginx.conf`**

```nginx
worker_processes auto;
events { worker_connections 1024; }

http {
  include       /etc/nginx/mime.types;
  default_type  application/octet-stream;
  sendfile      on;
  tcp_nopush    on;
  keepalive_timeout 65;
  gzip          on;
  gzip_types    text/plain text/css application/javascript application/json image/svg+xml;
  gzip_min_length 1024;

  server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback — every route returns index.html so client router takes over.
    location / {
      try_files $uri $uri/ /index.html;
    }

    # Long-cache hashed asset bundles.
    location /assets/ {
      expires 1y;
      add_header Cache-Control "public, immutable";
      try_files $uri =404;
    }

    # Health probe used by docker compose / Caddy if ever needed.
    location = /healthz {
      access_log off;
      add_header Content-Type text/plain;
      return 200 "ok\n";
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/.dockerignore apps/web/nginx.conf
git commit -m "chore(web): add .dockerignore and nginx SPA config"
```

---

### Task 5: Web multi-stage Dockerfile

**Files:**
- Create: `apps/web/Dockerfile`

- [ ] **Step 1: Write `apps/web/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22-alpine
ARG NGINX_VERSION=1.27-alpine

# ---- build stage ----
FROM node:${NODE_VERSION} AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY apps/web apps/web
RUN pnpm --filter @excalimore/web build

# ---- runtime stage ----
FROM nginx:${NGINX_VERSION} AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
```

- [ ] **Step 2: Verify locally**

```bash
docker buildx build -f apps/web/Dockerfile -t excalimore-web:dev --load .
docker images excalimore-web:dev
```

Expected: image builds, size roughly 30–80 MB. Record for PR.

- [ ] **Step 3: Commit**

```bash
git add apps/web/Dockerfile
git commit -m "feat(web): multi-stage Dockerfile (Vite build → nginx alpine)"
```

---

### Task 6: GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: read
  packages: write

jobs:
  build-api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/bimosyah/excalimore-api
          tags: |
            type=ref,event=tag
            type=raw,value=latest
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/api/Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha,scope=api
          cache-to: type=gha,mode=max,scope=api

  build-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/bimosyah/excalimore-web
          tags: |
            type=ref,event=tag
            type=raw,value=latest
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/web/Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha,scope=web
          cache-to: type=gha,mode=max,scope=web
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add tag-driven release workflow publishing to ghcr.io"
```

---

### Task 7: Generic `deploy/example/` for OSS users

**Files:**
- Create: `deploy/example/docker-compose.yml`
- Create: `deploy/example/.env.example`
- Create: `deploy/example/README.md`

- [ ] **Step 1: `deploy/example/docker-compose.yml`**

```yaml
services:
  excalimore-web:
    image: ghcr.io/bimosyah/excalimore-web:${TAG:-latest}
    restart: unless-stopped
    ports:
      - "${WEB_PORT:-8080}:80"
    depends_on:
      excalimore-api:
        condition: service_started

  excalimore-api:
    image: ghcr.io/bimosyah/excalimore-api:${TAG:-latest}
    restart: unless-stopped
    ports:
      - "${API_PORT:-8081}:3000"
    environment:
      DATABASE_URL: ${DATABASE_URL}
      SESSION_SECRET: ${SESSION_SECRET}
      PUBLIC_URL: ${PUBLIC_URL}
      RATE_LIMIT_LOGIN: ${RATE_LIMIT_LOGIN:-5}
      SESSION_MAX_AGE: ${SESSION_MAX_AGE:-2592000}
      BOOTSTRAP_TOKEN_TTL: ${BOOTSTRAP_TOKEN_TTL:-3600}
    depends_on:
      excalimore-db:
        condition: service_healthy

  excalimore-db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: excalimore
      POSTGRES_USER: excalimore
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - excalimore-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U excalimore -d excalimore"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  excalimore-pgdata:
```

- [ ] **Step 2: `deploy/example/.env.example`**

```
# Required
DATABASE_URL=postgres://excalimore:CHANGE_ME@excalimore-db:5432/excalimore
SESSION_SECRET=replace-with-32-random-bytes-base64-or-hex
PUBLIC_URL=https://excalimore.example.com
DB_PASSWORD=CHANGE_ME

# Optional (defaults shown)
TAG=latest
WEB_PORT=8080
API_PORT=8081
RATE_LIMIT_LOGIN=5
SESSION_MAX_AGE=2592000
BOOTSTRAP_TOKEN_TTL=3600
```

- [ ] **Step 3: `deploy/example/README.md`**

Operator quickstart with bootstrap-URL guidance, Caddy/nginx reverse-proxy snippet, common gotchas (DB_PASSWORD must match DATABASE_URL, PUBLIC_URL must equal whatever the browser actually uses).

- [ ] **Step 4: Commit**

```bash
git add deploy/example
git commit -m "feat(deploy): add generic docker-compose example for OSS users"
```

---

### Task 8: Local docker compose smoke test

This is a real test, not a paper exercise. Build the images, bring them up, hit the endpoints, watch logs for the bootstrap URL, then tear down.

- [ ] **Step 1: Build both images**

```bash
docker buildx build -f apps/api/Dockerfile -t excalimore-api:smoke --load .
docker buildx build -f apps/web/Dockerfile -t excalimore-web:smoke --load .
```

- [ ] **Step 2: Override compose with smoke tags**

Create a temporary `deploy/example/.env` with `TAG=smoke` and matching `DATABASE_URL` / `DB_PASSWORD` / `SESSION_SECRET` / `PUBLIC_URL=http://localhost:8080`.

Use `docker compose -f deploy/example/docker-compose.yml up -d` (with both `excalimore-api:smoke` and `excalimore-web:smoke` already loaded; we override the image with a small `docker-compose.override.yml` or by retagging to `:latest`).

Simplest: `docker tag excalimore-api:smoke ghcr.io/bimosyah/excalimore-api:latest` and similarly for web, then `docker compose up -d`.

- [ ] **Step 3: Verify**

```bash
docker compose -f deploy/example/docker-compose.yml ps
curl -i http://localhost:8080/                    # SPA HTML, 200
curl -i http://localhost:8081/api/health          # {"status":"ok",...}
docker compose -f deploy/example/docker-compose.yml logs excalimore-api | grep -i bootstrap
```

Expect a printed bootstrap signup URL.

- [ ] **Step 4: Tear down**

```bash
docker compose -f deploy/example/docker-compose.yml down -v
docker rmi excalimore-api:smoke excalimore-web:smoke ghcr.io/bimosyah/excalimore-api:latest ghcr.io/bimosyah/excalimore-web:latest
rm deploy/example/.env
```

- [ ] **Step 5: Capture results**

Note image sizes and smoke outcomes for the PR description. Nothing to commit here — this is verification.

---

### Task 9: Bimo's private deploy infra

**Files (outside the OSS repo):**
- Create: `~/Work/bimosyahputro.com/infra/excalimore/docker-compose.yml`
- Create: `~/Work/bimosyahputro.com/infra/excalimore/.env.example`
- Create: `~/Work/bimosyahputro.com/infra/excalimore/deploy.sh`

- [ ] **Step 1: `docker-compose.yml`** — same shape as the example but binds to `127.0.0.1:6700` (web) and `127.0.0.1:6701` (api).

- [ ] **Step 2: `.env.example`** — includes the additional `DB_PASSWORD`, `SESSION_SECRET` (clearly marked "generate with `openssl rand -hex 32`"), and `PUBLIC_URL=https://excalimore.bimosyahputro.com`.

- [ ] **Step 3: `deploy.sh`** — mirrors `deploy-n8n.sh` style. Uses `SERVER=${SERVER:-hetzner-1}` so it's overridable via env. Pushes compose + caddyfile, pulls images, restarts.

- [ ] **Step 4: Verify** — visually diff against `deploy-n8n.sh`. Don't run on the real server. `chmod +x deploy.sh`.

These are NOT committed to the OSS repo. They're prepared on disk so Bimo can copy/run later.

---

### Task 10: Caddy entry for excalimore.bimosyahputro.com

**Files:**
- Modify: `~/Work/bimosyahputro.com/infra/Caddyfile`

- [ ] **Step 1: Append the new block**

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

Append, do not replace. The PR description shows the resulting diff.

This is OUTSIDE the OSS repo. The agent appends the block locally; deployment to the live server is Bimo's call.

---

### Task 11: Final checks — lint / typecheck / test / build

- [ ] **Step 1: `pnpm lint`** — must be clean.
- [ ] **Step 2: `pnpm typecheck`** — must be clean.
- [ ] **Step 3: `pnpm test`** — must pass.
- [ ] **Step 4: `docker buildx build` both Dockerfiles** — must succeed end-to-end.

If anything fails, fix and re-run before opening the PR.

---

### Task 12: Open the PR

- [ ] **Step 1: Push the branch** and open a PR with title "Phase 6: Production deployment infra (Dockerfiles, CI release, deploy scripts)".

- [ ] **Step 2: PR body** must include:
  - Summary of all artifacts added
  - Image build sizes (api + web)
  - Smoke test outcome (commands run + outputs)
  - Caddyfile delta to append (verbatim, ready to copy/paste)
  - List of files written under `~/Work/bimosyahputro.com/infra/excalimore/`
  - Test plan checklist

- [ ] **Step 3: `gh run watch`** the latest CI run on the PR. The release workflow is tag-triggered so it will not run; that is expected. The CI `lint`/`typecheck`/`test` jobs must go green.

---

## Phase 6 Done Criteria

Tick when **all** of the following are true:

- [ ] `apps/api/Dockerfile` builds locally and produces a working image (`/api/health` 200).
- [ ] `apps/web/Dockerfile` builds locally and produces a working image (`/` 200, SPA fallback works for arbitrary paths).
- [ ] `deploy/example/docker-compose.yml` brings up the full stack against a local Postgres; bootstrap URL is logged.
- [ ] `.github/workflows/release.yml` syntactically valid, two parallel jobs, ghcr.io targets, tag-triggered.
- [ ] `~/Work/bimosyahputro.com/infra/excalimore/` contains `docker-compose.yml`, `.env.example`, `deploy.sh` (executable, mirroring `deploy-n8n.sh`).
- [ ] Caddy snippet for `excalimore.bimosyahputro.com` appended to `~/Work/bimosyahputro.com/infra/Caddyfile`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` all green.
- [ ] PR opened against `main`; CI lint/typecheck/test jobs green.
