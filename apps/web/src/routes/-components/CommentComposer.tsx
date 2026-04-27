import { useEffect, useRef } from 'react'

export type ComposerTarget = {
  elementId: string
  sceneX: number
  sceneY: number
  screenX: number
  screenY: number
}

export interface CommentComposerProps {
  target: ComposerTarget
  body: string
  isSubmitting: boolean
  onChange: (body: string) => void
  onSubmit: () => void
  onCancel: () => void
}

/**
 * Inline textarea popover for composing a new anchored comment. The parent
 * owns the body/target state so it can place the corresponding pin once the
 * POST resolves; this component is intentionally controlled.
 */
export function CommentComposer(props: CommentComposerProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <div
      className="comment-composer"
      style={{ left: props.target.screenX, top: props.target.screenY + 16 }}
      data-testid="comment-composer"
    >
      <textarea
        ref={ref}
        value={props.body}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="Write a comment…"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            props.onCancel()
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            if (props.body.trim().length > 0) props.onSubmit()
          }
        }}
      />
      <div className="comment-composer-actions">
        <button type="button" className="app-link-button" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="app-button-primary"
          disabled={props.isSubmitting || props.body.trim().length === 0}
          onClick={props.onSubmit}
        >
          {props.isSubmitting ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  )
}
