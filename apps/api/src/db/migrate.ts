import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { loadEnv } from '../env'
import { createDbClient } from './client'

async function main() {
  const env = loadEnv()
  const db = createDbClient(env.DATABASE_URL)
  console.log('Running migrations...')
  await migrate(db, { migrationsFolder: './drizzle' })
  console.log('Migrations complete.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
