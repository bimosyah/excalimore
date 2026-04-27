import { z } from 'zod'
import { PermissionSchema } from './grant'

export const InviteTokenSchema = z.object({
  token: z.string().min(20),
  sceneId: z.string().uuid().nullable(),
  permission: PermissionSchema.nullable(),
  createdBy: z.string().uuid(),
  expiresAt: z.string().datetime(),
  usedBy: z.string().uuid().nullable(),
  usedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export type InviteToken = z.infer<typeof InviteTokenSchema>

export const CreateInviteRequestSchema = z.object({
  sceneId: z.string().uuid().optional(),
  permission: PermissionSchema.optional(),
  expiresAt: z.string().datetime().optional(),
})
export type CreateInviteRequest = z.infer<typeof CreateInviteRequestSchema>

export const CreateInviteResponseSchema = z.object({
  token: z.string(),
  url: z.string().url(),
})
export type CreateInviteResponse = z.infer<typeof CreateInviteResponseSchema>
