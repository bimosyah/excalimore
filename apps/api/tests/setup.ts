import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

let container: StartedPostgreSqlContainer | undefined

export async function setup() {
  container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('excalimore_test')
    .withUsername('test')
    .withPassword('test')
    .start()

  const url = container.getConnectionUri()
  process.env.DATABASE_URL = url
  process.env.SESSION_SECRET = 'test-session-secret-32-bytes-long'
  process.env.PUBLIC_URL = 'http://localhost:5173'

  const sql = postgres(url, { prepare: false })
  const db = drizzle(sql)
  await migrate(db, { migrationsFolder: './drizzle' })
  await sql.end()
}

export async function teardown() {
  await container?.stop()
}
