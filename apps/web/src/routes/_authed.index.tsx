import { createFileRoute } from '@tanstack/react-router'
import { useScenes } from '../api/scenes'
import { NewSceneButton } from './-components/NewSceneButton'
import { SceneCard } from './-components/SceneCard'

export const Route = createFileRoute('/_authed/')({
  component: HomePage,
})

function HomePage() {
  const own = useScenes({})
  const shared = useScenes({ shared: true })

  return (
    <section className="app-page">
      <header className="app-page-header">
        <h1>Your scenes</h1>
        <NewSceneButton />
      </header>
      {own.isLoading ? (
        <p className="muted">Loading…</p>
      ) : (own.data?.length ?? 0) === 0 ? (
        <p className="muted">No scenes yet — click "New scene" to start.</p>
      ) : (
        <div className="scene-grid">
          {own.data?.map((s) => <SceneCard key={s.id} scene={s} />)}
        </div>
      )}

      {shared.data && shared.data.length > 0 && (
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
