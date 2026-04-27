import { z } from 'zod'

export const CommentSchema = z.object({
  id: z.string().uuid(),
  sceneId: z.string().uuid(),
  authorId: z.string().uuid(),
  elementId: z.string().min(1),
  xOffset: z.number().int(),
  yOffset: z.number().int(),
  lastKnownX: z.number().nullable(),
  lastKnownY: z.number().nullable(),
  body: z.string().min(1).max(5000),
  resolved: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Comment = z.infer<typeof CommentSchema>

export const CreateCommentRequestSchema = z.object({
  elementId: z.string().min(1),
  xOffset: z.number().int().default(0),
  yOffset: z.number().int().default(0),
  lastKnownX: z.number().nullable().optional(),
  lastKnownY: z.number().nullable().optional(),
  body: z.string().min(1).max(5000),
})
export type CreateCommentRequest = z.infer<typeof CreateCommentRequestSchema>

export const UpdateCommentRequestSchema = z.object({
  body: z.string().min(1).max(5000).optional(),
  resolved: z.boolean().optional(),
})
export type UpdateCommentRequest = z.infer<typeof UpdateCommentRequestSchema>
