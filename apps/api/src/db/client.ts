import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type DbClient = ReturnType<typeof drizzle<typeof schema>>

export function createDbClient(databaseUrl: string): DbClient {
  const sql = postgres(databaseUrl, { prepare: false })
  return drizzle(sql, { schema })
}
