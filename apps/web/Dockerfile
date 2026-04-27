# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22-alpine
ARG NGINX_VERSION=1.27-alpine

# ---- build stage ----
FROM node:${NODE_VERSION} AS build
WORKDIR /repo
RUN apk add --no-cache python3 make g++ libc6-compat
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
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
