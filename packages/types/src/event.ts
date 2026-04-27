import { z } from 'zod'
import { CommentSchema } from './comment'

export const SseEventTypeSchema = z.enum([
  'comment.created',
  'comment.updated',
  'comment.resolved',
  'scene.updated',
])
export type SseEventType = z.infer<typeof SseEventTypeSchema>

export const CommentEventSchema = z.object({
  type: z.enum(['comment.created', 'comment.updated', 'comment.resolved']),
  payload: CommentSchema,
})

export const SceneUpdatedEventSchema = z.object({
  type: z.literal('scene.updated'),
  payload: z.object({ sceneId: z.string().uuid(), updatedAt: z.string().datetime() }),
})

export const SseEventSchema = z.union([CommentEventSchema, SceneUpdatedEventSchema])
export type SseEvent = z.infer<typeof SseEventSchema>
