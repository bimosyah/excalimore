import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../src/auth/password'

describe('hashPassword', () => {
  it('produces an argon2id hash starting with $argon2id$', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).toMatch(/^\$argon2id\$/)
  })

  it('produces different hashes for the same password (different salt)', async () => {
    const hashA = await hashPassword('same-password')
    const hashB = await hashPassword('same-password')
    expect(hashA).not.toBe(hashB)
  })
})

describe('verifyPassword', () => {
  it('verifies the correct password', async () => {
    const hash = await hashPassword('hunter2')
    expect(await verifyPassword(hash, 'hunter2')).toBe(true)
  })

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('hunter2')
    expect(await verifyPassword(hash, 'hunter3')).toBe(false)
  })

  it('returns false on malformed hash rather than throwing', async () => {
    expect(await verifyPassword('not-a-real-hash', 'whatever')).toBe(false)
  })
})
