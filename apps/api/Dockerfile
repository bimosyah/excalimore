# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22-alpine

# ---- deps stage: install full workspace deps (including dev) ----
FROM node:${NODE_VERSION} AS deps
WORKDIR /repo
RUN apk add --no-cache python3 make g++ libc6-compat
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build stage: compile TS to dist ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY apps/api apps/api
RUN pnpm --filter @excalimore/api build

# ---- prod-deps stage: install runtime deps only (pnpm symlink layout intact) ----
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
# Keep the full pnpm workspace layout so workspace symlinks (api -> packages/types)
# resolve correctly at runtime. Final image runs from /repo/apps/api.
FROM node:${NODE_VERSION} AS runtime
WORKDIR /repo/apps/api
ENV NODE_ENV=production \
    PORT=3000

COPY --from=prod-deps /repo/node_modules /repo/node_modules
COPY --from=prod-deps /repo/package.json /repo/package.json
COPY --from=prod-deps /repo/pnpm-workspace.yaml /repo/pnpm-workspace.yaml
COPY --from=prod-deps /repo/apps/api/node_modules /repo/apps/api/node_modules
COPY --from=prod-deps /repo/apps/api/package.json /repo/apps/api/package.json
COPY --from=prod-deps /repo/packages/types /repo/packages/types
COPY --from=build /repo/apps/api/dist /repo/apps/api/dist
COPY --from=build /repo/apps/api/drizzle /repo/apps/api/drizzle

EXPOSE 3000
# Run migrations once, then start the API server.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
