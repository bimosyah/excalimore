import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useCreateFolder, useDeleteFolder, useFolders, useUpdateFolder } from '../../api/folders'

export function FolderSidebar() {
  const folders = useFolders()
  const create = useCreateFolder()
  const update = useUpdateFolder()
  const remove = useDeleteFolder()
  const navigate = useNavigate()
  const [showNew, setShowNew] = useState(false)
  const [name, setName] = useState('')
  // Only one menu open at a time. Tracks the folder id whose menu is open.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  // When a folder row is in rename mode, this holds the draft name.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  // When the user clicked "Delete" but hasn't confirmed yet.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Read folder selection from /; on other routes useSearch returns {} so this defaults to undefined.
  const search = useSearch({ strict: false }) as { folder?: string }
  const activeFolder = search.folder

  // Close any open menu / confirmation on a click outside the sidebar list.
  const navRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (openMenuId === null && confirmDeleteId === null) return
    function handleDown(e: MouseEvent) {
      const target = e.target as Node | null
      if (!target || !navRef.current) return
      if (!navRef.current.contains(target)) {
        setOpenMenuId(null)
        setConfirmDeleteId(null)
      }
    }
    document.addEventListener('mousedown', handleDown)
    return () => document.removeEventListener('mousedown', handleDown)
  }, [openMenuId, confirmDeleteId])

  if (folders.isLoading)
    return (
      <p className="muted" style={{ padding: '0 1rem' }}>
        Loading…
      </p>
    )

  const startRename = (id: string, currentName: string) => {
    setRenamingId(id)
    setRenameDraft(currentName)
    setOpenMenuId(null)
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameDraft('')
  }

  const commitRename = async (id: string, currentName: string) => {
    const trimmed = renameDraft.trim()
    setRenamingId(null)
    setRenameDraft('')
    // Empty or unchanged is a no-op.
    if (trimmed.length === 0 || trimmed === currentName) return
    try {
      await update.mutateAsync({ id, patch: { name: trimmed } })
    } catch (err) {
      console.error('rename folder failed:', err)
    }
  }

  const requestDelete = (id: string) => {
    setOpenMenuId(null)
    setConfirmDeleteId(id)
  }

  const cancelDelete = () => setConfirmDeleteId(null)

  const confirmDelete = async (id: string) => {
    setConfirmDeleteId(null)
    try {
      await remove.mutateAsync(id)
      // If the user is currently filtered by the folder being deleted,
      // drop the filter and go to the root scene grid.
      if (activeFolder === id) {
        navigate({ to: '/', search: {} })
      }
    } catch (err) {
      console.error('delete folder failed:', err)
    }
  }

  return (
    <nav className="folder-list" ref={navRef}>
      <ul>
        <li>
          <div className="folder-row folder-row--all">
            <Link to="/" search={{}} className={`folder-link${!activeFolder ? ' is-active' : ''}`}>
              All scenes
            </Link>
          </div>
        </li>
        {folders.data
          ?.filter((f) => f.parentId === null)
          .map((f) => (
            <li key={f.id}>
              {renamingId === f.id ? (
                <div className="folder-row">
                  <input
                    type="text"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        cancelRename()
                      } else if (e.key === 'Enter') {
                        e.currentTarget.blur()
                      }
                    }}
                    onBlur={() => commitRename(f.id, f.name)}
                    // biome-ignore lint/a11y/noAutofocus: focus is the entire interaction
                    autoFocus
                    maxLength={200}
                    aria-label="Folder name"
                    className="folder-input folder-rename-input"
                  />
                </div>
              ) : (
                <div className="folder-row">
                  <Link
                    to="/"
                    search={{ folder: f.id }}
                    className={`folder-link${activeFolder === f.id ? ' is-active' : ''}`}
                  >
                    {f.name}
                  </Link>
                  <button
                    type="button"
                    className="folder-menu-trigger"
                    aria-haspopup="menu"
                    aria-expanded={openMenuId === f.id}
                    aria-label={`Folder actions for ${f.name}`}
                    title="Folder actions"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setOpenMenuId((prev) => (prev === f.id ? null : f.id))
                      setConfirmDeleteId(null)
                    }}
                  >
                    <span aria-hidden="true">⋯</span>
                  </button>
                  {openMenuId === f.id && (
                    <div className="folder-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        className="folder-menu-item"
                        onClick={() => startRename(f.id, f.name)}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="folder-menu-item folder-menu-item--danger"
                        onClick={() => requestDelete(f.id)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                  {confirmDeleteId === f.id && (
                    <dialog open className="folder-confirm" aria-label="Confirm delete">
                      <p className="folder-confirm-body">
                        Delete folder <strong>{f.name}</strong>? Scenes inside will be moved to
                        root.
                      </p>
                      <div className="folder-confirm-actions">
                        <button
                          type="button"
                          onClick={cancelDelete}
                          className="folder-submit"
                          disabled={remove.isPending}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => confirmDelete(f.id)}
                          className="folder-submit folder-submit--danger"
                          disabled={remove.isPending}
                        >
                          {remove.isPending ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </dialog>
                  )}
                </div>
              )}
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
