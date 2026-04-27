import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useCreateScene } from '../../api/scenes'

interface Props {
  folderId?: string
}

export function NewSceneButton({ folderId }: Props) {
  const create = useCreateScene()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className="app-button-primary"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          const res = await create.mutateAsync({ name: 'Untitled scene', folderId })
          navigate({ to: '/scenes/$id', params: { id: res.scene.id } })
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? 'Creating…' : '+ New scene'}
    </button>
  )
}
