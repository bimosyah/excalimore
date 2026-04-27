import type { Comment } from '@excalimore/types'

export interface CommentSidebarProps {
  comments: Comment[]
  isLoading: boolean
  includeResolved: boolean
  /** Set of comment ids whose anchor element no longer exists in the scene. */
  orphanIds: Set<string>
  onToggleResolved: (next: boolean) => void
  onSelect: (comment: Comment) => void
  onStartAdd: () => void
  isAdding: boolean
  /** Optional collapse handler — when provided, a chevron-right button is shown. */
  onCollapse?: () => void
}

/** Side panel listing every comment in the scene. */
export function CommentSidebar(props: CommentSidebarProps) {
  return (
    <aside className="comment-sidebar" aria-label="Comments">
      <header className="comment-sidebar-header">
        <strong>Comments</strong>
        <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
          <button
            type="button"
            className="app-link-button"
            onClick={props.onStartAdd}
            aria-pressed={props.isAdding}
            data-testid="comment-add-button"
          >
            {props.isAdding ? 'Cancel' : '+ Comment'}
          </button>
          {props.onCollapse && (
            <button
              type="button"
              onClick={props.onCollapse}
              className="app-icon-button"
              aria-label="Collapse comments"
              title="Collapse comments"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M9 6l6 6-6 6"
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
      </header>
      <label
        style={{
          padding: '0.5rem 1rem',
          display: 'flex',
          gap: '0.5rem',
          fontSize: '0.85em',
        }}
      >
        <input
          type="checkbox"
          checked={props.includeResolved}
          onChange={(e) => props.onToggleResolved(e.target.checked)}
        />
        Show resolved
      </label>
      <div className="comment-sidebar-list">
        {props.isLoading ? (
          <p className="comment-sidebar-empty">Loading…</p>
        ) : props.comments.length === 0 ? (
          <p className="comment-sidebar-empty">No comments yet.</p>
        ) : (
          props.comments.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`comment-sidebar-item${props.orphanIds.has(c.id) ? ' is-orphan' : ''}`}
              onClick={() => props.onSelect(c)}
              data-testid="comment-sidebar-item"
            >
              <div style={{ fontSize: '0.9em' }}>{c.body}</div>
              <small className="muted">
                {props.orphanIds.has(c.id) ? '(deleted element) · ' : ''}
                {c.resolved ? 'resolved · ' : ''}
                {new Date(c.createdAt).toLocaleString()}
              </small>
            </button>
          ))
        )}
      </div>
    </aside>
  )
}
