import type { LoginRequestSchema, SignupRequestSchema } from '@excalimore/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { z } from 'zod'
import { z as zod } from 'zod'
import { ApiError, apiFetch } from './client'

const MeSchema = zod.object({
  user: zod.object({
    id: zod.string().uuid(),
    email: zod.string().email(),
    name: zod.string(),
    role: zod.enum(['user', 'admin']),
  }),
})

const SignupResponseSchema = zod.object({
  user: zod.object({
    id: zod.string().uuid(),
    email: zod.string().email(),
    name: zod.string(),
    role: zod.enum(['user', 'admin']).optional(),
  }),
  redirectTo: zod.string(),
})

const LoginResponseSchema = zod.object({
  user: zod.object({
    id: zod.string().uuid(),
    email: zod.string().email(),
    name: zod.string(),
  }),
})

const LogoutResponseSchema = zod.object({ ok: zod.boolean() })

export type Me = z.infer<typeof MeSchema>['user']

export function useMe() {
  return useQuery({
    queryKey: ['me'] as const,
    queryFn: async () => {
      try {
        const data = await apiFetch('/api/auth/me', { schema: MeSchema })
        return data.user
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: z.infer<typeof LoginRequestSchema>) =>
      apiFetch('/api/auth/login', { method: 'POST', body: vars, schema: LoginResponseSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
}

export function useSignup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: z.infer<typeof SignupRequestSchema>) =>
      apiFetch('/api/auth/signup', { method: 'POST', body: vars, schema: SignupResponseSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      apiFetch('/api/auth/logout', { method: 'POST', schema: LogoutResponseSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
}
