import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commentEndpoints } from '../../src/api/comments'

beforeEach(() => {
  document.cookie = 'excalimore_csrf=test-csrf; path=/'
})
afterEach(() => {
  document.cookie = 'excalimore_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
  vi.restoreAllMocks()
})

describe('commentEndpoints', () => {
  it('list URL omits include_resolved when false', () => {
    expect(commentEndpoints.list('s1', { includeResolved: false })).toBe('/api/scenes/s1/comments')
  })
  it('list URL adds include_resolved=true when true', () => {
    expect(commentEndpoints.list('s1', { includeResolved: true })).toBe(
      '/api/scenes/s1/comments?include_resolved=true',
    )
  })
  it('create URL is /scenes/:id/comments', () => {
    expect(commentEndpoints.create('s1')).toBe('/api/scenes/s1/comments')
  })
  it('item URL is /comments/:id', () => {
    expect(commentEndpoints.item('c1')).toBe('/api/comments/c1')
  })
})
