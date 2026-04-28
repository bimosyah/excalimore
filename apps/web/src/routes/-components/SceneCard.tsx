import { Link } from '@tanstack/react-router'
import type { SceneListItem } from '../../api/scenes'

export function SceneCard({ scene }: { scene: SceneListItem }) {
  return (
    <Link to="/scenes/$id" params={{ id: scene.id }} className="scene-card">
      <div className="scene-card-thumb">
        {scene.thumbnailUrl ? (
          // alt is empty: the scene name renders right below as visible text,
          // so AT users get the same info without a redundant announcement.
          <img src={scene.thumbnailUrl} alt="" loading="lazy" />
        ) : null}
      </div>
      <div className="scene-card-body">
        <strong>{scene.name}</strong>
        <small className="muted">
          updated {new Date(scene.updatedAt).toLocaleDateString()}
          {scene.permission && ` · ${scene.permission}`}
        </small>
      </div>
    </Link>
  )
}
