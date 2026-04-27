import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawSceneData } from '@excalimore/types'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { useSaveScene, useScene } from '../api/scenes'
import { debounce } from '../lib/debounce'

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

function SceneEditorPage() {
  const { id } = Route.useParams()
  const sceneQ = useScene(id)
  const save = useSaveScene(id)

  const debouncedSave = useMemo(
    () =>
      debounce((data: ExcalidrawSceneData) => {
        save.mutateAsync(data).catch((err) => {
          // Surface failures lightly — full error UX in Phase 5.
          console.error('save failed:', err)
        })
      }, 2000),
    [save],
  )

  const handleChange = useCallback(
    (
      elements: readonly unknown[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>,
    ) => {
      debouncedSave({
        type: 'excalidraw',
        elements: elements as unknown[],
        appState: pruneAppState(appState),
        files,
      })
    },
    [debouncedSave],
  )

  // Build the initialData passed to <Excalidraw />. Pruning the persisted
  // appState here means we never feed the editor a stale Map-shaped field.
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
        <Link to="/" style={{ textDecoration: 'none', color: '#1971c2' }}>
          ← Scenes
        </Link>
        <strong>{scene.name}</strong>
        {!canEdit && <span className="muted">view-only</span>}
        {save.isPending && <span className="muted">saving…</span>}
      </header>
      <div style={{ flex: 1, position: 'relative' }}>
        <Excalidraw
          // Excalidraw owns the element/appState type. We persist the JSON
          // verbatim (loose `unknown[]` in our schema) and hand it back here
          // after pruning runtime-only state (Map fields don't JSON-round-trip).
          initialData={initialData as never}
          onChange={canEdit ? (handleChange as never) : undefined}
          viewModeEnabled={!canEdit}
          theme="light"
        />
      </div>
    </div>
  )
}
