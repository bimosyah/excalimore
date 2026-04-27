# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22-alpine

# ---- deps stage: full workspace deps for typecheck + build ----
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

# ---- build stage: emit dist (proves the codebase typechecks cleanly) ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY apps/api apps/api
RUN pnpm --filter @excalimore/api build

# ---- prod-deps stage: prod-only install (tsx is a runtime dep) ----
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
# We ship the TS source and run it via tsx. The codebase uses
# extensionless imports (e.g. `from './env'`) which Node's strict ESM
# resolver rejects against the tsc-emitted JS, so a bundler-aware
# loader is required. tsx is the lightest such loader and the spec
# explicitly allows it as a fallback when not bundling.
FROM node:${NODE_VERSION} AS runtime
WORKDIR /repo/apps/api
ENV NODE_ENV=production \
    PORT=3000

# Pruned pnpm tree (prod deps only, includes tsx + @excalimore/types via symlink).
COPY --from=prod-deps /repo/node_modules /repo/node_modules
COPY --from=prod-deps /repo/package.json /repo/package.json
COPY --from=prod-deps /repo/pnpm-workspace.yaml /repo/pnpm-workspace.yaml
COPY --from=prod-deps /repo/apps/api/node_modules /repo/apps/api/node_modules
COPY --from=prod-deps /repo/apps/api/package.json /repo/apps/api/package.json
# types package: take node_modules from prod-deps (symlink resolution)
# and the actual src/ from build (the resolved entrypoint per package.json).
COPY --from=prod-deps /repo/packages/types/node_modules /repo/packages/types/node_modules
COPY --from=prod-deps /repo/packages/types/package.json /repo/packages/types/package.json
COPY --from=build /repo/packages/types/src /repo/packages/types/src
# TS source (executed by tsx) plus pre-built dist (proof of typecheck).
COPY --from=build /repo/apps/api/src /repo/apps/api/src
COPY --from=build /repo/apps/api/dist /repo/apps/api/dist
COPY --from=build /repo/apps/api/drizzle /repo/apps/api/drizzle
COPY --from=build /repo/apps/api/tsconfig.json /repo/apps/api/tsconfig.json
COPY --from=build /repo/apps/api/tsconfig.build.json /repo/apps/api/tsconfig.build.json

EXPOSE 3000
# Run migrations once, then start the API server.
CMD ["sh", "-c", "node_modules/.bin/tsx src/db/migrate.ts && node_modules/.bin/tsx src/index.ts"]
