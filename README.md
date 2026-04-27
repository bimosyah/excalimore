# Excalimore

A self-hostable layer on top of [Excalidraw](https://github.com/excalidraw/excalidraw) that adds:

- **Unlimited scenes** organized in nested folders
- **Anchored comments** pinned to canvas elements
- **Account-based access** with invite-only signup

Excalimore wraps the open-source `@excalidraw/excalidraw` editor — the editor itself is unchanged. All extra features live in a thin application layer.

## Status

Pre-alpha. Backend (Phases 1–3) and frontend MVP (Phase 4) shipped. Comment overlay (Phase 5) and production deployment (Phase 6) pending. Active design and plans live under [`docs/superpowers/`](./docs/superpowers/).

## Quick start (development)

Requires Node 22, pnpm 9, Docker.

```bash
pnpm install
docker compose -f apps/api/docker-compose.dev.yml up -d
cp apps/api/.env.example apps/api/.env
pnpm --filter @excalimore/api db:migrate
pnpm dev
```

Open `http://localhost:5173`. On first run the API logs a bootstrap URL like

```
http://localhost:5173/signup?bootstrap=<token>
```

Open it in your browser to create the admin user. Subsequent users join via invite links generated from `POST /api/auth/invite` (UI in a later phase — for now use `curl`, see [`docs/auth.md`](./docs/auth.md)).

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
