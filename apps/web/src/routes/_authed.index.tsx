import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { useScenes } from '../api/scenes'
import { NewSceneButton } from './-components/NewSceneButton'
import { SceneCard } from './-components/SceneCard'

const SearchSchema = z.object({
  folder: z.string().uuid().optional(),
})

export const Route = createFileRoute('/_authed/')({
  validateSearch: SearchSchema.parse,
  component: HomePage,
})

function HomePage() {
  const { folder } = Route.useSearch()
  const own = useScenes({ folderId: folder ?? null })
  const shared = useScenes({ shared: true })

  const heading = folder ? 'Scenes in this folder' : 'Your scenes'

  return (
    <section className="app-page">
      <header className="app-page-header">
        <h1>{heading}</h1>
        <NewSceneButton folderId={folder} />
      </header>
      {own.isLoading ? (
        <p className="muted">Loading…</p>
      ) : (own.data?.length ?? 0) === 0 ? (
        <p className="muted">
          {folder ? 'No scenes in this folder yet.' : 'No scenes yet — click "New scene" to start.'}
        </p>
      ) : (
        <div className="scene-grid">
          {own.data?.map((s) => (
            <SceneCard key={s.id} scene={s} />
          ))}
        </div>
      )}

      {!folder && shared.data && shared.data.length > 0 && (
        <>
          <h2 style={{ marginTop: '2rem' }}>Shared with you</h2>
          <div className="scene-grid">
            {shared.data.map((s) => (
              <SceneCard key={s.id} scene={s} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
