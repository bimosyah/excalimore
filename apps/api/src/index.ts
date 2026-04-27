import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { buildAuthRouter, detectFirstRunAndIssueToken, injectContext, loadSession } from './auth'
import type { AppEnv } from './context'
import { createDbClient } from './db/client'
import { loadEnv } from './env'
import { buildCommentItemRouter } from './routes/comments'
import { buildEventsRouter } from './routes/events'
import { buildFoldersRouter } from './routes/folders'
import { buildScenesRouter } from './routes/scenes'

const env = loadEnv()
const db = createDbClient(env.DATABASE_URL)

const app = new Hono<AppEnv>()

app.use('*', injectContext(db, env))
app.use('*', loadSession())

app.get('/api/health', (c) => c.json({ status: 'ok', service: 'excalimore-api' }))

app.route('/api/auth', buildAuthRouter())
app.route('/api/folders', buildFoldersRouter())
app.route('/api/scenes', buildScenesRouter())
app.route('/api/comments', buildCommentItemRouter())
app.route('/api/events', buildEventsRouter())

app.notFound((c) => c.json({ error: 'Not Found' }, 404))

app.onError((err, c) => {
  if (typeof (err as { getResponse?: unknown }).getResponse === 'function') {
    return (err as { getResponse: () => Response }).getResponse()
  }
  console.error(err)
  return c.json({ error: 'Internal Server Error' }, 500)
})

const bootstrapToken = await detectFirstRunAndIssueToken(db, env.BOOTSTRAP_TOKEN_TTL)
if (bootstrapToken) {
  console.log('')
  console.log('==========================================================')
  console.log('No users found. Bootstrap admin via:')
  console.log(`  ${env.PUBLIC_URL}/signup?bootstrap=${bootstrapToken}`)
  console.log(`  (valid for ${env.BOOTSTRAP_TOKEN_TTL} seconds)`)
  console.log('==========================================================')
  console.log('')
}

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`excalimore-api listening on http://localhost:${info.port}`)
})
