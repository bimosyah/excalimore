import { describe, expect, it } from 'vitest'
import { LoginRequestSchema, SignupRequestSchema, UserSchema } from '../src'

describe('UserSchema', () => {
  it('accepts a valid user', () => {
    const result = UserSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      email: 'bimo@example.com',
      name: 'Bimo',
      role: 'admin',
      createdAt: '2026-04-27T12:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid email', () => {
    const result = UserSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      email: 'not-an-email',
      name: 'Bimo',
      role: 'user',
      createdAt: '2026-04-27T12:00:00.000Z',
    })
    expect(result.success).toBe(false)
  })
})

describe('SignupRequestSchema', () => {
  it('rejects passwords shorter than 8 chars', () => {
    const result = SignupRequestSchema.safeParse({
      token: 'a'.repeat(32),
      email: 'a@b.co',
      password: 'short',
      name: 'A',
    })
    expect(result.success).toBe(false)
  })
})

describe('LoginRequestSchema', () => {
  it('accepts non-empty password', () => {
    const result = LoginRequestSchema.safeParse({ email: 'a@b.co', password: 'x' })
    expect(result.success).toBe(true)
  })
})
