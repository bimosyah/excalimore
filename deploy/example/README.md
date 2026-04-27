# Excalimore — Deploy Example

Generic [Docker Compose](https://docs.docker.com/compose/) recipe for self-hosters. Brings up three containers — `excalimore-web` (nginx), `excalimore-api` (Hono), and `excalimore-db` (Postgres 17) — using the published images at `ghcr.io/bimosyah/excalimore-{web,api}`.

## Prerequisites

- Docker Engine 24+ and the Compose v2 plugin
- A reverse proxy in front of the stack (Caddy / Traefik / nginx) terminating TLS and routing on the deployer's chosen domain
- An open egress to `ghcr.io` to pull images

## Quick start

```bash
cp .env.example .env
$EDITOR .env             # set DATABASE_URL, SESSION_SECRET, PUBLIC_URL, DB_PASSWORD
docker compose up -d
docker compose logs -f excalimore-api
```

The first time the API container starts, it discovers there are no users in the database and prints a one-time bootstrap signup URL — for example:

```
==========================================================
No users found. Bootstrap admin via:
  https://excalimore.example.com/signup?bootstrap=<token>
  (valid for 3600 seconds)
==========================================================
```

Open that URL in your browser within `BOOTSTRAP_TOKEN_TTL` seconds (default: 1 hour) to claim the admin account. Once consumed, subsequent starts will not print another bootstrap URL.

## Reverse-proxy routing

Excalimore runs as two services on one origin via path-based routing. Send `/api/*` and `/events*` to the API container; everything else to the web container. With Caddy, that's a six-line block:

```
excalimore.example.com {
    @api path /api/* /events*
    handle @api { reverse_proxy 127.0.0.1:8081 }
    handle      { reverse_proxy 127.0.0.1:8080 }
}
```

If you prefer to run web and api on separate origins (e.g. `excalimore.example.com` and `api.excalimore.example.com`), you'll need to set up CORS and adjust the session-cookie domain — out of scope for this MVP.

## Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Full Postgres URL. The host part should match the `excalimore-db` service name when using this compose. |
| `DB_PASSWORD` | yes | — | Postgres user password. Must agree with `DATABASE_URL`. |
| `SESSION_SECRET` | yes | — | 32+ random bytes. `openssl rand -hex 32`. |
| `PUBLIC_URL` | yes | — | The exact origin the browser uses, no trailing slash. |
| `TAG` | no | `latest` | Pin to a specific release in production, e.g. `v0.2.0`. |
| `WEB_PORT` | no | `8080` | Host port for the web container. |
| `API_PORT` | no | `8081` | Host port for the API container. |
| `RATE_LIMIT_LOGIN` | no | `5` | Logins per minute per IP. |
| `SESSION_MAX_AGE` | no | `2592000` | Session cookie max-age (seconds). |
| `BOOTSTRAP_TOKEN_TTL` | no | `3600` | First-run admin signup window (seconds). |

## Migrations

The API image runs Drizzle migrations idempotently before binding the HTTP port (`node dist/db/migrate.js && node dist/index.js`). No manual migration step is needed; just `docker compose pull && docker compose up -d` to update.

## Backups

Postgres data lives in the named volume `excalimore-pgdata`. Back it up with `pg_dump`:

```bash
docker compose exec excalimore-db pg_dump -U excalimore excalimore > backup-$(date +%F).sql
```

## Troubleshooting

- **Bootstrap URL never appears in logs** — the API container couldn't reach the DB. Check `docker compose logs excalimore-api` for connection errors and verify `DATABASE_URL` and `DB_PASSWORD` agree.
- **Cookie not persisting** — `PUBLIC_URL` must match the exact origin the browser sees (scheme + host + port). Mismatched origins drop the `Secure`/`SameSite=Lax` cookie.
- **Images won't pull** — confirm `ghcr.io/bimosyah/excalimore-{web,api}` is public (or that you've logged in via `docker login ghcr.io`).
