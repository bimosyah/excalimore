import { afterEach, describe, expect, it } from 'vitest'
import { readCsrfToken } from '../../src/lib/csrf'

afterEach(() => {
  document.cookie = 'excalimore_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
})

describe('readCsrfToken', () => {
  it('returns null when cookie is absent', () => {
    expect(readCsrfToken()).toBeNull()
  })

  it('returns the token value when present', () => {
    document.cookie = 'excalimore_csrf=abc123; path=/'
    expect(readCsrfToken()).toBe('abc123')
  })

  it('decodes percent-encoded values', () => {
    document.cookie = `excalimore_csrf=${encodeURIComponent('a/b+c')}; path=/`
    expect(readCsrfToken()).toBe('a/b+c')
  })

  it('ignores other cookies', () => {
    document.cookie = 'other=value; path=/'
    document.cookie = 'excalimore_csrf=token; path=/'
    expect(readCsrfToken()).toBe('token')
  })
})
