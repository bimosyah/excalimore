import type { Comment } from '@excalimore/types'
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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

/**
 * Minimal slice of the Excalidraw API the overlay actually uses. We
 * deliberately don't import Excalidraw's strict types — the editor is a
 * runtime dependency and we'd rather pay a tiny duplication cost than chase
 * its type-tightening across versions.
 */
export type ExcalidrawApiLite = {
  getAppState: () => { scrollX: number; scrollY: number; zoom: { value: number } }
  getSceneElements: () => readonly {
    id: string
    x: number
    y: number
    width: number
    height: number
    isDeleted?: boolean
  }[]
  scrollToContent?: (target: unknown, opts?: { fitToViewport?: boolean }) => void
  updateScene?: (data: { appState: { scrollX: number; scrollY: number } }) => void
}

export interface CommentOverlayProps {
  sceneId: string
  apiRef: MutableRefObject<ExcalidrawApiLite | null>
  /** Bumped every time Excalidraw onChange fires so positions recompute. */
  tick: number
  currentUserId: string
  isOwner: boolean
  /** DOM node where the sidebar is portaled (rendered as a flex sibling). */
  sidebarSlot: HTMLElement | null
  /** Optional callback wired to the sidebar's collapse button. */
  onCollapseSidebar?: () => void
}

type ComposerState =
  | { mode: 'idle' }
  | { mode: 'pick-element' }
  | { mode: 'composing'; target: ComposerTarget; body: string }

const CLUSTER_EPS_PX = 12

export function CommentOverlay(props: CommentOverlayProps) {
  const [includeResolved, setIncludeResolved] = useState(false)
  const opts: CommentListOptions = { includeResolved }
  const commentsQ = useComments(props.sceneId, opts)
  const createMutation = useCreateComment(props.sceneId)
  const updateMutation = useUpdateComment(props.sceneId)
  const [composer, setComposer] = useState<ComposerState>({ mode: 'idle' })
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Keep an always-current refetch callback in a ref so the SSE / focus
  // effects can subscribe once per scene without re-subscribing on every
  // render (commentsQ identity changes each render, refetch is stable but
  // biome's exhaustive-deps doesn't know that).
  const refetchRef = useRef(commentsQ.refetch)
  refetchRef.current = commentsQ.refetch

  // SSE: any comment.* event invalidates the cached list. Centralising the
  // merge logic in React Query (refetch) is simpler than splicing each event
  // into local state and avoids drift between the SSE payload schema and the
  // list payload schema.
  useEffect(() => {
    const off = subscribeToSceneEvents(props.sceneId, () => {
      refetchRef.current()
    })
    return off
  }, [props.sceneId])

  // Refetch on focus/visibilitychange to reconcile any events the EventSource
  // missed during a reconnect (per spec §7).
  useEffect(() => {
    const refetch = () => {
      refetchRef.current()
    }
    window.addEventListener('focus', refetch)
    document.addEventListener('visibilitychange', refetch)
    return () => {
      window.removeEventListener('focus', refetch)
      document.removeEventListener('visibilitychange', refetch)
    }
  }, [])

  // The scene-level viewport / elements come from refs, so we read them at
  // render time. The parent forwards `tick` so React re-runs this function
  // on every Excalidraw onChange — that's enough to keep pins fresh. We use
  // `props.tick` once below as a dummy ref to silence the unused-prop lint.
  void props.tick
  const apiNow = props.apiRef.current
  const viewport = apiNow
    ? (() => {
        const s = apiNow.getAppState()
        return { scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value }
      })()
    : null

  const elementMap = (() => {
    const map = new Map<
      string,
      { id: string; x: number; y: number; width: number; height: number }
    >()
    if (!apiNow) return map
    for (const el of apiNow.getSceneElements()) {
      if (el.isDeleted) continue
      map.set(el.id, { id: el.id, x: el.x, y: el.y, width: el.width, height: el.height })
    }
    return map
  })()

  type Plotted = {
    comment: Comment
    sceneX: number
    sceneY: number
    screenX: number
    screenY: number
    isOrphan: boolean
  }
  const plotted: Plotted[] =
    !viewport || !commentsQ.data
      ? []
      : commentsQ.data.map((c) => {
          const el = elementMap.get(c.elementId)
          let sceneX: number
          let sceneY: number
          let isOrphan = false
          if (el) {
            sceneX = el.x + c.xOffset
            sceneY = el.y + c.yOffset
          } else {
            sceneX = c.lastKnownX ?? 0
            sceneY = c.lastKnownY ?? 0
            isOrphan = true
          }
          const { screenX, screenY } = sceneToScreen({ sceneX, sceneY }, viewport)
          return { comment: c, sceneX, sceneY, screenX, screenY, isOrphan }
        })

  // Cluster overlapping pins (within ~12px on screen).
  type Cluster = {
    key: string
    comments: Comment[]
    sceneX: number
    sceneY: number
    screenX: number
    screenY: number
    isOrphan: boolean
  }
  const clusters: Cluster[] = (() => {
    const out: Cluster[] = []
    for (const p of plotted) {
      const found = out.find(
        (c) =>
          Math.abs(c.screenX - p.screenX) < CLUSTER_EPS_PX &&
          Math.abs(c.screenY - p.screenY) < CLUSTER_EPS_PX,
      )
      if (found) {
        found.comments.push(p.comment)
        found.isOrphan = found.isOrphan || p.isOrphan
      } else {
        out.push({
          key: p.comment.id,
          comments: [p.comment],
          sceneX: p.sceneX,
          sceneY: p.sceneY,
          screenX: p.screenX,
          screenY: p.screenY,
          isOrphan: p.isOrphan,
        })
      }
    }
    return out
  })()

  const containerRect = containerRef.current?.getBoundingClientRect()
  const containerBox = { width: containerRect?.width ?? 0, height: containerRect?.height ?? 0 }

  const orphanIds = new Set(plotted.filter((p) => p.isOrphan).map((p) => p.comment.id))

  const onScreenClusters = clusters.filter((c) =>
    isOnScreen({ screenX: c.screenX, screenY: c.screenY }, containerBox),
  )
  const offScreenClusters = clusters.filter(
    (c) => !isOnScreen({ screenX: c.screenX, screenY: c.screenY }, containerBox),
  )

  const pinSize = clampPinSize(viewport?.zoom ?? 1)

  const panToScene = useCallback(
    (sceneX: number, sceneY: number) => {
      const api = props.apiRef.current
      if (!api) return
      const state = api.getAppState()
      const z = state.zoom.value > 0 ? state.zoom.value : 1
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      // Centre the target in the viewport. Excalidraw's scrollX/scrollY are
      // scene offsets; to centre `sceneX` at half the canvas width:
      //   (sceneX + scrollX) * zoom = width / 2  →  scrollX = width/(2*zoom) - sceneX
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

  // Handle a click while in pick-element mode: walk scene elements to find
  // the topmost hit at the click point and transition to "composing".
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
        if (
          sceneX >= el.x &&
          sceneX <= el.x + el.width &&
          sceneY >= el.y &&
          sceneY <= el.y + el.height
        ) {
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

  // Esc cancels pick/compose modes. Listen on document so the user doesn't
  // need to click into the overlay first.
  useEffect(() => {
    if (composer.mode === 'idle') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setComposer({ mode: 'idle' })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [composer.mode])

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

  const sidebar = (
    <CommentSidebar
      comments={commentsQ.data ?? []}
      isLoading={commentsQ.isLoading}
      includeResolved={includeResolved}
      orphanIds={orphanIds}
      onToggleResolved={setIncludeResolved}
      onSelect={onSelectFromSidebar}
      onStartAdd={startAdd}
      isAdding={composer.mode !== 'idle'}
      onCollapse={props.onCollapseSidebar}
    />
  )

  return (
    <>
      <div
        ref={containerRef}
        className="comment-overlay"
        style={overlayPointerEvents}
        onClick={composer.mode === 'pick-element' ? handlePickClick : undefined}
        onKeyDown={undefined}
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
              onClick={() => panToScene(cl.sceneX, cl.sceneY)}
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
      {props.sidebarSlot ? createPortal(sidebar, props.sidebarSlot) : null}
    </>
  )
}
