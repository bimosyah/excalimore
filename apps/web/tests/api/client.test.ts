import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ApiError, apiFetch } from '../../src/api/client'

const RESPONSE_SCHEMA = z.object({ ok: z.boolean() })

beforeEach(() => {
  document.cookie = 'excalimore_csrf=test-csrf; path=/'
})

afterEach(() => {
  document.cookie = 'excalimore_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
  vi.restoreAllMocks()
})

describe('apiFetch', () => {
  it('returns parsed body on 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const data = await apiFetch('/api/x', { schema: RESPONSE_SCHEMA })
    expect(data).toEqual({ ok: true })
  })

  it('attaches X-CSRF-Token on POST', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await apiFetch('/api/x', { method: 'POST', body: { a: 1 }, schema: RESPONSE_SCHEMA })
    const init = fetchSpy.mock.calls[0]![1]!
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('test-csrf')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ a: 1 }))
  })

  it('throws ApiError with code on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'unauthorized', message: 'go away' }), {
        status: 401,
      }),
    )
    await expect(apiFetch('/api/x', { schema: RESPONSE_SCHEMA })).rejects.toThrow(ApiError)
  })
})
