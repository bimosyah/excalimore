# Auth in Excalimore

This document describes how authentication works for operators (people running Excalimore) and contributors (people reading the source).

## Concepts

- **Bootstrap token** — issued once when the database has no users. Lets the very first operator create the admin account.
- **Invite token** — created by an admin. Single-use. Optionally pre-grants a scene to whoever consumes it.
- **Session** — random 32-byte token stored in a DB-backed `sessions` table. Carried in the `excalimore_session` HttpOnly cookie.
- **CSRF token** — random per-session token in the (non-HttpOnly) `excalimore_csrf` cookie. Frontend must echo it as the `X-CSRF-Token` header on every authenticated mutating request.

## First-run bootstrap

When the API container starts and the `users` table is empty, it prints a one-time URL to stdout:

```
==========================================================
No users found. Bootstrap admin via:
  https://excalimore.example.com/signup?bootstrap=<token>
  (valid for 3600 seconds)
==========================================================
```

Visit the URL, set email + password + name, and the first user is created with role `admin`. Subsequent boots skip this step.

## Invite flow (admin)

1. `POST /api/auth/invite` with optional `{ sceneId, permission }`.
2. Backend returns `{ token, url }` where `url` is `${PUBLIC_URL}/signup?token=...`.
3. Share the URL with the invitee through any channel.
4. Invitee opens the URL, enters email + password + name, and signs up.

## Endpoints

| Method | Path | CSRF | Notes |
|---|---|---|---|
| POST | `/api/auth/signup` | — | Body `{ token, email, password, name }` — token is invite OR bootstrap. Pre-auth. |
| POST | `/api/auth/login` | — | Body `{ email, password }`. Sets session cookie. Pre-auth. |
| POST | `/api/auth/logout` | required | Invalidates session and clears cookies. |
| GET  | `/api/auth/me` | — (GET) | Requires session. Returns current user. |
| POST | `/api/auth/invite` | required | Admin only. Body `{ sceneId?, permission?, expiresAt? }`. |

## Cookies

| Name | HttpOnly | Purpose |
|---|---|---|
| `excalimore_session` | yes | Carries the session id. Lives for `SESSION_MAX_AGE` seconds (default 30 days). |
| `excalimore_csrf` | **no** | Read by frontend JS to populate the `X-CSRF-Token` header. |

`SameSite=Lax`, `Secure` when `PUBLIC_URL` is HTTPS.

## CSRF model

Double-submit cookie pattern, applied only to authenticated mutating requests:

1. Frontend reads `excalimore_csrf` cookie.
2. Frontend includes the value as the `X-CSRF-Token` header.
3. Server compares the cookie ↔ header with `crypto.timingSafeEqual`.

Public auth establishment endpoints (`/signup`, `/login`) skip CSRF — there is no authenticated state to forge there yet. `SameSite=Lax` blocks cross-origin POSTs from being sent with the cookie at all, providing a second layer.

## Rate limits

- `/api/auth/login` and `/api/auth/signup`: 5 requests / minute / IP.
- All other authenticated endpoints: 60 requests / minute / user (Phase 3).

In-memory only; multi-instance deployments need a shared store.

## Password policy

- Stored as argon2id (`memoryCost=19456 KiB`, `timeCost=2`, `parallelism=1`).
- Minimum 8 characters at the schema layer (`SignupRequestSchema`).
- No upper bound on entropy — pick a passphrase, not a password.

## What we deliberately did not build (yet)

- Forgot-password (no SMTP infra in MVP). Workaround: admin resets via DB / future CLI.
- Email verification (invite link is implicit verification).
- OAuth providers.
- 2FA / TOTP / passkeys.
- Logout-all-devices.
- Self-serve password change UI.

These are additive on top of the existing schema.
