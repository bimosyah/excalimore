import {
  type CreateInviteRequest,
  type PermissionSchema,
  ShareGrantSchema,
} from '@excalimore/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { apiFetch } from './client'

/**
 * GET /api/scenes/:id/grants returns the base grant fields enriched with
 * user identity (email + name) so the Share modal can render a meaningful
 * label without a follow-up fetch. The user fields are nullable to tolerate
 * orphan grants (user deleted but grant lingered).
 */
const GrantWithUserSchema = ShareGrantSchema.extend({
  userEmail: z.string().nullable(),
  userName: z.string().nullable(),
})
export type GrantWithUser = z.infer<typeof GrantWithUserSchema>

const ListResponseSchema = z.object({ grants: z.array(GrantWithUserSchema) })
const CreateResponseSchema = z.object({ grant: ShareGrantSchema })
const InviteResponseSchema = z.object({
  token: z.string(),
  url: z.string().url(),
})
const OkSchema = z.object({ ok: z.boolean() })

const grantsQueryKey = (sceneId: string) => ['grants', sceneId] as const

export function useSceneGrants(sceneId: string) {
  return useQuery({
    queryKey: grantsQueryKey(sceneId),
    enabled: Boolean(sceneId),
    queryFn: async () => {
      const data = await apiFetch(`/api/scenes/${sceneId}/grants`, {
        schema: ListResponseSchema,
      })
      return data.grants
    },
  })
}

export function useCreateGrant(sceneId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { userId: string; permission: z.infer<typeof PermissionSchema> }) =>
      apiFetch(`/api/scenes/${sceneId}/grants`, {
        method: 'POST',
        body: vars,
        schema: CreateResponseSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: grantsQueryKey(sceneId) }),
  })
}

export function useDeleteGrant(sceneId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (grantId: string) =>
      apiFetch(`/api/scenes/${sceneId}/grants/${grantId}`, {
        method: 'DELETE',
        schema: OkSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: grantsQueryKey(sceneId) }),
  })
}

/**
 * Generate an invite link scoped to the given scene. Server applies its
 * default expiry when `expiresAt` is omitted; callers may pass an ISO string
 * to override.
 */
export function useGenerateInvite(sceneId: string) {
  return useMutation({
    mutationFn: async (vars: {
      permission: z.infer<typeof PermissionSchema>
      expiresAt?: string
    }) =>
      apiFetch('/api/auth/invite', {
        method: 'POST',
        body: {
          sceneId,
          permission: vars.permission,
          ...(vars.expiresAt ? { expiresAt: vars.expiresAt } : {}),
        } satisfies CreateInviteRequest,
        schema: InviteResponseSchema,
      }),
  })
}
