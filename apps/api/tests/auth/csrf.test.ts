import { describe, expect, it } from 'vitest'
import { generateCsrfToken, verifyCsrf } from '../../src/auth/csrf'

describe('generateCsrfToken', () => {
  it('returns a non-empty random string', () => {
    const a = generateCsrfToken()
    const b = generateCsrfToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(20)
  })
})

describe('verifyCsrf', () => {
  it('accepts matching cookie and header', () => {
    const token = generateCsrfToken()
    expect(verifyCsrf(token, token)).toBe(true)
  })

  it('rejects mismatched cookie and header', () => {
    expect(verifyCsrf(generateCsrfToken(), generateCsrfToken())).toBe(false)
  })

  it('rejects when cookie is missing', () => {
    expect(verifyCsrf(undefined, 'header-only')).toBe(false)
  })

  it('rejects when header is missing', () => {
    expect(verifyCsrf('cookie-only', undefined)).toBe(false)
  })
})
