export interface ScenePoint {
  sceneX: number
  sceneY: number
}
export interface ScreenPoint {
  screenX: number
  screenY: number
}
export interface Viewport {
  scrollX: number
  scrollY: number
  zoom: number
}
export interface Box {
  width: number
  height: number
}

const PIN_MIN = 16
const PIN_MAX = 32
const PIN_BASE = 22 // visually pleasant size at zoom 1

/**
 * Convert a scene-space point to screen-space (CSS pixels) using Excalidraw's
 * viewport state. `scrollX`/`scrollY` are scene offsets (not DOM scroll), so
 * the canonical formula is `screen = (scene + scrollOffset) * zoom`.
 */
export function sceneToScreen(p: ScenePoint, v: Viewport): ScreenPoint {
  const zoom = v.zoom > 0 ? v.zoom : 1
  return {
    screenX: (p.sceneX + v.scrollX) * zoom,
    screenY: (p.sceneY + v.scrollY) * zoom,
  }
}

/**
 * Pin display size scales with zoom but is clamped between 16px and 32px so
 * the badge stays both legible at far zoom-out and not overwhelming at deep
 * zoom-in (spec §7 edge-case 4).
 */
export function clampPinSize(zoom: number): number {
  const target = PIN_BASE * zoom
  if (target < PIN_MIN) return PIN_MIN
  if (target > PIN_MAX) return PIN_MAX
  return target
}

/** Whether a screen-space point falls inside the canvas viewport box. */
export function isOnScreen(p: ScreenPoint, box: Box): boolean {
  return p.screenX >= 0 && p.screenY >= 0 && p.screenX <= box.width && p.screenY <= box.height
}
