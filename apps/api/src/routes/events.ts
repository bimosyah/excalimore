import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { getSceneAccess, roleAllows } from '../access'
import { requireAuth } from '../auth/middleware'
import type { AppEnv } from '../context'
import { eventBroker } from '../events/broker'
import { httpError } from '../lib/http-errors'

export function buildEventsRouter(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('*', requireAuth())

  app.get('/', async (c) => {
    const sceneId = c.req.query('scene_id')
    if (!sceneId) throw httpError('invalid_input', 'scene_id query param required')
    const me = c.var.user!
    const role = await getSceneAccess(c.var.db, me.id, sceneId)
    if (!roleAllows(role, 'view')) throw httpError('not_found', 'scene not found')

    return streamSSE(c, async (stream) => {
      // Subscriber writes directly to the stream so events deliver immediately
      // (no waiting for the heartbeat tick to drain a queue).
      const unsub = eventBroker.subscribe(sceneId, (event) => {
        if (stream.aborted) return
        stream
          .writeSSE({ event: 'message', data: JSON.stringify(event) })
          .catch(() => {
            /* swallow — client probably disconnected */
          })
      })

      try {
        await stream.writeSSE({ event: 'ready', data: JSON.stringify({ sceneId }) })
        // Heartbeat keeps proxies (Caddy, Cloudflare) from idling the connection.
        while (!stream.aborted) {
          await stream.sleep(15_000)
          if (stream.aborted) break
          try {
            await stream.writeSSE({ event: 'ping', data: 'keepalive' })
          } catch {
            break
          }
        }
      } finally {
        unsub()
      }
    })
  })

  return app
}
