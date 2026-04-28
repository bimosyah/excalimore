import type { Permission } from '@excalimore/types'
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import {
  type GrantWithUser,
  useDeleteGrant,
  useGenerateInvite,
  useSceneGrants,
} from '../../api/grants'

export interface ShareModalProps {
  sceneId: string
  onClose: () => void
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function grantLabel(g: GrantWithUser): string {
  if (g.userName && g.userEmail) return `${g.userName} (${g.userEmail})`
  if (g.userEmail) return g.userEmail
  if (g.userName) return g.userName
  // Fall back to a short hash so orphan grants still have a stable label.
  return `User ${g.userId.slice(0, 8)}`
}

/**
 * Modal shown when the scene owner clicks "Share". Owners can:
 * - generate an invite link (view or edit) and copy it to the clipboard
 * - see who already has access and revoke individual grants
 *
 * Plain DOM modal (fixed-position overlay + click-outside) — no Radix or
 * other dialog libraries to keep the dependency surface minimal.
 */
export function ShareModal({ sceneId, onClose }: ShareModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const [permission, setPermission] = useState<Permission>('view')
  const [expiresAt, setExpiresAt] = useState('')
  const [generated, setGenerated] = useState<{ url: string } | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const grantsQ = useSceneGrants(sceneId)
  const generate = useGenerateInvite(sceneId)
  const revoke = useDeleteGrant(sceneId)

  // Close on Escape — typical modal affordance.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleGenerate() {
    setErrorMessage(null)
    setCopyState('idle')
    try {
      // The browser's <input type="datetime-local"> emits a value without
      // timezone (e.g. "2026-04-30T10:00"); coerce to ISO so the API can
      // parse it as UTC. Empty string means "use the server default expiry".
      const expiresIso = expiresAt ? new Date(expiresAt).toISOString() : undefined
      const res = await generate.mutateAsync({ permission, expiresAt: expiresIso })
      setGenerated({ url: res.url })
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to generate invite link'
      setErrorMessage(msg)
    }
  }

  async function handleCopy() {
    if (!generated) return
    try {
      await navigator.clipboard.writeText(generated.url)
      setCopyState('copied')
      // Revert the label after a moment so a second copy isn't ambiguous.
      setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      setCopyState('error')
    }
  }

  async function handleRevoke(grantId: string) {
    setErrorMessage(null)
    try {
      await revoke.mutateAsync(grantId)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to revoke access'
      setErrorMessage(msg)
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-out is a mouse-only affordance; Escape-to-close is handled globally above so keyboard users have an equivalent path.
    <div
      className="share-modal-backdrop"
      // Click-outside: clicks on the backdrop close, clicks on the dialog
      // itself stop propagation so they don't.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="presentation"
    >
      <dialog
        ref={dialogRef}
        open
        className="share-modal"
        aria-modal="true"
        aria-labelledby="share-modal-title"
        data-testid="share-modal"
      >
        <div className="share-modal-header">
          <h2 id="share-modal-title">Share scene</h2>
          <button
            type="button"
            className="app-icon-button"
            onClick={onClose}
            aria-label="Close share dialog"
          >
            ×
          </button>
        </div>

        <section className="share-modal-section">
          <h3>Generate invite link</h3>
          <p className="muted share-modal-hint">
            Anyone with this link can sign up and access this scene with the chosen permission.
          </p>
          <fieldset className="share-permission-group">
            <legend className="share-modal-legend">Permission</legend>
            <label className="share-permission-option">
              <input
                type="radio"
                name="share-permission"
                value="view"
                checked={permission === 'view'}
                onChange={() => setPermission('view')}
              />
              <span>View only</span>
            </label>
            <label className="share-permission-option">
              <input
                type="radio"
                name="share-permission"
                value="edit"
                checked={permission === 'edit'}
                onChange={() => setPermission('edit')}
              />
              <span>Can edit</span>
            </label>
          </fieldset>
          <label className="share-modal-field">
            <span>Expires (optional)</span>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </label>
          <div className="share-modal-actions">
            <button
              type="button"
              className="app-button-primary"
              onClick={handleGenerate}
              disabled={generate.isPending}
              data-testid="share-generate-button"
            >
              {generate.isPending ? 'Generating…' : 'Generate link'}
            </button>
          </div>

          {generated && (
            <div className="share-invite-result" data-testid="share-invite-result">
              <input
                type="text"
                readOnly
                value={generated.url}
                className="share-invite-url"
                aria-label="Invite URL"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                className="app-button-primary"
                onClick={handleCopy}
                data-testid="share-copy-button"
              >
                {copyState === 'copied'
                  ? 'Copied!'
                  : copyState === 'error'
                    ? 'Copy failed'
                    : 'Copy'}
              </button>
            </div>
          )}
        </section>

        <section className="share-modal-section">
          <h3>People with access</h3>
          {grantsQ.isLoading && <p className="muted">Loading…</p>}
          {grantsQ.error && <p className="share-modal-error">Could not load access list.</p>}
          {grantsQ.data && grantsQ.data.length === 0 && (
            <p className="muted share-modal-hint">No one else has access yet.</p>
          )}
          {grantsQ.data && grantsQ.data.length > 0 && (
            <ul className="share-grant-list" data-testid="share-grant-list">
              {grantsQ.data.map((g) => (
                <li key={g.id} className="share-grant-item" data-testid="share-grant-item">
                  <div className="share-grant-meta">
                    <strong>{grantLabel(g)}</strong>
                    <small className="muted">
                      {g.permission} · added {formatDate(g.createdAt)}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="app-link-button share-grant-revoke"
                    onClick={() => handleRevoke(g.id)}
                    disabled={revoke.isPending}
                    data-testid="share-revoke-button"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {errorMessage && (
          <p className="share-modal-error" data-testid="share-modal-error">
            {errorMessage}
          </p>
        )}
      </dialog>
    </div>
  )
}
