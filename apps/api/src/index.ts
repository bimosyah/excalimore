import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { buildAuthRouter, detectFirstRunAndIssueToken, injectContext, loadSession } from './auth'
import type { AppEnv } from './context'
import { createDbClient } from './db/client'
import { loadEnv } from './env'

const env = loadEnv()
const db = createDbClient(env.DATABASE_URL)

const app = new Hono<AppEnv>()

app.use('*', injectContext(db, env))
app.use('*', loadSession())

app.get('/api/health', (c) => c.json({ status: 'ok', service: 'excalimore-api' }))

// Auth router applies CSRF protection internally on routes that require an
// existing session (logout, invite). Signup/login do not need CSRF — there is
// no authenticated state yet to forge.
app.route('/api/auth', buildAuthRouter())

app.notFound((c) => c.json({ error: 'Not Found' }, 404))

app.onError((err, c) => {
  // HTTPException already carries a Response; let Hono surface it.
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
