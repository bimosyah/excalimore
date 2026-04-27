import type { Comment } from '@excalimore/types'
import { useState } from 'react'

export interface CommentPinProps {
  comments: Comment[]
  screenX: number
  screenY: number
  size: number
  isOrphan?: boolean
  canResolve: (commentId: string) => boolean
  onResolve: (commentId: string) => void
}

/**
 * Renders one (or many — clustered) comments at a given screen-space position.
 * Click toggles a popover with each comment body and a Resolve button shown
 * only to the comment author or the scene owner. Replies are out of MVP scope
 * (spec §11) so the popover deliberately has no reply input.
 */
export function CommentPin(props: CommentPinProps) {
  const [open, setOpen] = useState(false)
  const count = props.comments.length

  return (
    <div className="comment-pin-wrapper" style={{ left: props.screenX, top: props.screenY }}>
      <button
        type="button"
        className={`comment-pin${props.isOrphan ? ' is-orphan' : ''}`}
        style={{ width: props.size, height: props.size }}
        onClick={() => setOpen((v) => !v)}
        aria-label={`${count} comment${count > 1 ? 's' : ''}`}
        data-testid="comment-pin"
      >
        {count}
      </button>
      {open && (
        <div className="comment-pin-popover">
          {props.comments.map((c) => (
            <article key={c.id} className="comment-pin-item">
              <p className="comment-pin-body">{c.body}</p>
              {c.resolved ? (
                <span className="muted comment-pin-meta">resolved</span>
              ) : props.canResolve(c.id) ? (
                <button
                  type="button"
                  className="app-link-button"
                  onClick={() => props.onResolve(c.id)}
                >
                  Resolve
                </button>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
