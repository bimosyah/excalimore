import { describe, expect, it } from 'vitest'
import { clampPinSize, isOnScreen, sceneToScreen } from '../../src/lib/comment-coords'

describe('sceneToScreen', () => {
  it('applies scrollX/scrollY offset and zoom', () => {
    expect(
      sceneToScreen({ sceneX: 100, sceneY: 200 }, { scrollX: 50, scrollY: 25, zoom: 2 }),
    ).toEqual({
      screenX: (100 + 50) * 2,
      screenY: (200 + 25) * 2,
    })
  })

  it('handles zero zoom safely (treats as 1)', () => {
    expect(sceneToScreen({ sceneX: 10, sceneY: 10 }, { scrollX: 0, scrollY: 0, zoom: 0 })).toEqual({
      screenX: 10,
      screenY: 10,
    })
  })
})

describe('clampPinSize', () => {
  it('clamps to 16px floor', () => {
    expect(clampPinSize(0.1)).toBe(16)
  })
  it('clamps to 32px ceiling', () => {
    expect(clampPinSize(10)).toBe(32)
  })
  it('falls between 16 and 32 at zoom 1', () => {
    expect(clampPinSize(1)).toBeGreaterThanOrEqual(16)
    expect(clampPinSize(1)).toBeLessThanOrEqual(32)
  })
})

describe('isOnScreen', () => {
  it('true when inside the viewport', () => {
    expect(isOnScreen({ screenX: 100, screenY: 100 }, { width: 800, height: 600 })).toBe(true)
  })
  it('false when off the right edge', () => {
    expect(isOnScreen({ screenX: 900, screenY: 100 }, { width: 800, height: 600 })).toBe(false)
  })
  it('false when off the top edge', () => {
    expect(isOnScreen({ screenX: 10, screenY: -10 }, { width: 800, height: 600 })).toBe(false)
  })
})
