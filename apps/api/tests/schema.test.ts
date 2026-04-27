import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { type DbClient, createDbClient } from '../src/db/client'
import { users } from '../src/db/schema'

let db: DbClient

beforeAll(() => {
  db = createDbClient(process.env.DATABASE_URL ?? '')
})

describe('users table', () => {
  it('inserts and reads back a user', async () => {
    const [created] = await db
      .insert(users)
      .values({
        email: 'schema-test@example.com',
        name: 'Schema Test',
        passwordHash: 'placeholder-hash',
      })
      .returning()

    expect(created).toBeDefined()
    expect(created!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(created!.role).toBe('user')

    const fetched = await db.select().from(users).where(eq(users.id, created!.id))
    expect(fetched).toHaveLength(1)
    expect(fetched[0]!.email).toBe('schema-test@example.com')

    await db.delete(users).where(eq(users.id, created!.id))
  })

  it('rejects duplicate email', async () => {
    await db.insert(users).values({
      email: 'dup@example.com',
      name: 'A',
      passwordHash: 'h',
    })

    await expect(
      db.insert(users).values({ email: 'dup@example.com', name: 'B', passwordHash: 'h' }),
    ).rejects.toThrow()

    await db.delete(users).where(eq(users.email, 'dup@example.com'))
  })
})
