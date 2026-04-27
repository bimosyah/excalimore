import { useState } from 'react'
import { useCreateFolder, useFolders } from '../../api/folders'

export function FolderSidebar() {
  const folders = useFolders()
  const create = useCreateFolder()
  const [showNew, setShowNew] = useState(false)
  const [name, setName] = useState('')

  if (folders.isLoading)
    return (
      <p className="muted" style={{ padding: '0 1rem' }}>
        Loading…
      </p>
    )

  return (
    <nav className="folder-list">
      <ul>
        {folders.data
          ?.filter((f) => f.parentId === null)
          .map((f) => (
            <li key={f.id}>{f.name}</li>
          ))}
      </ul>
      {!showNew ? (
        <button type="button" onClick={() => setShowNew(true)} className="app-link-button">
          + New folder
        </button>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!name) return
            await create.mutateAsync({ name })
            setName('')
            setShowNew(false)
          }}
          style={{ display: 'flex', gap: '0.25rem' }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: small inline new-folder input is the focused interaction
            autoFocus
            className="folder-input"
          />
          <button type="submit" className="folder-submit" disabled={create.isPending}>
            OK
          </button>
          <button type="button" onClick={() => setShowNew(false)} className="folder-submit">
            ×
          </button>
        </form>
      )}
    </nav>
  )
}
