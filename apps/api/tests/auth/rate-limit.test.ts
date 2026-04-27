import { describe, expect, it } from 'vitest'
import { createRateLimiter } from '../../src/auth/rate-limit'

describe('createRateLimiter', () => {
  it('allows up to limit requests within the window', () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000 })
    expect(rl.check('k')).toBe(true)
    expect(rl.check('k')).toBe(true)
    expect(rl.check('k')).toBe(true)
    expect(rl.check('k')).toBe(false) // 4th in window
  })

  it('tracks separate keys independently', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000 })
    expect(rl.check('a')).toBe(true)
    expect(rl.check('b')).toBe(true)
    expect(rl.check('a')).toBe(false)
    expect(rl.check('b')).toBe(false)
  })

  it('refills tokens after the window passes', () => {
    let now = 0
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now })
    expect(rl.check('k')).toBe(true)
    expect(rl.check('k')).toBe(false)
    now = 1500
    expect(rl.check('k')).toBe(true)
  })
})
