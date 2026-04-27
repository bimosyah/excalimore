# Contributing to Excalimore

## Getting started

1. Install Node 22 (`nvm use` reads `.nvmrc`).
2. Install pnpm 9: `brew install pnpm@9` (macOS) or `npm i -g pnpm@9`.
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
- Imports use no file extension (Bundler module resolution).
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
