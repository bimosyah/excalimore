import type { CSSProperties } from 'react'

export interface OffscreenIndicatorProps {
  count: number
  edge: 'top' | 'bottom' | 'left' | 'right'
  /** Position along the chosen edge, in CSS pixels relative to the canvas. */
  position: number
  onClick: () => void
}

/**
 * Edge-of-canvas chip that points toward an off-viewport pin. Clicking pans
 * the canvas to that pin (handled by the overlay which knows scene-space).
 */
export function OffscreenIndicator(props: OffscreenIndicatorProps) {
  const style: CSSProperties = (() => {
    switch (props.edge) {
      case 'top':
        return { top: 4, left: props.position, transform: 'translateX(-50%)' }
      case 'bottom':
        return { bottom: 4, left: props.position, transform: 'translateX(-50%)' }
      case 'left':
        return { left: 4, top: props.position, transform: 'translateY(-50%)' }
      case 'right':
        return { right: 4, top: props.position, transform: 'translateY(-50%)' }
    }
  })()

  return (
    <button
      type="button"
      className="comment-offscreen"
      style={style}
      onClick={props.onClick}
      data-testid="comment-offscreen"
    >
      {props.count} ↗
    </button>
  )
}
