import { describe, expect, it } from 'vitest'
import { constantTimeEqual, generateToken } from '../../src/auth/ids'

describe('generateToken', () => {
  it('returns a base64url string of expected length for 32 bytes', () => {
    const token = generateToken(32)
    // 32 bytes of random data encoded as base64url ≈ 43 chars (no padding).
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token.length).toBeGreaterThanOrEqual(42)
    expect(token.length).toBeLessThanOrEqual(44)
  })

  it('produces different values each call', () => {
    const set = new Set(Array.from({ length: 100 }, () => generateToken(32)))
    expect(set.size).toBe(100)
  })

  it('respects requested byte length', () => {
    const short = generateToken(16)
    const long = generateToken(64)
    expect(short.length).toBeLessThan(long.length)
  })
})

describe('constantTimeEqual', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeEqual('hello', 'hello')).toBe(true)
  })

  it('returns false for different strings of same length', () => {
    expect(constantTimeEqual('hello', 'world')).toBe(false)
  })

  it('returns false for strings of different length without leaking length info', () => {
    expect(constantTimeEqual('a', 'abc')).toBe(false)
    expect(constantTimeEqual('abc', 'a')).toBe(false)
  })

  it('handles empty strings', () => {
    expect(constantTimeEqual('', '')).toBe(true)
    expect(constantTimeEqual('', 'a')).toBe(false)
  })
})
