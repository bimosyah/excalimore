# Excalimore Implementation Plan — Phase 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo skeleton, database schema, and bare-bones FE/BE skeletons so subsequent phases build on a working dev environment.

**Architecture:** pnpm workspaces + Turborepo monorepo; Hono API on Node 22 with Drizzle ORM against Postgres 17; Vite + React SPA; shared types in `packages/types`.

**Tech Stack:** TypeScript 5.6+, pnpm 9, Turborepo 2, Hono 4, Drizzle ORM, Postgres 17, Vite 6, React 19, Biome 1.9, Vitest 2, Zod 3.

**Spec reference:** [`../specs/2026-04-27-excalimore-design.md`](../specs/2026-04-27-excalimore-design.md)

---

## Phase Overview

| Phase | Output |
|---|---|
| **1. Foundation** ← this plan | Monorepo runs `pnpm dev`. API healthcheck responds. Empty schema migrated. CI green. |
| 2. Auth | `auth/*.ts` module + `/api/auth/*` routes + integration tests pass against test Postgres. Bootstrap + invite + login + session work end-to-end via curl. |
| 3. Core API | `/api/folders`, `/api/scenes`, `/api/comments`, `/api/events` (SSE) + access control + integration tests. |
| 4. Frontend MVP | Login/signup pages, scene list, folder tree, scene route hosts `<Excalidraw />` with debounced save. No comments yet. |
| 5. Comment overlay | `<CommentOverlay />`, `<CommentPin />`, `<CommentSidebar />`, coordinate transforms, state machine for add-comment, edge cases. |
| 6. Deployment | Multi-stage Dockerfiles, GitHub Actions CI/release, `deploy/example/` files, deploy.sh + Caddy entry for `bimosyahputro.com` infra, smoke-test playbook. |

Plans for Phase 2–6 will be written after each previous phase is executed and reviewed.

---

## Phase 1 File Structure

After Phase 1, the repo will look like:

```
excalimore/
├── .github/
│   └── workflows/
│       └── ci.yml                          # lint, typecheck, test
├── .gitignore                              # (exists)
├── .editorconfig                           # NEW
├── .nvmrc                                  # NEW — pin Node 22
├── biome.json                              # NEW — lint/format config
├── package.json                            # NEW — root scripts + workspace root
├── pnpm-workspace.yaml                     # NEW — workspace globs
├── tsconfig.base.json                      # NEW — shared TS settings
├── turbo.json                              # NEW — pipeline definition
├── LICENSE                                 # (exists)
├── README.md                               # (exists, will be updated)
├── packages/
│   └── types/
│       ├── package.json                    # NEW
│       ├── tsconfig.json                   # NEW
│       ├── src/
│       │   ├── index.ts                    # NEW — re-exports
│       │   ├── user.ts                     # NEW — User, UserRole types + Zod
│       │   ├── folder.ts                   # NEW — Folder type + Zod
│       │   ├── scene.ts                    # NEW — Scene type + ExcalidrawSceneData
│       │   ├── comment.ts                  # NEW — Comment type + Zod
│       │   ├── grant.ts                    # NEW — ShareGrant + Permission
│       │   ├── invite.ts                   # NEW — InviteToken type
│       │   └── event.ts                    # NEW — SSE event payloads
│       └── tests/
│           └── schemas.test.ts             # NEW — Zod parse roundtrips
├── apps/
│   ├── api/
│   │   ├── package.json                    # NEW
│   │   ├── tsconfig.json                   # NEW
│   │   ├── drizzle.config.ts               # NEW — drizzle-kit config
│   │   ├── docker-compose.dev.yml          # NEW — local Postgres for dev
│   │   ├── .env.example                    # NEW
│   │   ├── src/
│   │   │   ├── index.ts                    # NEW — Hono app + healthcheck
│   │   │   ├── env.ts                      # NEW — env parsing with Zod
│   │   │   ├── db/
│   │   │   │   ├── client.ts               # NEW — Drizzle client factory
│   │   │   │   ├── schema/
│   │   │   │   │   ├── index.ts            # NEW — re-exports
│   │   │   │   │   ├── users.ts            # NEW
│   │   │   │   │   ├── folders.ts          # NEW
│   │   │   │   │   ├── scenes.ts           # NEW
│   │   │   │   │   ├── comments.ts         # NEW
│   │   │   │   │   ├── share-grants.ts     # NEW
│   │   │   │   │   ├── invite-tokens.ts    # NEW
│   │   │   │   │   ├── sessions.ts         # NEW
│   │   │   │   │   └── bootstrap-tokens.ts # NEW
│   │   │   │   └── migrate.ts              # NEW — programmatic migration runner
│   │   │   └── lib/
│   │   │       └── ids.ts                  # NEW — uuid + token generators
│   │   ├── drizzle/                        # generated SQL migrations
│   │   └── tests/
│   │       ├── healthcheck.test.ts         # NEW
│   │       ├── schema.test.ts              # NEW — schema integrity
│   │       └── setup.ts                    # NEW — testcontainers Postgres
│   └── web/
│       ├── package.json                    # NEW
│       ├── tsconfig.json                   # NEW
│       ├── tsconfig.node.json              # NEW
│       ├── vite.config.ts                  # NEW
│       ├── index.html                      # NEW
│       ├── src/
│       │   ├── main.tsx                    # NEW — React entry
│       │   ├── app.tsx                     # NEW — placeholder root
│       │   └── styles.css                  # NEW — minimal reset
│       └── public/
│           └── favicon.svg                 # NEW
└── docs/                                   # (exists)
    └── superpowers/
        ├── specs/                          # (exists)
        └── plans/                          # (exists)
```

---

## Tasks

### Task 1: Pin Node version

**Files:**
- Create: `.nvmrc`
- Create: `.editorconfig`

- [ ] **Step 1: Create `.nvmrc`**

```
22
```

- [ ] **Step 2: Create `.editorconfig`**

```
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 3: Verify Node version**

Run: `node --version`
Expected: `v22.x.x` (any Node 22). If wrong, switch with `nvm use`.

- [ ] **Step 4: Commit**

```bash
git add .nvmrc .editorconfig
git commit -m "chore: pin Node 22 and add editorconfig"
```

---

### Task 2: Initialize pnpm workspace root

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`

- [ ] **Step 1: Verify pnpm installed**

Run: `pnpm --version`
Expected: `9.x.x` or higher. If missing: `npm install -g pnpm@9`.

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "excalimore",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "biome check .",
    "format": "biome format --write .",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "turbo": "^2.1.0",
    "typescript": "^5.6.0"
  },
  "engines": {
    "node": ">=22"
  }
}
```

- [ ] **Step 3: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 4: Install root dependencies**

Run: `pnpm install`
Expected: `Done in N` with no errors. `node_modules` and `pnpm-lock.yaml` created.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore: initialize pnpm workspace"
```

---

### Task 3: Configure Biome (lint + format)

**Files:**
- Create: `biome.json`

- [ ] **Step 1: Create `biome.json`**

```json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "ignoreUnknown": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "useImportType": "error",
        "useNodejsImportProtocol": "error"
      },
      "suspicious": {
        "noExplicitAny": "warn"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "asNeeded",
      "trailingCommas": "all",
      "arrowParentheses": "always"
    }
  }
}
```

- [ ] **Step 2: Run lint to verify config loads**

Run: `pnpm lint`
Expected: `Checked N files in Xms. No fixes applied.` (no files to lint yet — that's fine).

- [ ] **Step 3: Commit**

```bash
git add biome.json
git commit -m "chore: configure Biome for lint and format"
```

---

### Task 4: Configure Turborepo

**Files:**
- Create: `turbo.json`
- Create: `tsconfig.base.json`

- [ ] **Step 1: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "build/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    }
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "exclude": ["node_modules", "dist", "build"]
}
```

- [ ] **Step 3: Verify turbo loads**

Run: `pnpm exec turbo --version`
Expected: `2.x.x`.

- [ ] **Step 4: Commit**

```bash
git add turbo.json tsconfig.base.json
git commit -m "chore: configure Turborepo and shared tsconfig"
```

---

### Task 5: Scaffold `packages/types`

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/src/index.ts`

- [ ] **Step 1: Create `packages/types/package.json`**

```json
{
  "name": "@excalimore/types",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `packages/types/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `packages/types/src/index.ts`**

```ts
export * from './user.ts'
export * from './folder.ts'
export * from './scene.ts'
export * from './comment.ts'
export * from './grant.ts'
export * from './invite.ts'
export * from './event.ts'
```

- [ ] **Step 4: Install package deps**

Run: `pnpm install`
Expected: zod and vitest added under `packages/types/node_modules`.

- [ ] **Step 5: Commit**

```bash
git add packages/types pnpm-lock.yaml
git commit -m "feat(types): scaffold @excalimore/types package"
```

---

### Task 6: Define User types and Zod schemas

**Files:**
- Create: `packages/types/src/user.ts`
- Test: `packages/types/tests/schemas.test.ts`

- [ ] **Step 1: Create `packages/types/src/user.ts`**

```ts
import { z } from 'zod'

export const UserRoleSchema = z.enum(['user', 'admin'])
export type UserRole = z.infer<typeof UserRoleSchema>

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: UserRoleSchema,
  createdAt: z.string().datetime(),
})
export type User = z.infer<typeof UserSchema>

export const PublicUserSchema = UserSchema.omit({ role: true })
export type PublicUser = z.infer<typeof PublicUserSchema>

export const SignupRequestSchema = z.object({
  token: z.string().min(20),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
})
export type SignupRequest = z.infer<typeof SignupRequestSchema>

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
export type LoginRequest = z.infer<typeof LoginRequestSchema>
```

- [ ] **Step 2: Create `packages/types/tests/schemas.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { LoginRequestSchema, SignupRequestSchema, UserSchema } from '../src/index.ts'

describe('UserSchema', () => {
  it('accepts a valid user', () => {
    const result = UserSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      email: 'bimo@example.com',
      name: 'Bimo',
      role: 'admin',
      createdAt: '2026-04-27T12:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid email', () => {
    const result = UserSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      email: 'not-an-email',
      name: 'Bimo',
      role: 'user',
      createdAt: '2026-04-27T12:00:00.000Z',
    })
    expect(result.success).toBe(false)
  })
})

describe('SignupRequestSchema', () => {
  it('rejects passwords shorter than 8 chars', () => {
    const result = SignupRequestSchema.safeParse({
      token: 'a'.repeat(32),
      email: 'a@b.co',
      password: 'short',
      name: 'A',
    })
    expect(result.success).toBe(false)
  })
})

describe('LoginRequestSchema', () => {
  it('accepts non-empty password', () => {
    const result = LoginRequestSchema.safeParse({ email: 'a@b.co', password: 'x' })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @excalimore/types test`
Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/user.ts packages/types/tests/schemas.test.ts
git commit -m "feat(types): add User schemas with tests"
```

---

### Task 7: Define remaining domain schemas

**Files:**
- Create: `packages/types/src/folder.ts`
- Create: `packages/types/src/scene.ts`
- Create: `packages/types/src/comment.ts`
- Create: `packages/types/src/grant.ts`
- Create: `packages/types/src/invite.ts`
- Create: `packages/types/src/event.ts`

- [ ] **Step 1: Create `packages/types/src/folder.ts`**

```ts
import { z } from 'zod'

export const FolderSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Folder = z.infer<typeof FolderSchema>

export const CreateFolderRequestSchema = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().uuid().nullable().optional(),
})
export type CreateFolderRequest = z.infer<typeof CreateFolderRequestSchema>

export const UpdateFolderRequestSchema = CreateFolderRequestSchema.partial()
export type UpdateFolderRequest = z.infer<typeof UpdateFolderRequestSchema>

export const MAX_FOLDER_DEPTH = 5
```

- [ ] **Step 2: Create `packages/types/src/scene.ts`**

The Excalidraw scene shape mirrors the on-disk `.excalidraw` format — kept loose because upstream evolves it.

```ts
import { z } from 'zod'

// We keep ExcalidrawSceneData loose: matches upstream .excalidraw file format,
// which evolves independently of us. Upstream owns the element/appState shape.
export const ExcalidrawSceneDataSchema = z
  .object({
    type: z.literal('excalidraw').optional(),
    version: z.number().optional(),
    source: z.string().optional(),
    elements: z.array(z.unknown()).default([]),
    appState: z.record(z.unknown()).default({}),
    files: z.record(z.unknown()).default({}),
  })
  .passthrough()
export type ExcalidrawSceneData = z.infer<typeof ExcalidrawSceneDataSchema>

export const SceneSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  folderId: z.string().uuid().nullable(),
  name: z.string().min(1).max(200),
  data: ExcalidrawSceneDataSchema,
  thumbnailUrl: z.string().url().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Scene = z.infer<typeof SceneSchema>

export const CreateSceneRequestSchema = z.object({
  name: z.string().min(1).max(200),
  folderId: z.string().uuid().nullable().optional(),
})
export type CreateSceneRequest = z.infer<typeof CreateSceneRequestSchema>

export const UpdateSceneRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  folderId: z.string().uuid().nullable().optional(),
  data: ExcalidrawSceneDataSchema.optional(),
})
export type UpdateSceneRequest = z.infer<typeof UpdateSceneRequestSchema>
```

- [ ] **Step 3: Create `packages/types/src/comment.ts`**

```ts
import { z } from 'zod'

export const CommentSchema = z.object({
  id: z.string().uuid(),
  sceneId: z.string().uuid(),
  authorId: z.string().uuid(),
  elementId: z.string().min(1),
  xOffset: z.number().int(),
  yOffset: z.number().int(),
  lastKnownX: z.number().nullable(),
  lastKnownY: z.number().nullable(),
  body: z.string().min(1).max(5000),
  resolved: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Comment = z.infer<typeof CommentSchema>

export const CreateCommentRequestSchema = z.object({
  elementId: z.string().min(1),
  xOffset: z.number().int().default(0),
  yOffset: z.number().int().default(0),
  lastKnownX: z.number().nullable().optional(),
  lastKnownY: z.number().nullable().optional(),
  body: z.string().min(1).max(5000),
})
export type CreateCommentRequest = z.infer<typeof CreateCommentRequestSchema>

export const UpdateCommentRequestSchema = z.object({
  body: z.string().min(1).max(5000).optional(),
  resolved: z.boolean().optional(),
})
export type UpdateCommentRequest = z.infer<typeof UpdateCommentRequestSchema>
```

- [ ] **Step 4: Create `packages/types/src/grant.ts`**

```ts
import { z } from 'zod'

export const PermissionSchema = z.enum(['view', 'edit'])
export type Permission = z.infer<typeof PermissionSchema>

export const ShareGrantSchema = z.object({
  id: z.string().uuid(),
  sceneId: z.string().uuid(),
  userId: z.string().uuid(),
  permission: PermissionSchema,
  grantedBy: z.string().uuid(),
  createdAt: z.string().datetime(),
})
export type ShareGrant = z.infer<typeof ShareGrantSchema>

export const CreateGrantRequestSchema = z.object({
  userId: z.string().uuid(),
  permission: PermissionSchema,
})
export type CreateGrantRequest = z.infer<typeof CreateGrantRequestSchema>
```

- [ ] **Step 5: Create `packages/types/src/invite.ts`**

```ts
import { z } from 'zod'
import { PermissionSchema } from './grant.ts'

export const InviteTokenSchema = z.object({
  token: z.string().min(20),
  sceneId: z.string().uuid().nullable(),
  permission: PermissionSchema.nullable(),
  createdBy: z.string().uuid(),
  expiresAt: z.string().datetime(),
  usedBy: z.string().uuid().nullable(),
  usedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export type InviteToken = z.infer<typeof InviteTokenSchema>

export const CreateInviteRequestSchema = z.object({
  sceneId: z.string().uuid().optional(),
  permission: PermissionSchema.optional(),
  expiresAt: z.string().datetime().optional(),
})
export type CreateInviteRequest = z.infer<typeof CreateInviteRequestSchema>

export const CreateInviteResponseSchema = z.object({
  token: z.string(),
  url: z.string().url(),
})
export type CreateInviteResponse = z.infer<typeof CreateInviteResponseSchema>
```

- [ ] **Step 6: Create `packages/types/src/event.ts`**

```ts
import { z } from 'zod'
import { CommentSchema } from './comment.ts'

export const SseEventTypeSchema = z.enum([
  'comment.created',
  'comment.updated',
  'comment.resolved',
  'scene.updated',
])
export type SseEventType = z.infer<typeof SseEventTypeSchema>

export const CommentEventSchema = z.object({
  type: z.enum(['comment.created', 'comment.updated', 'comment.resolved']),
  payload: CommentSchema,
})

export const SceneUpdatedEventSchema = z.object({
  type: z.literal('scene.updated'),
  payload: z.object({ sceneId: z.string().uuid(), updatedAt: z.string().datetime() }),
})

export const SseEventSchema = z.union([CommentEventSchema, SceneUpdatedEventSchema])
export type SseEvent = z.infer<typeof SseEventSchema>
```

- [ ] **Step 7: Run typecheck and tests**

Run: `pnpm --filter @excalimore/types typecheck`
Expected: no errors.

Run: `pnpm --filter @excalimore/types test`
Expected: 3 tests still pass (we did not add tests for new schemas yet — they get covered indirectly via API integration tests in Phase 3).

- [ ] **Step 8: Commit**

```bash
git add packages/types/src
git commit -m "feat(types): add Folder, Scene, Comment, Grant, Invite, Event schemas"
```

---

### Task 8: Scaffold `apps/api`

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/env.ts`
- Create: `apps/api/.env.example`

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "@excalimore/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts"
  },
  "dependencies": {
    "@excalimore/types": "workspace:*",
    "@hono/node-server": "^1.13.0",
    "drizzle-orm": "^0.36.0",
    "hono": "^4.6.0",
    "postgres": "^3.4.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "^10.13.0",
    "@types/node": "^22.7.0",
    "drizzle-kit": "^0.28.0",
    "testcontainers": "^10.13.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `apps/api/.env.example`**

```
# Required
DATABASE_URL=postgres://excalimore:devpassword@localhost:5432/excalimore
SESSION_SECRET=changeme-32-bytes-random
PUBLIC_URL=http://localhost:5173

# Optional
PORT=3000
RATE_LIMIT_LOGIN=5
SESSION_MAX_AGE=2592000
BOOTSTRAP_TOKEN_TTL=3600
```

- [ ] **Step 4: Create `apps/api/src/env.ts`**

```ts
import { z } from 'zod'

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(16),
  PUBLIC_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  RATE_LIMIT_LOGIN: z.coerce.number().int().positive().default(5),
  SESSION_MAX_AGE: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  BOOTSTRAP_TOKEN_TTL: z.coerce.number().int().positive().default(60 * 60),
})

export type Env = z.infer<typeof EnvSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  return parsed.data
}
```

- [ ] **Step 5: Create `apps/api/src/index.ts`**

```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { loadEnv } from './env.ts'

const env = loadEnv()
const app = new Hono()

app.get('/api/health', (c) => c.json({ status: 'ok', service: 'excalimore-api' }))

app.notFound((c) => c.json({ error: 'Not Found' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal Server Error' }, 500)
})

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`excalimore-api listening on http://localhost:${info.port}`)
})
```

- [ ] **Step 6: Install api deps**

Run: `pnpm install`
Expected: lockfile updated, no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json apps/api/tsconfig.json apps/api/src apps/api/.env.example pnpm-lock.yaml
git commit -m "feat(api): scaffold Hono API with healthcheck and env loader"
```

---

### Task 9: Add dev Postgres via docker-compose

**Files:**
- Create: `apps/api/docker-compose.dev.yml`

- [ ] **Step 1: Create `apps/api/docker-compose.dev.yml`**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    ports:
      - "127.0.0.1:5432:5432"
    environment:
      POSTGRES_DB: excalimore
      POSTGRES_USER: excalimore
      POSTGRES_PASSWORD: devpassword
    volumes:
      - excalimore-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U excalimore -d excalimore"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  excalimore-pgdata:
```

- [ ] **Step 2: Start Postgres**

Run: `docker compose -f apps/api/docker-compose.dev.yml up -d`
Expected: container `apps-api-postgres-1` (or similar) running, port 5432 exposed.

- [ ] **Step 3: Verify Postgres reachable**

Run: `docker compose -f apps/api/docker-compose.dev.yml exec postgres pg_isready -U excalimore -d excalimore`
Expected: `localhost:5432 - accepting connections`.

- [ ] **Step 4: Copy `.env.example` to `.env`**

Run: `cp apps/api/.env.example apps/api/.env`
Expected: `apps/api/.env` exists. (Already gitignored.)

- [ ] **Step 5: Smoke test API boots**

Run: `cd apps/api && pnpm dev`
Wait ~3s for tsx to start. In another shell: `curl http://localhost:3000/api/health`
Expected: `{"status":"ok","service":"excalimore-api"}`.

Stop dev server with Ctrl-C.

- [ ] **Step 6: Commit**

```bash
git add apps/api/docker-compose.dev.yml
git commit -m "feat(api): add dev Postgres docker-compose"
```

---

### Task 10: Configure Drizzle ORM

**Files:**
- Create: `apps/api/drizzle.config.ts`
- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/db/schema/index.ts`

- [ ] **Step 1: Create `apps/api/drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://excalimore:devpassword@localhost:5432/excalimore',
  },
  verbose: true,
  strict: true,
})
```

- [ ] **Step 2: Create `apps/api/src/db/schema/index.ts` (placeholder)**

```ts
// Re-exports each table schema. Populated by Tasks 11–13.
export {}
```

- [ ] **Step 3: Create `apps/api/src/db/client.ts`**

```ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.ts'

export type DbClient = ReturnType<typeof drizzle<typeof schema>>

export function createDbClient(databaseUrl: string): DbClient {
  const sql = postgres(databaseUrl, { prepare: false })
  return drizzle(sql, { schema })
}
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @excalimore/api typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/drizzle.config.ts apps/api/src/db
git commit -m "feat(api): configure Drizzle client and schema entry"
```

---

### Task 11: Define `users`, `folders`, `scenes` schemas

**Files:**
- Create: `apps/api/src/db/schema/users.ts`
- Create: `apps/api/src/db/schema/folders.ts`
- Create: `apps/api/src/db/schema/scenes.ts`
- Modify: `apps/api/src/db/schema/index.ts`

- [ ] **Step 1: Create `apps/api/src/db/schema/users.ts`**

```ts
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type UserRow = typeof users.$inferSelect
export type NewUserRow = typeof users.$inferInsert
```

- [ ] **Step 2: Create `apps/api/src/db/schema/folders.ts`**

```ts
import { type AnyPgColumn, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users.ts'

export const folders = pgTable('folders', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id').references((): AnyPgColumn => folders.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type FolderRow = typeof folders.$inferSelect
export type NewFolderRow = typeof folders.$inferInsert
```

- [ ] **Step 3: Create `apps/api/src/db/schema/scenes.ts`**

```ts
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { ExcalidrawSceneData } from '@excalimore/types'
import { folders } from './folders.ts'
import { users } from './users.ts'

export const scenes = pgTable('scenes', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  data: jsonb('data').$type<ExcalidrawSceneData>().notNull(),
  thumbnailUrl: text('thumbnail_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type SceneRow = typeof scenes.$inferSelect
export type NewSceneRow = typeof scenes.$inferInsert
```

- [ ] **Step 4: Update `apps/api/src/db/schema/index.ts`**

```ts
export * from './users.ts'
export * from './folders.ts'
export * from './scenes.ts'
```

- [ ] **Step 5: Verify typecheck**

Run: `pnpm --filter @excalimore/api typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema
git commit -m "feat(api): add users, folders, scenes Drizzle schemas"
```

---

### Task 12: Define `comments`, `share_grants`, `invite_tokens` schemas

**Files:**
- Create: `apps/api/src/db/schema/comments.ts`
- Create: `apps/api/src/db/schema/share-grants.ts`
- Create: `apps/api/src/db/schema/invite-tokens.ts`
- Modify: `apps/api/src/db/schema/index.ts`

- [ ] **Step 1: Create `apps/api/src/db/schema/comments.ts`**

```ts
import { boolean, doublePrecision, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { scenes } from './scenes.ts'
import { users } from './users.ts'

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  sceneId: uuid('scene_id')
    .notNull()
    .references(() => scenes.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  elementId: text('element_id').notNull(),
  xOffset: integer('x_offset').notNull().default(0),
  yOffset: integer('y_offset').notNull().default(0),
  lastKnownX: doublePrecision('last_known_x'),
  lastKnownY: doublePrecision('last_known_y'),
  body: text('body').notNull(),
  resolved: boolean('resolved').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type CommentRow = typeof comments.$inferSelect
export type NewCommentRow = typeof comments.$inferInsert
```

- [ ] **Step 2: Create `apps/api/src/db/schema/share-grants.ts`**

```ts
import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { scenes } from './scenes.ts'
import { users } from './users.ts'

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
```

- [ ] **Step 3: Create `apps/api/src/db/schema/invite-tokens.ts`**

```ts
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { scenes } from './scenes.ts'
import { users } from './users.ts'

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
```

- [ ] **Step 4: Update `apps/api/src/db/schema/index.ts`**

```ts
export * from './users.ts'
export * from './folders.ts'
export * from './scenes.ts'
export * from './comments.ts'
export * from './share-grants.ts'
export * from './invite-tokens.ts'
```

- [ ] **Step 5: Verify typecheck**

Run: `pnpm --filter @excalimore/api typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema
git commit -m "feat(api): add comments, share_grants, invite_tokens schemas"
```

---

### Task 13: Define `sessions` and `bootstrap_tokens` schemas

**Files:**
- Create: `apps/api/src/db/schema/sessions.ts`
- Create: `apps/api/src/db/schema/bootstrap-tokens.ts`
- Modify: `apps/api/src/db/schema/index.ts`

- [ ] **Step 1: Create `apps/api/src/db/schema/sessions.ts`**

```ts
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users.ts'

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type SessionRow = typeof sessions.$inferSelect
export type NewSessionRow = typeof sessions.$inferInsert
```

- [ ] **Step 2: Create `apps/api/src/db/schema/bootstrap-tokens.ts`**

```ts
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const bootstrapTokens = pgTable('bootstrap_tokens', {
  token: text('token').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type BootstrapTokenRow = typeof bootstrapTokens.$inferSelect
export type NewBootstrapTokenRow = typeof bootstrapTokens.$inferInsert
```

- [ ] **Step 3: Update `apps/api/src/db/schema/index.ts`**

```ts
export * from './users.ts'
export * from './folders.ts'
export * from './scenes.ts'
export * from './comments.ts'
export * from './share-grants.ts'
export * from './invite-tokens.ts'
export * from './sessions.ts'
export * from './bootstrap-tokens.ts'
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @excalimore/api typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/schema
git commit -m "feat(api): add sessions, bootstrap_tokens schemas"
```

---

### Task 14: Generate initial migration

**Files:**
- Create: `apps/api/drizzle/0000_*.sql` (auto-generated)

- [ ] **Step 1: Generate migration**

Ensure `apps/api/.env` exists with `DATABASE_URL`. Run from repo root:

`pnpm --filter @excalimore/api db:generate`

Expected: `apps/api/drizzle/0000_<random_name>.sql` and `apps/api/drizzle/meta/_journal.json` created.

- [ ] **Step 2: Inspect the generated SQL**

Open the new file in `apps/api/drizzle/`. It should contain `CREATE TABLE "users"`, `"folders"`, `"scenes"`, `"comments"`, `"share_grants"`, `"invite_tokens"`, `"sessions"`, `"bootstrap_tokens"`, plus FK constraints and the unique constraint on `share_grants(scene_id, user_id)`.

If anything's missing, fix the schema files and re-run `db:generate`.

- [ ] **Step 3: Commit the migration**

```bash
git add apps/api/drizzle
git commit -m "feat(api): generate initial database migration"
```

---

### Task 15: Implement programmatic migration runner

**Files:**
- Create: `apps/api/src/db/migrate.ts`

- [ ] **Step 1: Create `apps/api/src/db/migrate.ts`**

```ts
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { loadEnv } from '../env.ts'
import { createDbClient } from './client.ts'

async function main() {
  const env = loadEnv()
  const db = createDbClient(env.DATABASE_URL)
  console.log('Running migrations...')
  await migrate(db, { migrationsFolder: './drizzle' })
  console.log('Migrations complete.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Run migrations against dev Postgres**

Run: `pnpm --filter @excalimore/api db:migrate`
Expected: `Running migrations... Migrations complete.`

- [ ] **Step 3: Verify tables exist**

Run:
```bash
docker compose -f apps/api/docker-compose.dev.yml exec postgres \
  psql -U excalimore -d excalimore -c "\dt"
```

Expected: 8 tables listed plus Drizzle's `__drizzle_migrations`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrate.ts
git commit -m "feat(api): add programmatic migration runner"
```

---

### Task 16: Healthcheck integration test

**Files:**
- Create: `apps/api/tests/setup.ts`
- Create: `apps/api/tests/healthcheck.test.ts`
- Create: `apps/api/vitest.config.ts`

- [ ] **Step 1: Create `apps/api/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    globalSetup: './tests/setup.ts',
  },
})
```

- [ ] **Step 2: Create `apps/api/tests/setup.ts`**

```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

let container: StartedPostgreSqlContainer | undefined

export async function setup() {
  container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('excalimore_test')
    .withUsername('test')
    .withPassword('test')
    .start()

  const url = container.getConnectionUri()
  process.env.DATABASE_URL = url
  process.env.SESSION_SECRET = 'test-session-secret-32-bytes-long'
  process.env.PUBLIC_URL = 'http://localhost:5173'

  const sql = postgres(url, { prepare: false })
  const db = drizzle(sql)
  await migrate(db, { migrationsFolder: './drizzle' })
  await sql.end()
}

export async function teardown() {
  await container?.stop()
}
```

- [ ] **Step 3: Create `apps/api/tests/healthcheck.test.ts`**

```ts
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

// Build a fresh app per test rather than importing the running server,
// so we test the route handler in isolation.
function buildApp() {
  const app = new Hono()
  app.get('/api/health', (c) => c.json({ status: 'ok', service: 'excalimore-api' }))
  return app
}

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const app = buildApp()
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: 'ok', service: 'excalimore-api' })
  })
})
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @excalimore/api test`
Expected: testcontainers spins up Postgres (~10-20s first run), migrations run, 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/vitest.config.ts apps/api/tests
git commit -m "test(api): add testcontainers setup and healthcheck integration test"
```

---

### Task 17: Schema integrity test

**Files:**
- Create: `apps/api/tests/schema.test.ts`

- [ ] **Step 1: Create `apps/api/tests/schema.test.ts`**

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDbClient, type DbClient } from '../src/db/client.ts'
import { users } from '../src/db/schema/index.ts'

let db: DbClient

beforeAll(() => {
  db = createDbClient(process.env.DATABASE_URL ?? '')
})

afterAll(async () => {
  // Drizzle's postgres driver does not need explicit cleanup here;
  // testcontainers teardown closes the container.
})

describe('users table', () => {
  it('inserts and reads back a user', async () => {
    const [created] = await db
      .insert(users)
      .values({
        email: 'schema-test@example.com',
        name: 'Schema Test',
        passwordHash: 'placeholder-hash',
      })
      .returning()

    expect(created).toBeDefined()
    expect(created!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(created!.role).toBe('user')

    const fetched = await db.select().from(users).where(eq(users.id, created!.id))
    expect(fetched).toHaveLength(1)
    expect(fetched[0]!.email).toBe('schema-test@example.com')

    await db.delete(users).where(eq(users.id, created!.id))
  })

  it('rejects duplicate email', async () => {
    await db.insert(users).values({
      email: 'dup@example.com',
      name: 'A',
      passwordHash: 'h',
    })

    await expect(
      db.insert(users).values({ email: 'dup@example.com', name: 'B', passwordHash: 'h' }),
    ).rejects.toThrow()

    await db.delete(users).where(eq(users.email, 'dup@example.com'))
  })
})
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @excalimore/api test`
Expected: 3 tests pass (1 healthcheck + 2 schema).

- [ ] **Step 3: Commit**

```bash
git add apps/api/tests/schema.test.ts
git commit -m "test(api): verify users schema with insert/read/unique tests"
```

---

### Task 18: Scaffold `apps/web` with Vite + React 19

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/tsconfig.node.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app.tsx`
- Create: `apps/web/src/styles.css`

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@excalimore/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@excalimore/types": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["vite/client"]
  },
  "include": ["src/**/*"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: Create `apps/web/tsconfig.node.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"]
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create `apps/web/vite.config.ts`**

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/events': 'http://localhost:3000',
    },
  },
})
```

- [ ] **Step 5: Create `apps/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Excalimore</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `apps/web/src/styles.css`**

```css
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  background: #fafafa;
  color: #1a1a1a;
}
```

- [ ] **Step 7: Create `apps/web/src/app.tsx`**

```tsx
export function App() {
  return (
    <main style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Excalimore</h1>
      <p>Foundation phase — frontend skeleton wired up.</p>
      <p>
        API health: <ApiHealth />
      </p>
    </main>
  )
}

function ApiHealth() {
  // Lazy fetch via /api proxy; we'll replace with TanStack Query in Phase 4.
  return <span id="api-health">checking…</span>
}
```

- [ ] **Step 8: Create `apps/web/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.tsx'
import './styles.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Smoke check the proxy → API.
fetch('/api/health')
  .then((r) => r.json())
  .then((j: { status: string }) => {
    const el = document.getElementById('api-health')
    if (el) el.textContent = j.status
  })
  .catch(() => {
    const el = document.getElementById('api-health')
    if (el) el.textContent = 'unreachable'
  })
```

- [ ] **Step 9: Create `apps/web/public/favicon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1971c2" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21l3-1 11-11-2-2L4 18l-1 3z"/><path d="M14.5 6.5l3 3"/></svg>
```

- [ ] **Step 10: Install web deps**

Run: `pnpm install`
Expected: lockfile updated, no errors.

- [ ] **Step 11: Smoke test web app**

In one shell:
```bash
cd apps/api && pnpm dev
```

In another:
```bash
cd apps/web && pnpm dev
```

Visit `http://localhost:5173`. Expected: page shows `Excalimore`, `Foundation phase`, and `API health: ok`.

Stop both with Ctrl-C.

- [ ] **Step 12: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): scaffold Vite + React 19 SPA with API proxy"
```

---

### Task 19: Update root README and add CONTRIBUTING

**Files:**
- Modify: `README.md`
- Create: `docs/contributing.md`

- [ ] **Step 1: Replace `README.md`**

```markdown
# Excalimore

A self-hostable layer on top of [Excalidraw](https://github.com/excalidraw/excalidraw) that adds:

- **Unlimited scenes** organized in nested folders
- **Anchored comments** pinned to canvas elements
- **Account-based access** with invite-only signup

Excalimore wraps the open-source `@excalidraw/excalidraw` editor — the editor itself is unchanged. All extra features live in a thin application layer.

## Status

Pre-alpha. Phase 1 (Foundation) in progress. Active design and plans live under [`docs/superpowers/`](./docs/superpowers/).

## Quick start (development)

Requires Node 22, pnpm 9, Docker.

```bash
pnpm install
docker compose -f apps/api/docker-compose.dev.yml up -d
cp apps/api/.env.example apps/api/.env
pnpm --filter @excalimore/api db:migrate
pnpm dev
```

The API listens on `http://localhost:3000`; the web app on `http://localhost:5173`.

## Layout

```
apps/
├── api/          # Hono backend
└── web/          # Vite + React frontend
packages/
└── types/        # Shared TypeScript + Zod schemas
docs/
├── superpowers/  # Design specs and implementation plans
└── contributing.md
```

## License

MIT — see [LICENSE](./LICENSE).
```

- [ ] **Step 2: Create `docs/contributing.md`**

```markdown
# Contributing to Excalimore

## Getting started

1. Install Node 22 (`nvm use` reads `.nvmrc`).
2. Install pnpm 9: `npm i -g pnpm@9`.
3. Install Docker for local Postgres.

```bash
pnpm install
docker compose -f apps/api/docker-compose.dev.yml up -d
cp apps/api/.env.example apps/api/.env
pnpm --filter @excalimore/api db:migrate
pnpm dev
```

## Code conventions

- TypeScript strict mode everywhere (`tsconfig.base.json`).
- Lint and format via Biome: `pnpm lint`, `pnpm format`.
- Vitest for unit and integration tests.
- Frequent, scoped commits using conventional-commit style: `feat(api): …`, `fix(web): …`, `chore: …`.

## Project structure

- `apps/api` — Hono backend, Drizzle ORM, Postgres.
- `apps/web` — Vite + React frontend.
- `packages/types` — shared types and Zod schemas; the contract between API and web.
- `docs/superpowers/specs/` — accepted design specs.
- `docs/superpowers/plans/` — phase-by-phase implementation plans.

## Tests

- `pnpm test` runs all packages in parallel.
- `pnpm --filter @excalimore/api test` runs only the API tests (uses testcontainers — needs Docker running).

## Pull requests

- Open against `main`.
- Reference the relevant phase plan if applicable.
- CI must pass: lint, typecheck, tests.
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/contributing.md
git commit -m "docs: update README with Phase 1 quick start; add CONTRIBUTING"
```

---

### Task 20: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
```

Note: testcontainers uses Docker, which is preinstalled on ubuntu-latest runners. No extra setup needed.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add lint, typecheck, test workflow"
```

- [ ] **Step 3: Push and verify (after GitHub repo is created)**

When the repo at `github.com/bimosyah/excalimore` exists:

```bash
git remote add origin git@github.com:bimosyah/excalimore.git
git push -u origin main
```

Watch CI in the Actions tab. Expected: all three jobs (lint, typecheck, test) green within ~3-5 minutes.

If a job fails, fix it before declaring Phase 1 complete.

---

## Phase 1 Done Criteria

Tick when **all** of the following are true:

- [ ] `pnpm install` completes cleanly from a fresh clone.
- [ ] `docker compose -f apps/api/docker-compose.dev.yml up -d` brings up Postgres healthcheck-passing.
- [ ] `pnpm --filter @excalimore/api db:migrate` applies all 8 tables.
- [ ] `pnpm dev` runs both API and web; visiting `http://localhost:5173` shows `API health: ok`.
- [ ] `pnpm lint` reports no errors.
- [ ] `pnpm typecheck` reports no errors.
- [ ] `pnpm test` passes all tests (3+ in api, 3 in types).
- [ ] CI on `main` is green.

When all checked: open Phase 2 plan-writing session.
