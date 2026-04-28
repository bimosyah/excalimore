import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawSceneData } from '@excalimore/types'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useMe } from '../api/auth'
import { useRenameScene, useSaveScene, useSaveSceneThumbnail, useScene } from '../api/scenes'
import { debounce } from '../lib/debounce'
import { useCollapsed } from '../lib/use-collapsed'
import { CommentOverlay, type ExcalidrawApiLite } from './-components/CommentOverlay'

export const Route = createFileRoute('/_authed/scenes/$id')({
  component: SceneEditorPage,
})

/**
 * Excalidraw's runtime `appState` contains values that don't survive a JSON
 * round-trip — most notably `collaborators` (a Map) and selection / editing
 * state. We strip them before persisting and again on hydration so the editor
 * always sees a fresh runtime shape.
 */
const TRANSIENT_APP_STATE_KEYS = new Set([
  'collaborators',
  'selectedElementIds',
  'selectedGroupIds',
  'editingElement',
  'editingGroupId',
  'editingLinearElement',
  'cursorButton',
  'pendingImageElementId',
  'draggingElement',
  'resizingElement',
  'multiElement',
  'isResizing',
  'isRotating',
])

function pruneAppState(appState: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!appState) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(appState)) {
    if (!TRANSIENT_APP_STATE_KEYS.has(k)) out[k] = v
  }
  return out
}

/**
 * A short fingerprint of the elements that mutates only when the user actually
 * edits the board. Excalidraw bumps `version` and `versionNonce` on every real
 * change but keeps them stable for camera/viewport changes — so this is enough
 * to skip saves that wouldn't change the persisted scene.
 */
function fingerprintElements(elements: readonly unknown[]): string {
  let acc = `${elements.length}`
  for (const el of elements) {
    const e = el as { id?: string; version?: number; versionNonce?: number; isDeleted?: boolean }
    acc += `|${e.id}:${e.version}:${e.versionNonce}:${e.isDeleted ? 1 : 0}`
  }
  return acc
}

/**
 * Hard ceiling for a thumbnail data URL we'll persist. `text` columns in
 * Postgres are unbounded, but a runaway 5MB base64 in every list response
 * would tank the home grid. The renderer downscales once if it's over
 * `THUMBNAIL_SIZE_TARGET`; if it's still over `THUMBNAIL_SIZE_HARD_CEILING`
 * after the second pass we skip the save (the placeholder stays).
 */
const THUMBNAIL_SIZE_TARGET = 50 * 1024
const THUMBNAIL_SIZE_HARD_CEILING = 100 * 1024
const THUMBNAIL_FIRST_PASS_PX = 320
const THUMBNAIL_FALLBACK_PX = 240

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('FileReader produced non-string result'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Render a small PNG thumbnail of the current scene as a data URL. Returns
 * `null` when the scene is empty or the result still exceeds the hard
 * ceiling after a downscale pass — callers use that as a signal to skip the
 * save and leave the placeholder in place.
 */
async function renderThumbnailDataUrl(
  elements: readonly unknown[],
  appState: Record<string, unknown>,
  files: Record<string, unknown>,
): Promise<string | null> {
  if (elements.length === 0) return null
  // First pass at the target resolution. If the PNG is small enough we
  // ship it as-is; otherwise we retry once at a smaller size before
  // giving up.
  for (const maxWidthOrHeight of [THUMBNAIL_FIRST_PASS_PX, THUMBNAIL_FALLBACK_PX]) {
    const blob = await exportToBlob({
      // Excalidraw's export types want non-readonly arrays / its own types,
      // but at runtime they're just iterated — `as never` keeps TS quiet
      // without dragging in the full element type.
      elements: elements as never,
      appState: { ...appState, exportBackground: true, exportWithDarkMode: false } as never,
      files: files as never,
      mimeType: 'image/png',
      maxWidthOrHeight,
    })
    const dataUrl = await blobToDataUrl(blob)
    if (dataUrl.length <= THUMBNAIL_SIZE_TARGET) return dataUrl
    if (
      maxWidthOrHeight === THUMBNAIL_FALLBACK_PX &&
      dataUrl.length <= THUMBNAIL_SIZE_HARD_CEILING
    ) {
      return dataUrl
    }
    if (maxWidthOrHeight === THUMBNAIL_FALLBACK_PX) {
      // Even the smaller render is still too big — give up gracefully.
      console.warn(
        `[thumbnail] skipping save: data URL ${dataUrl.length}B exceeds ${THUMBNAIL_SIZE_HARD_CEILING}B`,
      )
      return null
    }
  }
  return null
}

function SceneEditorPage() {
  const { id } = Route.useParams()
  const sceneQ = useScene(id)
  const meQ = useMe()
  const save = useSaveScene(id)
  const saveThumb = useSaveSceneThumbnail(id)
  const rename = useRenameScene(id)
  const lastFingerprintRef = useRef<string | null>(null)
  // Tracks the fingerprint of the elements last *thumbnailed*, separately
  // from the data-save fingerprint above. The thumbnail debounce is slower
  // (5s vs 2s) and can fail/skip independently, so we don't want to share
  // state with the data save.
  const lastThumbFingerprintRef = useRef<string | null>(null)
  const apiRef = useRef<ExcalidrawApiLite | null>(null)
  // `tick` re-renders the comment overlay when Excalidraw's onChange fires.
  // The viewport (scrollX/scrollY/zoom) changes drive a render so pins follow
  // pan/zoom; we never persist on viewport-only changes thanks to the
  // fingerprint guard above.
  const [tick, setTick] = useState(0)
  const [sidebarSlot, setSidebarSlot] = useState<HTMLDivElement | null>(null)
  const [renamingDraft, setRenamingDraft] = useState<string | null>(null)
  const [commentsCollapsed, setCommentsCollapsed] = useCollapsed(
    'excalimore.sidebar.comments',
    false,
  )

  const debouncedSave = useMemo(
    () =>
      debounce((data: ExcalidrawSceneData) => {
        save.mutateAsync(data).catch((err) => {
          // Surface failures lightly — full error UX is post-MVP.
          console.error('save failed:', err)
        })
      }, 2000),
    [save],
  )

  // Thumbnail render + save. Slower cadence than the data save (5s vs 2s)
  // because exportToBlob walks every element through a canvas — fine on a
  // small board, expensive during a flurry of edits. The fingerprint guard
  // also dedupes "same elements as last time" cases, so a single rapid
  // sequence of edits collapses to one render at the trailing edge.
  const debouncedThumbnail = useMemo(
    () =>
      debounce(
        async (
          elements: readonly unknown[],
          appState: Record<string, unknown>,
          files: Record<string, unknown>,
          fingerprint: string,
        ) => {
          if (lastThumbFingerprintRef.current === fingerprint) return
          try {
            const dataUrl = await renderThumbnailDataUrl(elements, appState, files)
            if (!dataUrl) return
            await saveThumb.mutateAsync(dataUrl)
            lastThumbFingerprintRef.current = fingerprint
          } catch (err) {
            // Don't block the editor on thumbnail failures — the placeholder
            // is a perfectly fine fallback.
            console.error('thumbnail save failed:', err)
          }
        },
        5000,
      ),
    [saveThumb],
  )

  const lastViewportRef = useRef<{ scrollX: number; scrollY: number; zoom: number } | null>(null)

  const handleChange = useCallback(
    (
      elements: readonly unknown[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>,
    ) => {
      // Bump tick only when the viewport (scrollX/scrollY/zoom) actually
      // changed. Excalidraw fires onChange for many internal events including
      // re-renders triggered by our own setTick — bumping unconditionally
      // causes a state-update loop ("Maximum update depth exceeded").
      const a = appState as { scrollX?: number; scrollY?: number; zoom?: { value?: number } }
      const next = {
        scrollX: typeof a.scrollX === 'number' ? a.scrollX : 0,
        scrollY: typeof a.scrollY === 'number' ? a.scrollY : 0,
        zoom: typeof a.zoom?.value === 'number' ? a.zoom.value : 1,
      }
      const prev = lastViewportRef.current
      if (
        !prev ||
        prev.scrollX !== next.scrollX ||
        prev.scrollY !== next.scrollY ||
        prev.zoom !== next.zoom
      ) {
        lastViewportRef.current = next
        setTick((t) => t + 1)
      }

      // Excalidraw fires onChange for camera/viewport changes too. Save only
      // when the elements actually mutated, so saving stays quiet while the
      // user is just panning, zooming, or selecting.
      const fingerprint = fingerprintElements(elements)
      if (lastFingerprintRef.current === null) {
        lastFingerprintRef.current = fingerprint
        return
      }
      if (lastFingerprintRef.current === fingerprint) return
      lastFingerprintRef.current = fingerprint

      debouncedSave({
        type: 'excalidraw',
        elements: elements as unknown[],
        appState: pruneAppState(appState),
        files,
      })
      // Schedule a thumbnail re-render on a slower cadence. We pass the same
      // fingerprint so the trailing-edge handler can short-circuit if it's
      // already rendered exactly this state (e.g. the user hit undo back to
      // the previously thumbnailed snapshot).
      debouncedThumbnail(elements, appState, files, fingerprint)
    },
    [debouncedSave, debouncedThumbnail],
  )

  // View-only role: bump tick when viewport changes only.
  const handleViewportTick = useCallback((_elements: unknown, appState: unknown) => {
    const a = appState as { scrollX?: number; scrollY?: number; zoom?: { value?: number } }
    const next = {
      scrollX: typeof a.scrollX === 'number' ? a.scrollX : 0,
      scrollY: typeof a.scrollY === 'number' ? a.scrollY : 0,
      zoom: typeof a.zoom?.value === 'number' ? a.zoom.value : 1,
    }
    const prev = lastViewportRef.current
    if (
      !prev ||
      prev.scrollX !== next.scrollX ||
      prev.scrollY !== next.scrollY ||
      prev.zoom !== next.zoom
    ) {
      lastViewportRef.current = next
      setTick((t) => t + 1)
    }
  }, [])

  // Stable callback for Excalidraw's `excalidrawAPI` prop. Inline arrow
  // functions cause Excalidraw to re-mount on every parent render, which in
  // turn re-fires its onChange — combined with our setTick that triggers an
  // infinite update loop ("Maximum update depth exceeded").
  const setApi = useCallback((api: unknown) => {
    apiRef.current = api as ExcalidrawApiLite
  }, [])

  const initialData = useMemo(() => {
    if (!sceneQ.data) return null
    const { data } = sceneQ.data.scene
    return {
      ...data,
      appState: pruneAppState(data.appState),
    }
  }, [sceneQ.data])

  if (sceneQ.isLoading)
    return (
      <p className="muted" style={{ padding: '2rem' }}>
        Loading scene…
      </p>
    )
  if (sceneQ.error)
    return (
      <div style={{ padding: '2rem' }}>
        <p>Could not load this scene.</p>
        <Link to="/">← Back to scenes</Link>
      </div>
    )
  if (!sceneQ.data || !initialData) return null

  const { scene, role } = sceneQ.data
  // role is undefined when the user is the owner (server omits it for owners).
  const canEdit = role === undefined || role === 'owner' || role === 'edit'
  const isOwner = role === undefined || role === 'owner'

  const backSearch = scene.folderId ? { folder: scene.folderId } : {}

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid #e5e5e5',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          background: 'white',
        }}
      >
        <Link to="/" search={backSearch} style={{ textDecoration: 'none', color: '#1971c2' }}>
          ← Scenes
        </Link>
        {renamingDraft !== null ? (
          <input
            type="text"
            value={renamingDraft}
            onChange={(e) => setRenamingDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setRenamingDraft(null)
              } else if (e.key === 'Enter') {
                e.currentTarget.blur()
              }
            }}
            onBlur={async () => {
              const trimmed = renamingDraft.trim()
              setRenamingDraft(null)
              if (trimmed.length === 0 || trimmed === scene.name) return
              try {
                await rename.mutateAsync(trimmed)
              } catch (err) {
                console.error('rename failed:', err)
              }
            }}
            // biome-ignore lint/a11y/noAutofocus: focus is the entire interaction
            autoFocus
            maxLength={200}
            aria-label="Scene name"
            style={{
              fontWeight: 600,
              fontSize: '1em',
              padding: '0.15rem 0.4rem',
              border: '1px solid #1971c2',
              borderRadius: 4,
              outline: 'none',
              minWidth: 200,
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => canEdit && setRenamingDraft(scene.name)}
            title={canEdit ? 'Click to rename' : undefined}
            disabled={!canEdit}
            style={{
              fontWeight: 700,
              fontSize: '1em',
              background: 'none',
              border: 'none',
              padding: '0.15rem 0.4rem',
              borderRadius: 4,
              cursor: canEdit ? 'text' : 'default',
              color: 'inherit',
              fontFamily: 'inherit',
            }}
          >
            {scene.name}
          </button>
        )}
        {!canEdit && <span className="muted">view-only</span>}
        {(save.isPending || rename.isPending) && <span className="muted">saving…</span>}
      </header>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <Excalidraw
            excalidrawAPI={setApi as never}
            initialData={initialData as never}
            onChange={canEdit ? (handleChange as never) : (handleViewportTick as never)}
            viewModeEnabled={!canEdit}
            theme="light"
          />
          {meQ.data && (
            <CommentOverlay
              sceneId={id}
              apiRef={apiRef}
              tick={tick}
              currentUserId={meQ.data.id}
              isOwner={isOwner}
              sidebarSlot={commentsCollapsed ? null : sidebarSlot}
              onCollapseSidebar={() => setCommentsCollapsed(true)}
            />
          )}
          {commentsCollapsed && (
            <button
              type="button"
              onClick={() => setCommentsCollapsed(false)}
              className="app-floating-toggle app-floating-toggle--right"
              aria-label="Show comments"
              title="Show comments"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
        {!commentsCollapsed && <div ref={setSidebarSlot} style={{ display: 'flex' }} />}
      </div>
    </div>
  )
}
