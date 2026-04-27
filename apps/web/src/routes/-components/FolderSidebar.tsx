import { Link, useSearch } from '@tanstack/react-router'
import { useState } from 'react'
import { useCreateFolder, useFolders } from '../../api/folders'

export function FolderSidebar() {
  const folders = useFolders()
  const create = useCreateFolder()
  const [showNew, setShowNew] = useState(false)
  const [name, setName] = useState('')

  // Read folder selection from /; on other routes useSearch returns {} so this defaults to undefined.
  const search = useSearch({ strict: false }) as { folder?: string }
  const activeFolder = search.folder

  if (folders.isLoading)
    return (
      <p className="muted" style={{ padding: '0 1rem' }}>
        Loading…
      </p>
    )

  return (
    <nav className="folder-list">
      <ul>
        <li>
          <Link to="/" search={{}} className={`folder-link${!activeFolder ? ' is-active' : ''}`}>
            All scenes
          </Link>
        </li>
        {folders.data
          ?.filter((f) => f.parentId === null)
          .map((f) => (
            <li key={f.id}>
              <Link
                to="/"
                search={{ folder: f.id }}
                className={`folder-link${activeFolder === f.id ? ' is-active' : ''}`}
              >
                {f.name}
              </Link>
            </li>
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
            const trimmed = name.trim()
            if (!trimmed) return
            await create.mutateAsync({ name: trimmed })
            setName('')
            setShowNew(false)
          }}
          className="folder-new-form"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setName('')
                setShowNew(false)
              }
            }}
            // biome-ignore lint/a11y/noAutofocus: small inline new-folder input is the focused interaction
            autoFocus
            placeholder="Folder name"
            maxLength={80}
            aria-label="New folder name"
            className="folder-input"
          />
          <div className="folder-new-actions">
            <button
              type="button"
              onClick={() => {
                setName('')
                setShowNew(false)
              }}
              className="folder-submit"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="folder-submit folder-submit--primary"
              disabled={create.isPending || !name.trim()}
            >
              {create.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}
    </nav>
  )
}
