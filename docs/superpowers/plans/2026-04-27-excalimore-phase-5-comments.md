# Excalimore Implementation Plan — Phase 5: Anchored Comment Overlay

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layer anchored comments on top of the Excalidraw editor introduced in Phase 4. Owners and viewers can pin a comment to any element, see it follow the camera as the canvas pans/zooms, browse all comments in a sidebar, jump to a specific pin, and resolve comments. Pins update in real-time across browser tabs via the Phase-3 SSE channel.

**Architecture:** A new `<CommentOverlay />` React layer is rendered as a sibling of `<Excalidraw />` (never a child — never fork the editor). The overlay reads `excalidrawAPI.getAppState()` viewport state and recomputes screen-space pin positions on every Excalidraw `onChange`. Comments live in the `comments` table (Phase 3); the web app only consumes `/api/scenes/:id/comments`, `/api/comments/:id`, and `/api/events?scene_id=`. No backend changes are made in Phase 5.

**Tech Stack:** Same as Phase 4 — TanStack Query for the comment list cache, browser-native `EventSource` for SSE, React state for the composer FSM. Inline styles plus a small extension of `apps/web/src/styles/app.css` for the overlay/sidebar.

**Spec reference:** [`../specs/2026-04-27-excalimore-design.md`](../specs/2026-04-27-excalimore-design.md), §7 (Comment overlay mechanism). §5 covers the `comments` table; §6 the API surface; §10 the testing strategy.

**Phase 4 prerequisite:** `_authed.scenes.$id.tsx` mounts `<Excalidraw />` and saves with debounce. We extend that route with the overlay sibling without changing its save behaviour.

---

## Phase 5 File Structure

```
apps/web/
├── src/
│   ├── api/
│   │   └── comments.ts                 # NEW — useComments / useCreateComment / useUpdateComment / useDeleteComment
│   ├── lib/
│   │   ├── comment-coords.ts           # NEW — pure scene→screen transform + clamp helpers
│   │   └── comment-events.ts           # NEW — typed EventSource subscriber
│   ├── routes/
│   │   ├── _authed.scenes.$id.tsx      # MODIFY — mount sibling overlay + sidebar
│   │   └── -components/
│   │       ├── CommentOverlay.tsx      # NEW — pin layer, composer, off-screen indicators
│   │       ├── CommentPin.tsx          # NEW — single (or clustered) pin badge + popover
│   │       ├── CommentComposer.tsx     # NEW — FSM idle → pick-element → composing → POST
│   │       ├── CommentSidebar.tsx      # NEW — list + filter + click-to-pan
│   │       └── OffscreenIndicator.tsx  # NEW — edge chip pointing toward off-viewport pins
│   └── styles/
│       └── app.css                     # MODIFY — add .comment-* rules
├── tests/
│   ├── lib/
│   │   ├── comment-coords.test.ts      # NEW — coordinate transform unit tests
│   │   └── comment-events.test.ts      # NEW — SSE subscriber unit tests
│   └── api/
│       └── comments.test.ts            # NEW — API hook contract test (mocked fetch)
└── e2e/
    ├── fixtures.ts                     # MODIFY — add placeComment helper
    └── comments.spec.ts                # NEW — anchored comment placement + persistence
```

---

## Tasks

### Task 1: Coordinate transform utility + tests

**Files:**
- Create: `apps/web/src/lib/comment-coords.ts`
- Create: `apps/web/tests/lib/comment-coords.test.ts`

The pin-positioning math is the load-bearing piece: scene-space → screen-space conversion, plus clamping for extreme zoom. Pure functions, no React, fully unit-testable.

- [ ] **Step 1: Write failing tests**

`apps/web/tests/lib/comment-coords.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  clampPinSize,
  isOnScreen,
  sceneToScreen,
} from '../../src/lib/comment-coords'

describe('sceneToScreen', () => {
  it('applies scrollX/scrollY offset and zoom', () => {
    expect(sceneToScreen({ sceneX: 100, sceneY: 200 }, { scrollX: 50, scrollY: 25, zoom: 2 })).toEqual({
      screenX: (100 + 50) * 2,
      screenY: (200 + 25) * 2,
    })
  })

  it('handles zero zoom safely (treats as 1)', () => {
    expect(sceneToScreen({ sceneX: 10, sceneY: 10 }, { scrollX: 0, scrollY: 0, zoom: 0 })).toEqual({
      screenX: 10,
      screenY: 10,
    })
  })
})

describe('clampPinSize', () => {
  it('clamps to 16px floor', () => {
    expect(clampPinSize(0.1)).toBe(16)
  })
  it('clamps to 32px ceiling', () => {
    expect(clampPinSize(10)).toBe(32)
  })
  it('passes through reasonable zoom 1', () => {
    expect(clampPinSize(1)).toBeGreaterThanOrEqual(16)
    expect(clampPinSize(1)).toBeLessThanOrEqual(32)
  })
})

describe('isOnScreen', () => {
  it('true when inside the viewport', () => {
    expect(isOnScreen({ screenX: 100, screenY: 100 }, { width: 800, height: 600 })).toBe(true)
  })
  it('false when off the right edge', () => {
    expect(isOnScreen({ screenX: 900, screenY: 100 }, { width: 800, height: 600 })).toBe(false)
  })
  it('false when off the top edge', () => {
    expect(isOnScreen({ screenX: 10, screenY: -10 }, { width: 800, height: 600 })).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests (fail)**

`pnpm --filter @excalimore/web test` → import errors.

- [ ] **Step 3: Implement**

`apps/web/src/lib/comment-coords.ts`:

```ts
export interface ScenePoint { sceneX: number; sceneY: number }
export interface ScreenPoint { screenX: number; screenY: number }
export interface Viewport { scrollX: number; scrollY: number; zoom: number }
export interface Box { width: number; height: number }

const PIN_MIN = 16
const PIN_MAX = 32
const PIN_BASE = 22 // visually pleasant size at zoom 1

export function sceneToScreen(p: ScenePoint, v: Viewport): ScreenPoint {
  // Excalidraw's `scrollX/scrollY` are scene offsets, not DOM scroll. The
  // canonical formula (excalidraw source: src/scene/scrollUtils.ts) is:
  //   screen = (scene + scrollOffset) * zoom
  const zoom = v.zoom > 0 ? v.zoom : 1
  return {
    screenX: (p.sceneX + v.scrollX) * zoom,
    screenY: (p.sceneY + v.scrollY) * zoom,
  }
}

export function clampPinSize(zoom: number): number {
  const target = PIN_BASE * zoom
  if (target < PIN_MIN) return PIN_MIN
  if (target > PIN_MAX) return PIN_MAX
  return target
}

export function isOnScreen(p: ScreenPoint, box: Box): boolean {
  return p.screenX >= 0 && p.screenY >= 0 && p.screenX <= box.width && p.screenY <= box.height
}
```

- [ ] **Step 4: Run tests (pass)**

`pnpm --filter @excalimore/web test` → 7 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/comment-coords.ts apps/web/tests/lib/comment-coords.test.ts
git commit -m "feat(web): scene→screen coordinate transform with size clamping"
```

---

### Task 2: SSE subscriber utility + tests

**Files:**
- Create: `apps/web/src/lib/comment-events.ts`
- Create: `apps/web/tests/lib/comment-events.test.ts`

A thin wrapper around `EventSource` that parses payloads with the `SseEventSchema` from `@excalimore/types` and exposes a typed callback. Encapsulating the parsing here means the React layer never touches raw `MessageEvent` data and the unit test can fake an `EventSource` cleanly.

- [ ] **Step 1: Write failing tests**

`apps/web/tests/lib/comment-events.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeToSceneEvents } from '../../src/lib/comment-events'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  readyState = 1
  closed = false
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  close() { this.closed = true }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent) }
}

beforeEach(() => {
  FakeEventSource.instances = []
  ;(globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource = FakeEventSource
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('subscribeToSceneEvents', () => {
  it('opens an EventSource for the scene', () => {
    const onEvent = vi.fn()
    subscribeToSceneEvents('scene-1', onEvent)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0]!.url).toContain('scene_id=scene-1')
  })

  it('parses comment.created and forwards typed payload', () => {
    const onEvent = vi.fn()
    subscribeToSceneEvents('scene-1', onEvent)
    const fake = FakeEventSource.instances[0]!
    const payload = {
      id: '00000000-0000-0000-0000-000000000001',
      sceneId: '00000000-0000-0000-0000-000000000002',
      authorId: '00000000-0000-0000-0000-000000000003',
      elementId: 'el-1',
      xOffset: 0,
      yOffset: 0,
      lastKnownX: 1,
      lastKnownY: 2,
      body: 'hi',
      resolved: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    fake.emit({ type: 'comment.created', payload })
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith({ type: 'comment.created', payload })
  })

  it('ignores non-JSON / unknown event payloads', () => {
    const onEvent = vi.fn()
    subscribeToSceneEvents('scene-1', onEvent)
    const fake = FakeEventSource.instances[0]!
    fake.onmessage?.({ data: 'not json' } as MessageEvent)
    fake.emit({ type: 'mystery.event', payload: {} })
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('returns an unsubscribe that closes the connection', () => {
    const off = subscribeToSceneEvents('scene-1', vi.fn())
    off()
    expect(FakeEventSource.instances[0]!.closed).toBe(true)
  })
})
```

- [ ] **Step 2: Implement**

`apps/web/src/lib/comment-events.ts`:

```ts
import { type SseEvent, SseEventSchema } from '@excalimore/types'

/**
 * Subscribe to per-scene server-sent events. The browser's native EventSource
 * handles reconnection itself; the React caller is expected to refetch the
 * comment list on focus/visibility changes to reconcile any events missed
 * during the gap (per spec §7).
 */
export function subscribeToSceneEvents(
  sceneId: string,
  onEvent: (event: SseEvent) => void,
): () => void {
  const url = `/api/events?scene_id=${encodeURIComponent(sceneId)}`
  const source = new EventSource(url, { withCredentials: true })

  source.onmessage = (msg: MessageEvent) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(msg.data)
    } catch {
      return
    }
    const result = SseEventSchema.safeParse(parsed)
    if (!result.success) return
    onEvent(result.data)
  }

  return () => source.close()
}
```

- [ ] **Step 3: Run tests (pass)**

`pnpm --filter @excalimore/web test` → 4 more tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/comment-events.ts apps/web/tests/lib/comment-events.test.ts
git commit -m "feat(web): typed SSE subscriber for scene comment events"
```

---

### Task 3: Comment API hooks + tests

**Files:**
- Create: `apps/web/src/api/comments.ts`
- Create: `apps/web/tests/api/comments.test.ts`

Mirror the patterns in `apps/web/src/api/scenes.ts`: a `useComments(sceneId, opts)` query, a `useCreateComment(sceneId)` mutation, and `useUpdateComment` / `useDeleteComment` mutations. The list cache key is `['comments', sceneId, includeResolved]` so SSE-driven mutations and explicit reloads share a single cache entry.

- [ ] **Step 1: Write failing tests**

`apps/web/tests/api/comments.test.ts` exercises just the URL/payload contract via mocked fetch. The list hook isn't tested directly (React Query setup overhead) — its behaviour is covered by the e2e test in Task 9.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commentEndpoints } from '../../src/api/comments'

beforeEach(() => {
  document.cookie = 'excalimore_csrf=test-csrf; path=/'
})
afterEach(() => {
  document.cookie = 'excalimore_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
  vi.restoreAllMocks()
})

describe('commentEndpoints', () => {
  it('list URL omits include_resolved when false', () => {
    expect(commentEndpoints.list('s1', { includeResolved: false })).toBe('/api/scenes/s1/comments')
  })
  it('list URL adds include_resolved=true when true', () => {
    expect(commentEndpoints.list('s1', { includeResolved: true })).toBe(
      '/api/scenes/s1/comments?include_resolved=true',
    )
  })
  it('create URL is /scenes/:id/comments', () => {
    expect(commentEndpoints.create('s1')).toBe('/api/scenes/s1/comments')
  })
  it('item URL is /comments/:id', () => {
    expect(commentEndpoints.item('c1')).toBe('/api/comments/c1')
  })
})
```

- [ ] **Step 2: Implement**

`apps/web/src/api/comments.ts`:

```ts
import {
  CommentSchema,
  type CreateCommentRequestSchema,
  type UpdateCommentRequestSchema,
} from '@excalimore/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { z } from 'zod'
import { z as zod } from 'zod'
import { apiFetch } from './client'

const ListResponseSchema = zod.object({ comments: zod.array(CommentSchema) })
const CreateResponseSchema = zod.object({ comment: CommentSchema })
const OkSchema = zod.object({ ok: zod.boolean() })

export type CommentListOptions = { includeResolved?: boolean }

export const commentEndpoints = {
  list: (sceneId: string, opts: CommentListOptions = {}): string => {
    const base = `/api/scenes/${sceneId}/comments`
    return opts.includeResolved ? `${base}?include_resolved=true` : base
  },
  create: (sceneId: string): string => `/api/scenes/${sceneId}/comments`,
  item: (id: string): string => `/api/comments/${id}`,
}

export function commentsQueryKey(sceneId: string, opts: CommentListOptions = {}) {
  return ['comments', sceneId, opts.includeResolved ?? false] as const
}

export function useComments(sceneId: string, opts: CommentListOptions = {}) {
  return useQuery({
    queryKey: commentsQueryKey(sceneId, opts),
    queryFn: async () => {
      const data = await apiFetch(commentEndpoints.list(sceneId, opts), { schema: ListResponseSchema })
      return data.comments
    },
    enabled: Boolean(sceneId),
  })
}

export function useCreateComment(sceneId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: z.infer<typeof CreateCommentRequestSchema>) =>
      apiFetch(commentEndpoints.create(sceneId), {
        method: 'POST',
        body: vars,
        schema: CreateResponseSchema,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', sceneId] })
    },
  })
}

export function useUpdateComment(sceneId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; patch: z.infer<typeof UpdateCommentRequestSchema> }) =>
      apiFetch(commentEndpoints.item(vars.id), {
        method: 'PATCH',
        body: vars.patch,
        schema: OkSchema,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', sceneId] })
    },
  })
}

export function useDeleteComment(sceneId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      apiFetch(commentEndpoints.item(id), { method: 'DELETE', schema: OkSchema }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', sceneId] })
    },
  })
}
```

- [ ] **Step 3: Run tests + typecheck (pass)**

```bash
pnpm --filter @excalimore/web test
pnpm --filter @excalimore/web typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/comments.ts apps/web/tests/api/comments.test.ts
git commit -m "feat(web): add comment API hooks (list/create/update/delete)"
```

---

### Task 4: CommentPin component (single + cluster)

**Files:**
- Create: `apps/web/src/routes/-components/CommentPin.tsx`
- Modify: `apps/web/src/styles/app.css` (add `.comment-pin*` rules)

A pin renders one or many comments at a given screen position. Click toggles a popover showing each comment body, the author id (resolved later via /me cache), and a Resolve button (visible only when the viewer authored the comment OR is the scene owner — passed in as a prop). Replies are out of scope for the MVP.

- [ ] **Step 1: Implement `CommentPin.tsx`**

```tsx
import type { Comment } from '@excalimore/types'
import { useState } from 'react'

export interface CommentPinProps {
  comments: Comment[]                  // 1 or N (cluster)
  screenX: number
  screenY: number
  size: number                         // px diameter, clamped by caller
  isOrphan?: boolean                   // element_id missing from scene → red badge
  canResolve: (commentId: string) => boolean
  onResolve: (commentId: string) => void
}

export function CommentPin(props: CommentPinProps) {
  const [open, setOpen] = useState(false)
  const count = props.comments.length

  return (
    <div
      className="comment-pin-wrapper"
      style={{
        left: props.screenX,
        top: props.screenY,
      }}
    >
      <button
        type="button"
        className={`comment-pin${props.isOrphan ? ' is-orphan' : ''}`}
        style={{ width: props.size, height: props.size }}
        onClick={() => setOpen((v) => !v)}
        aria-label={`${count} comment${count > 1 ? 's' : ''}`}
        data-testid="comment-pin"
      >
        {count}
      </button>
      {open && (
        <div className="comment-pin-popover" role="dialog">
          {props.comments.map((c) => (
            <article key={c.id} className="comment-pin-item">
              <p className="comment-pin-body">{c.body}</p>
              {c.resolved ? (
                <span className="muted comment-pin-meta">resolved</span>
              ) : props.canResolve(c.id) ? (
                <button
                  type="button"
                  className="app-link-button"
                  onClick={() => props.onResolve(c.id)}
                >
                  Resolve
                </button>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Append to `apps/web/src/styles/app.css`**

```css
/* Comment overlay (Phase 5) */
.comment-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
}
.comment-pin-wrapper {
  position: absolute;
  pointer-events: auto;
  transform: translate(-50%, -50%);
}
.comment-pin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 2px solid white;
  background: #fab005;
  color: #1a1a1a;
  font-size: 0.75em;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
}
.comment-pin.is-orphan {
  background: #fa5252;
  color: white;
}
.comment-pin-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 220px;
  max-width: 320px;
  background: white;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  padding: 0.5rem;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
  z-index: 11;
}
.comment-pin-item + .comment-pin-item {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid #f0f0f0;
}
.comment-pin-body { margin: 0 0 0.25rem 0; font-size: 0.9em; white-space: pre-wrap; }
.comment-pin-meta { font-size: 0.75em; }

/* Composer popover */
.comment-composer {
  position: absolute;
  pointer-events: auto;
  background: white;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  padding: 0.5rem;
  width: 240px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
  z-index: 12;
  transform: translate(-50%, 0);
}
.comment-composer textarea {
  width: 100%;
  min-height: 60px;
  font: inherit;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 0.4rem;
  resize: vertical;
}
.comment-composer-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 0.4rem;
}

/* Off-screen indicator chip */
.comment-offscreen {
  position: absolute;
  pointer-events: auto;
  background: #1971c2;
  color: white;
  font-size: 0.75em;
  border-radius: 12px;
  padding: 0.15rem 0.5rem;
  cursor: pointer;
  border: none;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
}

/* Sidebar */
.comment-sidebar {
  width: 280px;
  border-left: 1px solid #e5e5e5;
  background: #fafafa;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.comment-sidebar-header {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #e5e5e5;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.comment-sidebar-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem 1rem;
}
.comment-sidebar-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 0.5rem;
  cursor: pointer;
}
.comment-sidebar-item + .comment-sidebar-item { margin-top: 0.25rem; }
.comment-sidebar-item:hover { background: #efefef; border-color: #e5e5e5; }
.comment-sidebar-item.is-orphan { color: #c92a2a; }
.comment-sidebar-empty { color: #6b6b6b; font-size: 0.85em; padding: 0.5rem; }

/* "Add comment" mode hint banner */
.comment-pickmode-banner {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  background: #1971c2;
  color: white;
  padding: 0.4rem 0.8rem;
  border-radius: 6px;
  font-size: 0.85em;
  pointer-events: auto;
  z-index: 13;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/-components/CommentPin.tsx apps/web/src/styles/app.css
git commit -m "feat(web): CommentPin badge + popover with cluster + orphan styling"
```

---

### Task 5: CommentComposer FSM

**Files:**
- Create: `apps/web/src/routes/-components/CommentComposer.tsx`

Implements the spec's FSM: `idle → pick-element (pointer cursor + banner) → composing (textarea popover) → POST → idle`. The composer is a controlled component: `mode`, `target` (clicked element), and `body` are owned by the parent overlay so the parent can also render the corresponding pin position.

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useRef } from 'react'

export type ComposerTarget = {
  elementId: string
  sceneX: number
  sceneY: number
  screenX: number
  screenY: number
}

export interface CommentComposerProps {
  target: ComposerTarget
  body: string
  isSubmitting: boolean
  onChange: (body: string) => void
  onSubmit: () => void
  onCancel: () => void
}

export function CommentComposer(props: CommentComposerProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <div
      className="comment-composer"
      style={{ left: props.target.screenX, top: props.target.screenY + 16 }}
      data-testid="comment-composer"
    >
      <textarea
        ref={ref}
        value={props.body}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="Write a comment…"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            props.onCancel()
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            if (props.body.trim().length > 0) props.onSubmit()
          }
        }}
      />
      <div className="comment-composer-actions">
        <button type="button" className="app-link-button" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="app-button-primary"
          disabled={props.isSubmitting || props.body.trim().length === 0}
          onClick={props.onSubmit}
        >
          {props.isSubmitting ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/routes/-components/CommentComposer.tsx
git commit -m "feat(web): CommentComposer popover with Esc/Cmd+Enter shortcuts"
```

---

### Task 6: OffscreenIndicator component

**Files:**
- Create: `apps/web/src/routes/-components/OffscreenIndicator.tsx`

A chip clamped to the canvas edge nearest to an off-viewport pin. Click pans the canvas to the pin via `excalidrawAPI.scrollToContent` (or by setting `scrollX/scrollY` directly when the API is unavailable).

- [ ] **Step 1: Implement**

```tsx
export interface OffscreenIndicatorProps {
  count: number
  edge: 'top' | 'bottom' | 'left' | 'right'
  /** Position along the edge, in CSS pixels relative to the canvas container. */
  position: number
  onClick: () => void
}

export function OffscreenIndicator(props: OffscreenIndicatorProps) {
  const style: React.CSSProperties = (() => {
    switch (props.edge) {
      case 'top':
        return { top: 4, left: props.position, transform: 'translateX(-50%)' }
      case 'bottom':
        return { bottom: 4, left: props.position, transform: 'translateX(-50%)' }
      case 'left':
        return { left: 4, top: props.position, transform: 'translateY(-50%)' }
      case 'right':
        return { right: 4, top: props.position, transform: 'translateY(-50%)' }
    }
  })()

  return (
    <button
      type="button"
      className="comment-offscreen"
      style={style}
      onClick={props.onClick}
      data-testid="comment-offscreen"
    >
      {props.count} ↗
    </button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/routes/-components/OffscreenIndicator.tsx
git commit -m "feat(web): OffscreenIndicator edge chip for off-viewport pins"
```

---

### Task 7: CommentSidebar list + filters

**Files:**
- Create: `apps/web/src/routes/-components/CommentSidebar.tsx`

Renders the full comment list. Each entry is a button that calls `onSelect(comment)`; the parent handles panning the canvas. A simple "Show resolved" checkbox toggles the `includeResolved` flag, which the parent passes back into `useComments`.

- [ ] **Step 1: Implement**

```tsx
import type { Comment } from '@excalimore/types'

export interface CommentSidebarProps {
  comments: Comment[]
  isLoading: boolean
  includeResolved: boolean
  orphanIds: Set<string> // comment.elementId no longer exists in the scene
  onToggleResolved: (next: boolean) => void
  onSelect: (comment: Comment) => void
  onStartAdd: () => void
  isAdding: boolean
}

export function CommentSidebar(props: CommentSidebarProps) {
  return (
    <aside className="comment-sidebar" aria-label="Comments">
      <header className="comment-sidebar-header">
        <strong>Comments</strong>
        <button
          type="button"
          className="app-link-button"
          onClick={props.onStartAdd}
          aria-pressed={props.isAdding}
          data-testid="comment-add-button"
        >
          {props.isAdding ? 'Cancel' : '+ Comment'}
        </button>
      </header>
      <label
        style={{ padding: '0.5rem 1rem', display: 'flex', gap: '0.5rem', fontSize: '0.85em' }}
      >
        <input
          type="checkbox"
          checked={props.includeResolved}
          onChange={(e) => props.onToggleResolved(e.target.checked)}
        />
        Show resolved
      </label>
      <div className="comment-sidebar-list">
        {props.isLoading ? (
          <p className="comment-sidebar-empty">Loading…</p>
        ) : props.comments.length === 0 ? (
          <p className="comment-sidebar-empty">No comments yet.</p>
        ) : (
          props.comments.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`comment-sidebar-item${props.orphanIds.has(c.id) ? ' is-orphan' : ''}`}
              onClick={() => props.onSelect(c)}
              data-testid="comment-sidebar-item"
            >
              <div style={{ fontSize: '0.9em' }}>{c.body}</div>
              <small className="muted">
                {props.orphanIds.has(c.id) ? '(deleted element) · ' : ''}
                {c.resolved ? 'resolved · ' : ''}
                {new Date(c.createdAt).toLocaleString()}
              </small>
            </button>
          ))
        )}
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/routes/-components/CommentSidebar.tsx
git commit -m "feat(web): CommentSidebar with resolved filter and orphan markers"
```

---

### Task 8: CommentOverlay — composing the layer

**Files:**
- Create: `apps/web/src/routes/-components/CommentOverlay.tsx`

The overlay is the orchestrator. It owns:

1. The Excalidraw API ref + a `tick` counter incremented on every `onChange` so React re-renders pin positions when the viewport changes.
2. The composer FSM state (`'idle' | 'pick-element' | 'composing'`) and `target`/`body`.
3. Cluster computation (group comments by `(elementId, xOffset, yOffset)`).
4. Off-screen detection and the click-to-pan handler.

Excalidraw exposes elements via `api.getSceneElements()` and the viewport via `api.getAppState()`. The container's bounding rect gives us the canvas viewport size.

The "pick element" interaction listens for clicks on the wrapper (capture phase, `pointer-events: none` lets clicks pass through), then walks the scene elements at the click position to find the topmost match.

- [ ] **Step 1: Implement**

```tsx
import type { Comment } from '@excalimore/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type CommentListOptions,
  useComments,
  useCreateComment,
  useUpdateComment,
} from '../../api/comments'
import { clampPinSize, isOnScreen, sceneToScreen } from '../../lib/comment-coords'
import { subscribeToSceneEvents } from '../../lib/comment-events'
import { CommentComposer, type ComposerTarget } from './CommentComposer'
import { CommentPin } from './CommentPin'
import { CommentSidebar } from './CommentSidebar'
import { OffscreenIndicator } from './OffscreenIndicator'

/** Minimal shape we read from Excalidraw — we don't depend on the editor's strict types. */
export type ExcalidrawApiLite = {
  getAppState: () => { scrollX: number; scrollY: number; zoom: { value: number } }
  getSceneElements: () => readonly { id: string; x: number; y: number; width: number; height: number; isDeleted?: boolean }[]
  scrollToContent?: (target: unknown, opts?: { fitToViewport?: boolean }) => void
  updateScene?: (data: { appState: { scrollX: number; scrollY: number } }) => void
}

export interface CommentOverlayProps {
  sceneId: string
  /** Mutable ref the parent populates with the Excalidraw API once mounted. */
  apiRef: React.MutableRefObject<ExcalidrawApiLite | null>
  /** Bumped every time Excalidraw's onChange fires so positions recompute. */
  tick: number
  /** Logged-in user id; used to decide author-only resolve permission. */
  currentUserId: string
  /** True when current user owns the scene (also implies resolve permission). */
  isOwner: boolean
}

type ComposerState =
  | { mode: 'idle' }
  | { mode: 'pick-element' }
  | { mode: 'composing'; target: ComposerTarget; body: string }

export function CommentOverlay(props: CommentOverlayProps) {
  const [includeResolved, setIncludeResolved] = useState(false)
  const opts: CommentListOptions = { includeResolved }
  const commentsQ = useComments(props.sceneId, opts)
  const createMutation = useCreateComment(props.sceneId)
  const updateMutation = useUpdateComment(props.sceneId)
  const [composer, setComposer] = useState<ComposerState>({ mode: 'idle' })
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Refetch on reconnect / focus to reconcile any missed SSE events.
  useEffect(() => {
    const refetch = () => {
      commentsQ.refetch()
    }
    window.addEventListener('focus', refetch)
    document.addEventListener('visibilitychange', refetch)
    return () => {
      window.removeEventListener('focus', refetch)
      document.removeEventListener('visibilitychange', refetch)
    }
  }, [commentsQ])

  // Subscribe to SSE: any comment event invalidates the cached list. Keeping
  // the merge logic centralised in React Query (refetch) is simpler than
  // splicing each event into local state and avoids drift between the SSE
  // payload schema and the list payload schema.
  useEffect(() => {
    const off = subscribeToSceneEvents(props.sceneId, () => {
      commentsQ.refetch()
    })
    return off
  }, [props.sceneId, commentsQ])

  const viewport = useMemo(() => {
    const api = props.apiRef.current
    if (!api) return null
    const s = api.getAppState()
    return { scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value }
    // tick is a cache-buster: when Excalidraw re-renders we want fresh viewport state.
  }, [props.apiRef, props.tick])

  const elementMap = useMemo(() => {
    const map = new Map<string, { id: string; x: number; y: number; width: number; height: number }>()
    const api = props.apiRef.current
    if (!api) return map
    for (const el of api.getSceneElements()) {
      if (el.isDeleted) continue
      map.set(el.id, { id: el.id, x: el.x, y: el.y, width: el.width, height: el.height })
    }
    return map
  }, [props.apiRef, props.tick])

  // Build per-comment screen coordinates and orphan flags.
  type Plotted = {
    comment: Comment
    sceneX: number
    sceneY: number
    screenX: number
    screenY: number
    isOrphan: boolean
  }
  const plotted: Plotted[] = useMemo(() => {
    if (!viewport || !commentsQ.data) return []
    return commentsQ.data.map((c) => {
      const el = elementMap.get(c.elementId)
      let sceneX: number
      let sceneY: number
      let isOrphan = false
      if (el) {
        sceneX = el.x + c.xOffset
        sceneY = el.y + c.yOffset
      } else {
        // Fall back to last known scene position (spec §7 edge case 1).
        sceneX = c.lastKnownX ?? 0
        sceneY = c.lastKnownY ?? 0
        isOrphan = true
      }
      const { screenX, screenY } = sceneToScreen({ sceneX, sceneY }, viewport)
      return { comment: c, sceneX, sceneY, screenX, screenY, isOrphan }
    })
  }, [commentsQ.data, elementMap, viewport])

  // Cluster overlapping pins (within ~12px on screen).
  type Cluster = { key: string; comments: Comment[]; screenX: number; screenY: number; isOrphan: boolean }
  const clusters: Cluster[] = useMemo(() => {
    const out: Cluster[] = []
    const eps = 12
    for (const p of plotted) {
      const found = out.find(
        (c) => Math.abs(c.screenX - p.screenX) < eps && Math.abs(c.screenY - p.screenY) < eps,
      )
      if (found) {
        found.comments.push(p.comment)
        found.isOrphan = found.isOrphan || p.isOrphan
      } else {
        out.push({
          key: p.comment.id,
          comments: [p.comment],
          screenX: p.screenX,
          screenY: p.screenY,
          isOrphan: p.isOrphan,
        })
      }
    }
    return out
  }, [plotted])

  const containerBox = useMemo(() => {
    const r = containerRef.current?.getBoundingClientRect()
    return { width: r?.width ?? 0, height: r?.height ?? 0 }
    // tick included so we recompute when Excalidraw resizes.
  }, [props.tick])

  const orphanIds = useMemo(() => new Set(plotted.filter((p) => p.isOrphan).map((p) => p.comment.id)), [plotted])

  const onScreenClusters = clusters.filter((c) => isOnScreen({ screenX: c.screenX, screenY: c.screenY }, containerBox))
  const offScreenClusters = clusters.filter((c) => !isOnScreen({ screenX: c.screenX, screenY: c.screenY }, containerBox))

  const pinSize = clampPinSize(viewport?.zoom ?? 1)

  const panToScene = useCallback(
    (sceneX: number, sceneY: number) => {
      const api = props.apiRef.current
      if (!api) return
      // Centre the target in the viewport. Excalidraw's scrollX/scrollY are
      // scene offsets; to centre `sceneX` at half the canvas width:
      //   (sceneX + scrollX) * zoom = width / 2  →  scrollX = width/(2*zoom) - sceneX
      const state = api.getAppState()
      const z = state.zoom.value > 0 ? state.zoom.value : 1
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const newScrollX = rect.width / (2 * z) - sceneX
      const newScrollY = rect.height / (2 * z) - sceneY
      api.updateScene?.({ appState: { scrollX: newScrollX, scrollY: newScrollY } })
    },
    [props.apiRef],
  )

  const onSelectFromSidebar = useCallback(
    (c: Comment) => {
      const p = plotted.find((x) => x.comment.id === c.id)
      if (p) panToScene(p.sceneX, p.sceneY)
    },
    [plotted, panToScene],
  )

  const startAdd = useCallback(() => {
    setComposer((s) => (s.mode === 'idle' ? { mode: 'pick-element' } : { mode: 'idle' }))
  }, [])

  const cancelComposer = useCallback(() => setComposer({ mode: 'idle' }), [])

  // Pick-element: handle a click on the wrapper (we re-enable pointer-events
  // for this transient layer). Walk scene elements to find the topmost hit at
  // the click point, then transition to "composing" anchored on that element.
  const handlePickClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const api = props.apiRef.current
      const rect = containerRef.current?.getBoundingClientRect()
      if (!api || !rect || !viewport) return
      const cssX = e.clientX - rect.left
      const cssY = e.clientY - rect.top
      // Inverse of sceneToScreen: scene = (screen / zoom) - scrollOffset.
      const z = viewport.zoom > 0 ? viewport.zoom : 1
      const sceneX = cssX / z - viewport.scrollX
      const sceneY = cssY / z - viewport.scrollY
      let hit: { id: string; x: number; y: number } | null = null
      for (const el of api.getSceneElements()) {
        if (el.isDeleted) continue
        if (sceneX >= el.x && sceneX <= el.x + el.width && sceneY >= el.y && sceneY <= el.y + el.height) {
          hit = { id: el.id, x: el.x, y: el.y }
        }
      }
      if (!hit) return
      const target: ComposerTarget = {
        elementId: hit.id,
        sceneX: hit.x,
        sceneY: hit.y,
        screenX: cssX,
        screenY: cssY,
      }
      setComposer({ mode: 'composing', target, body: '' })
    },
    [props.apiRef, viewport],
  )

  const submitComposer = useCallback(async () => {
    if (composer.mode !== 'composing') return
    const target = composer.target
    const body = composer.body.trim()
    if (!body) return
    try {
      await createMutation.mutateAsync({
        elementId: target.elementId,
        xOffset: 0,
        yOffset: 0,
        body,
        lastKnownX: target.sceneX,
        lastKnownY: target.sceneY,
      })
      setComposer({ mode: 'idle' })
    } catch (err) {
      console.error('failed to create comment:', err)
    }
  }, [composer, createMutation])

  const canResolve = useCallback(
    (commentId: string) => {
      const c = commentsQ.data?.find((x) => x.id === commentId)
      if (!c) return false
      return props.isOwner || c.authorId === props.currentUserId
    },
    [commentsQ.data, props.isOwner, props.currentUserId],
  )

  const onResolve = useCallback(
    (commentId: string) => {
      updateMutation.mutate({ id: commentId, patch: { resolved: true } })
    },
    [updateMutation],
  )

  const overlayPointerEvents: React.CSSProperties =
    composer.mode === 'pick-element' ? { pointerEvents: 'auto', cursor: 'crosshair' } : {}

  return (
    <>
      <div
        ref={containerRef}
        className="comment-overlay"
        style={overlayPointerEvents}
        onClick={composer.mode === 'pick-element' ? handlePickClick : undefined}
        data-testid="comment-overlay"
      >
        {composer.mode === 'pick-element' && (
          <div className="comment-pickmode-banner">
            Click any element to attach a comment · Esc to cancel
          </div>
        )}
        {onScreenClusters.map((cl) => (
          <CommentPin
            key={cl.key}
            comments={cl.comments}
            screenX={cl.screenX}
            screenY={cl.screenY}
            size={pinSize}
            isOrphan={cl.isOrphan}
            canResolve={canResolve}
            onResolve={onResolve}
          />
        ))}
        {offScreenClusters.map((cl) => {
          // Pick the edge nearest the pin and clamp the chip position along it.
          const w = containerBox.width || 1
          const h = containerBox.height || 1
          let edge: 'top' | 'bottom' | 'left' | 'right'
          let position: number
          if (cl.screenX < 0) {
            edge = 'left'
            position = Math.max(20, Math.min(h - 20, cl.screenY))
          } else if (cl.screenX > w) {
            edge = 'right'
            position = Math.max(20, Math.min(h - 20, cl.screenY))
          } else if (cl.screenY < 0) {
            edge = 'top'
            position = Math.max(20, Math.min(w - 20, cl.screenX))
          } else {
            edge = 'bottom'
            position = Math.max(20, Math.min(w - 20, cl.screenX))
          }
          return (
            <OffscreenIndicator
              key={`off-${cl.key}`}
              count={cl.comments.length}
              edge={edge}
              position={position}
              onClick={() => {
                const p = plotted.find((x) => x.comment.id === cl.comments[0]!.id)
                if (p) panToScene(p.sceneX, p.sceneY)
              }}
            />
          )
        })}
        {composer.mode === 'composing' && (
          <CommentComposer
            target={composer.target}
            body={composer.body}
            isSubmitting={createMutation.isPending}
            onChange={(body) => setComposer((s) => (s.mode === 'composing' ? { ...s, body } : s))}
            onCancel={cancelComposer}
            onSubmit={submitComposer}
          />
        )}
      </div>
      <CommentSidebar
        comments={commentsQ.data ?? []}
        isLoading={commentsQ.isLoading}
        includeResolved={includeResolved}
        orphanIds={orphanIds}
        onToggleResolved={setIncludeResolved}
        onSelect={onSelectFromSidebar}
        onStartAdd={startAdd}
        isAdding={composer.mode !== 'idle'}
      />
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/routes/-components/CommentOverlay.tsx
git commit -m "feat(web): CommentOverlay orchestrator (pins, composer FSM, SSE)"
```

---

### Task 9: Wire the overlay into the scene editor route

**Files:**
- Modify: `apps/web/src/routes/_authed.scenes.$id.tsx`
- Modify: `apps/web/src/api/auth.ts` (export `useMe` is already present — re-verify)

The editor route already mounts `<Excalidraw />`. We extend it to:

1. Capture the `excalidrawAPI` via the `excalidrawAPI` callback prop.
2. Bump a `tick` counter on every `onChange` so the overlay re-renders.
3. Lay out: header → flex row of `[canvas + overlay] | sidebar`.

We **do not** alter the existing save logic; the comment overlay is a sibling layer that observes Excalidraw's state, never mutates `scenes.data`.

- [ ] **Step 1: Modify `_authed.scenes.$id.tsx`**

Changes vs. Phase 4:

- Import `useMe` and `CommentOverlay`.
- Add `apiRef = useRef<ExcalidrawApiLite | null>(null)` and `[tick, setTick] = useState(0)`.
- In `handleChange`, call `setTick((t) => t + 1)` *before* the existing fingerprint check so viewport changes also bump the overlay.
- Replace the `<div style={{ flex: 1, position: 'relative' }}>` block with a flex row:

```tsx
<div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
  <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
    <Excalidraw
      excalidrawAPI={(api) => {
        apiRef.current = api as unknown as ExcalidrawApiLite
      }}
      initialData={initialData as never}
      onChange={canEdit ? (handleChange as never) : (handleViewportChange as never)}
      viewModeEnabled={!canEdit}
      theme="light"
    />
    {meQ.data && (
      <CommentOverlay
        sceneId={id}
        apiRef={apiRef}
        tick={tick}
        currentUserId={meQ.data.id}
        isOwner={role === undefined || role === 'owner'}
      />
    )}
  </div>
  {meQ.data && (
    <CommentOverlaySidebarPlaceholder /* sidebar is rendered by CommentOverlay too */ />
  )}
</div>
```

Wait — the overlay component already renders the sidebar. So the layout is simpler: render `<CommentOverlay>` after `<Excalidraw>` and let it position itself inside the same flex parent. Update the JSX accordingly (one positioned sibling div for the overlay layer + the sidebar at flex-end). Final shape:

```tsx
<div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
  <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
    <Excalidraw … />
    {/* overlay fills this same parent absolutely */}
    {meQ.data && (
      <CommentOverlay
        sceneId={id}
        apiRef={apiRef}
        tick={tick}
        currentUserId={meQ.data.id}
        isOwner={role === undefined || role === 'owner'}
      />
    )}
  </div>
</div>
```

`CommentOverlay` returns a fragment of two siblings: `<div className="comment-overlay">` (absolute, `inset: 0` over the canvas) and `<aside className="comment-sidebar">`. Put `position: relative` on the parent flex row and `display: flex` so the sidebar lays out next to the canvas wrapper. To make this work with one fragment, render the overlay *inside* the canvas wrapper for the absolute layer and the sidebar as a flex sibling. Cleanest is to split the overlay into two top-level pieces in the parent, but to minimise the diff we render the overlay component once and let it portal the sidebar via the same fragment — flexbox sees both top-level returns as siblings to the canvas wrapper because we move the overlay to a parent div.

Concrete final arrangement:

```tsx
<div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
  <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
    <Excalidraw … />
    {meQ.data && <CommentOverlay … />}
  </div>
</div>
```

…with `CommentOverlay` only rendering the `.comment-overlay` div (absolute) plus a separate `.comment-sidebar` returned via fragment — but the sidebar *should not* be absolute. To keep it sibling-positioned, refactor the JSX to render the sidebar **outside** the canvas wrapper. Easiest: have `CommentOverlay` return `<>(<div .comment-overlay/>) <aside .comment-sidebar/></>` and accept that the parent flex layout is `display: flex; flex-direction: row`, with the canvas wrapper *and* the sidebar as flex siblings — which only works if the overlay div is absolute inside its own positioned wrapper.

Therefore, restructure the editor's JSX:

```tsx
<div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
  <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
    <Excalidraw … />
    {meQ.data && (
      <CommentOverlayLayer
        sceneId={id}
        apiRef={apiRef}
        tick={tick}
        currentUserId={meQ.data.id}
        isOwner={role === undefined || role === 'owner'}
      />
    )}
  </div>
  {meQ.data && (
    <CommentSidebarPanel
      sceneId={id}
      apiRef={apiRef}
      tick={tick}
      currentUserId={meQ.data.id}
      isOwner={role === undefined || role === 'owner'}
    />
  )}
</div>
```

To avoid duplicating state across two components, keep `CommentOverlay` as a single component that renders its overlay div *and* a sidebar via React **portal** — the sidebar mounts into a `<div id="comment-sidebar-slot" />` rendered as a flex sibling next to the canvas wrapper.

- [ ] **Step 2: Use a sidebar slot via createPortal**

Final shape of the editor route:

```tsx
const sidebarSlotRef = useRef<HTMLDivElement | null>(null)
…
<div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
  <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
    <Excalidraw … />
    {meQ.data && (
      <CommentOverlay
        sceneId={id}
        apiRef={apiRef}
        tick={tick}
        currentUserId={meQ.data.id}
        isOwner={role === undefined || role === 'owner'}
        sidebarSlotRef={sidebarSlotRef}
      />
    )}
  </div>
  <div ref={sidebarSlotRef} style={{ display: 'flex' }} />
</div>
```

Then update `CommentOverlay`: take `sidebarSlotRef`, render the sidebar via `createPortal(sidebarNode, sidebarSlotRef.current)` only when the ref is present (use a small `useState(0)` "force render after mount" trick or a ref-callback to trigger a re-render). The simplest is to use a `useState<HTMLElement | null>` for the slot and pass a setter to the editor.

In practice:

```tsx
// editor route
const [sidebarSlot, setSidebarSlot] = useState<HTMLDivElement | null>(null)
…
<div ref={setSidebarSlot} style={{ display: 'flex' }} />
```

```tsx
// CommentOverlay (replace the sidebar JSX with portal)
return (
  <>
    <div className="comment-overlay" … />
    {props.sidebarSlot ? createPortal(<CommentSidebar … />, props.sidebarSlot) : null}
  </>
)
```

Update `CommentOverlayProps` to take `sidebarSlot: HTMLElement | null` instead of a ref.

- [ ] **Step 3: Add `handleViewportChange` for view-only role**

When `canEdit` is false, the editor's `onChange` is currently disabled (Phase 4) — but we still need viewport updates to drive the overlay. Add a lightweight handler that only bumps `tick`:

```ts
const handleViewportChange = useCallback(() => {
  setTick((t) => t + 1)
}, [])
```

Pass it as `onChange` when `canEdit` is false. Since `handleChange` already bumps `tick` in the edit path, this keeps the overlay reactive in both modes.

- [ ] **Step 4: Verify typecheck**

```bash
pnpm --filter @excalimore/web typecheck
```

- [ ] **Step 5: Browser smoke test (manual)**

Login → open scene → draw a rectangle → wait 2s for the editor to save → click "+ Comment" in the sidebar → click the rectangle → type a comment → Post. The pin should appear on the rectangle. Pan and zoom — the pin follows. Reload — the pin is still there.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/_authed.scenes.$id.tsx apps/web/src/routes/-components/CommentOverlay.tsx
git commit -m "feat(web): mount CommentOverlay sibling on scene editor"
```

---

### Task 10: e2e fixture extension

**Files:**
- Modify: `apps/web/e2e/fixtures.ts`

Add a `placeComment(page, body)` helper that:

1. Clicks "+ Comment" in the sidebar.
2. Clicks the centre of the canvas (where Task 9's e2e will have drawn an element).
3. Fills the textarea, clicks Post, waits for the pin to appear.

The actual rectangle-drawing in Excalidraw is awkward through Playwright; we instead **seed a scene via the API** so the test starts with a known element id. This is the pragmatic choice — the goal is to verify the overlay/persistence pipeline, not Excalidraw's drawing tools (covered upstream).

- [ ] **Step 1: Add helpers to `fixtures.ts`**

```ts
import type { APIRequestContext } from '@playwright/test'

/**
 * Seed a scene via the API with a single rectangle so the e2e has a
 * deterministic element to anchor a comment to. Returns the scene id and the
 * rectangle's element id. Uses Playwright's request context to inherit the
 * authenticated cookie + CSRF set by the page's own login flow.
 */
export async function seedSceneWithRectangle(
  page: Page,
): Promise<{ sceneId: string; elementId: string }> {
  const elementId = `rect-${randomBytes(8).toString('hex')}`
  // Read CSRF from the cookie the API set on signup.
  const cookies = await page.context().cookies()
  const csrf = cookies.find((c) => c.name === 'excalimore_csrf')?.value
  if (!csrf) throw new Error('csrf cookie missing — did you bootstrap first?')
  const ctx = page.context().request as APIRequestContext

  const createRes = await ctx.post('/api/scenes', {
    headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    data: { name: 'comment-test scene' },
  })
  if (!createRes.ok()) throw new Error(`create scene failed: ${createRes.status()}`)
  const created = (await createRes.json()) as { scene: { id: string } }
  const sceneId = created.scene.id

  // Patch the scene with a single rectangle element so the overlay has
  // something deterministic to attach to.
  const data = {
    type: 'excalidraw',
    elements: [
      {
        id: elementId,
        type: 'rectangle',
        x: 200,
        y: 150,
        width: 200,
        height: 120,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        groupIds: [],
        seed: 1,
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        boundElements: [],
        updated: 1,
        link: null,
        locked: false,
      },
    ],
    appState: {},
    files: {},
  }
  const patch = await ctx.patch(`/api/scenes/${sceneId}`, {
    headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    data: { data },
  })
  if (!patch.ok()) throw new Error(`patch scene failed: ${patch.status()}`)

  return { sceneId, elementId }
}

/** Place a comment on the scene currently open in the editor. */
export async function placeComment(page: Page, body: string): Promise<void> {
  await page.getByTestId('comment-add-button').click()
  await expect(page.getByText('Click any element to attach a comment')).toBeVisible()
  // Click the centre of the canvas. The seeded rectangle covers the centre
  // since Excalidraw centres scene content on initial render.
  const canvas = page.locator('canvas.excalidraw__canvas.interactive')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const composer = page.getByTestId('comment-composer')
  await expect(composer).toBeVisible()
  await composer.locator('textarea').fill(body)
  await composer.getByRole('button', { name: /Post/ }).click()
  await expect(page.getByTestId('comment-pin').first()).toBeVisible({ timeout: 5000 })
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/e2e/fixtures.ts
git commit -m "test(web): extend e2e fixtures with seedSceneWithRectangle + placeComment"
```

---

### Task 11: e2e — anchored comment placement and persistence

**Files:**
- Create: `apps/web/e2e/comments.spec.ts`

Acceptance criterion (spec §7 + this phase's brief): user opens a scene, places an anchored comment, reloads, the comment is still there pinned to the same element.

- [ ] **Step 1: Write the spec**

```ts
import {
  bootstrapAdmin,
  expect,
  placeComment,
  seedSceneWithRectangle,
  test,
} from './fixtures'

test.describe('anchored comments', () => {
  test('places a comment, persists across reload, lists in sidebar', async ({ page }) => {
    await bootstrapAdmin(page, {
      email: 'commenter@e2e.test',
      password: 'commenter-password',
      name: 'Commenter',
    })

    const { sceneId } = await seedSceneWithRectangle(page)
    await page.goto(`/scenes/${sceneId}`)
    await expect(page.locator('canvas.excalidraw__canvas.interactive')).toBeVisible()

    await placeComment(page, 'first anchored comment')

    // Sidebar lists the comment.
    await expect(page.getByTestId('comment-sidebar-item')).toHaveCount(1)
    await expect(page.getByTestId('comment-sidebar-item').first()).toContainText(
      'first anchored comment',
    )

    // Reload — the pin and sidebar entry should persist.
    await page.reload()
    await expect(page.locator('canvas.excalidraw__canvas.interactive')).toBeVisible()
    await expect(page.getByTestId('comment-pin')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('comment-sidebar-item')).toHaveCount(1)
    await expect(page.getByTestId('comment-sidebar-item').first()).toContainText(
      'first anchored comment',
    )
  })
})
```

- [ ] **Step 2: Run e2e locally**

```bash
pnpm --filter @excalimore/web test:e2e
```

Expected: existing 4 e2e tests still pass; the new one passes too.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/comments.spec.ts
git commit -m "test(web): e2e — anchored comment placement persists across reload"
```

---

### Task 12: Final pipeline check + lint cleanup

**Files:**
- (verification only)

- [ ] **Step 1: Full pipeline**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @excalimore/web test:e2e
```

Fix any failures before continuing.

- [ ] **Step 2: Lint cleanup if needed**

```bash
pnpm exec biome check --write .
git add -A && git commit -m "chore: lint cleanup for Phase 5"
```

- [ ] **Step 3: Push branch + open PR**

```bash
git push -u origin phase-5-comments
gh pr create --base main --title "Phase 5: Anchored comment overlay" --body "$(cat <<'EOF'
## Summary

- New CommentOverlay layer (sibling of <Excalidraw />), CommentPin, CommentComposer FSM, CommentSidebar, OffscreenIndicator
- Scene-space ↔ screen-space coordinate transform with pin-size clamp at extreme zoom
- Real-time updates via SSE (browser-native EventSource), refetch on focus/visibility for reconnect reconcile
- Comment API hooks (list/create/update/delete) following the scenes.ts pattern
- Edge cases: orphan comment when element deleted (red badge), off-screen edge chips with click-to-pan, overlapping pin clusters, zoom-clamped pin size

## Test plan

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — all green
- [ ] `pnpm --filter @excalimore/web test:e2e` — all e2e tests pass (5 total: 4 pre-existing + 1 new comments spec)
- [ ] Manual: bootstrap → seed scene with rectangle → place comment → reload → pin persists
EOF
)"
```

- [ ] **Step 4: Watch CI**

```bash
gh run watch
```

Fix any CI failures and re-push until green.

---

## Phase 5 Done Criteria

Tick when **all** of the following are true:

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass.
- [ ] `pnpm --filter @excalimore/web test:e2e` passes including the new `comments.spec.ts`.
- [ ] Manual smoke: comment placed on a rectangle persists across reload and follows the pin during pan/zoom.
- [ ] CI green on the Phase 5 PR.
