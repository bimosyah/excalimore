# Excalimore API

All endpoints under `/api`. JSON in, JSON out. Session cookie auth (see [`auth.md`](./auth.md)).

## Conventions

- **Status codes** — `200` for success, `401` unauthorized, `403` forbidden, `404` not found, `409` conflict, `422` invalid input, `429` rate-limited.
- **CSRF** — required on all mutating methods (POST/PATCH/DELETE) for authenticated requests. Frontend reads `excalimore_csrf` cookie and echoes it as the `X-CSRF-Token` header.
- **Errors** — uniform shape `{ "error": "<code>", "message": "<human>" }`.
- **Timestamps** — ISO 8601 UTC strings.

## Folders

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/folders` | session | List folders owned by caller. |
| POST | `/api/folders` | owner | `{ name, parentId? }` — create a folder. Nesting capped at 5. |
| PATCH | `/api/folders/:id` | owner | `{ name?, parentId? }` — rename or move. |
| DELETE | `/api/folders/:id` | owner | Cascades to child folders. |

## Scenes

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/scenes` | session | List own scenes. `?folder_id=` filters by folder. `?shared=true` returns scenes shared with caller (with `permission` field). |
| POST | `/api/scenes` | owner | `{ name, folderId? }` — create empty scene. |
| GET | `/api/scenes/:id` | view+ | Returns full scene including `data` (Excalidraw JSON). |
| PATCH | `/api/scenes/:id` | edit (data) / owner (name, folderId) | Update fields. Triggers `scene.updated` SSE event when `data` changes. |
| DELETE | `/api/scenes/:id` | owner | Permanent. |

### Sharing

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/scenes/:id/grants` | owner | List grants on the scene. |
| POST | `/api/scenes/:id/grants` | owner | `{ userId, permission: 'view' \| 'edit' }`. Returns 409 if already shared. |
| DELETE | `/api/scenes/:id/grants/:grantId` | owner | Revoke a grant. |

## Comments

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/scenes/:id/comments` | view+ | List comments. `?include_resolved=true` to include resolved. |
| POST | `/api/scenes/:id/comments` | view+ | `{ elementId, xOffset?, yOffset?, lastKnownX?, lastKnownY?, body }`. Triggers `comment.created` SSE event. |
| PATCH | `/api/comments/:id` | author or scene owner | `{ body?, resolved? }`. Triggers `comment.updated` or `comment.resolved` SSE event. |
| DELETE | `/api/comments/:id` | author or scene owner | Permanent. |

## Events (SSE)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/events?scene_id=:id` | view+ | Server-Sent Events stream for the scene. |

Event types streamed: `comment.created`, `comment.updated`, `comment.resolved`, `scene.updated`. Plus `ready` (one-time on connect) and `ping` heartbeats every 15 seconds.

The browser-native `EventSource` reconnects automatically on disconnect; expect a brief gap during which events may be missed — the client should refetch the comment list on reconnect to reconcile.

The broker is **in-memory**, so this only works correctly with a single API instance. Multi-replica deployments need a shared broker (Redis pub/sub or Postgres `LISTEN/NOTIFY`).

## Access control roles

```
admin ⊇ owner ⊇ edit ⊇ view ⊇ session
```

| Role | Capabilities |
|---|---|
| `owner` | Created the resource. All operations on their scene/folders. Implicitly `edit` and `view`. |
| `edit` | Has `share_grants.permission='edit'`. Read scene, save scene `data`, manage own comments. Cannot rename/move/delete the scene. |
| `view` | Has `share_grants.permission='view'`. Read scene + comments, **create** own comments. Cannot save scene data, cannot edit/delete others' comments. |
| `session` | Any authenticated user. |
| `admin` | `users.role='admin'`. Currently used only by `/api/auth/invite` (invite generation). |

`view` users can author comments deliberately — feedback is the primary reason a viewer opens a shared scene.
