import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { loadEnv } from './env'

const env = loadEnv()
const app = new Hono()

app.get('/api/health', (c) => c.json({ status: 'ok', service: 'excalimore-api' }))

app.notFound((c) => c.json({ error: 'Not Found' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal Server Error' }, 500)
})

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`excalimore-api listening on http://localhost:${info.port}`)
})
