import { z } from 'zod'

export const PermissionSchema = z.enum(['view', 'edit'])
export type Permission = z.infer<typeof PermissionSchema>

export const ShareGrantSchema = z.object({
  id: z.string().uuid(),
  sceneId: z.string().uuid(),
  userId: z.string().uuid(),
  permission: PermissionSchema,
  grantedBy: z.string().uuid(),
  createdAt: z.string().datetime(),
})
export type ShareGrant = z.infer<typeof ShareGrantSchema>

export const CreateGrantRequestSchema = z.object({
  userId: z.string().uuid(),
  permission: PermissionSchema,
})
export type CreateGrantRequest = z.infer<typeof CreateGrantRequestSchema>
