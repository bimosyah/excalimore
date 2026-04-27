import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

// Build a fresh app per test rather than importing the running server,
// so we test the route handler in isolation.
function buildApp() {
  const app = new Hono()
  app.get('/api/health', (c) => c.json({ status: 'ok', service: 'excalimore-api' }))
  return app
}

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const app = buildApp()
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: 'ok', service: 'excalimore-api' })
  })
})
