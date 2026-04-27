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
