import { z } from 'zod'

export const UserRoleSchema = z.enum(['user', 'admin'])
export type UserRole = z.infer<typeof UserRoleSchema>

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: UserRoleSchema,
  createdAt: z.string().datetime(),
})
export type User = z.infer<typeof UserSchema>

export const PublicUserSchema = UserSchema.omit({ role: true })
export type PublicUser = z.infer<typeof PublicUserSchema>

export const SignupRequestSchema = z.object({
  token: z.string().min(20),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
})
export type SignupRequest = z.infer<typeof SignupRequestSchema>

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
export type LoginRequest = z.infer<typeof LoginRequestSchema>
