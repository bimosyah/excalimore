import { z } from 'zod'

// We keep ExcalidrawSceneData loose: matches upstream .excalidraw file format,
// which evolves independently of us. Upstream owns the element/appState shape.
export const ExcalidrawSceneDataSchema = z
  .object({
    type: z.literal('excalidraw').optional(),
    version: z.number().optional(),
    source: z.string().optional(),
    elements: z.array(z.unknown()).default([]),
    appState: z.record(z.unknown()).default({}),
    files: z.record(z.unknown()).default({}),
  })
  .passthrough()
export type ExcalidrawSceneData = z.infer<typeof ExcalidrawSceneDataSchema>

export const SceneSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  folderId: z.string().uuid().nullable(),
  name: z.string().min(1).max(200),
  data: ExcalidrawSceneDataSchema,
  thumbnailUrl: z.string().url().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Scene = z.infer<typeof SceneSchema>

export const CreateSceneRequestSchema = z.object({
  name: z.string().min(1).max(200),
  folderId: z.string().uuid().nullable().optional(),
})
export type CreateSceneRequest = z.infer<typeof CreateSceneRequestSchema>

export const UpdateSceneRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  folderId: z.string().uuid().nullable().optional(),
  data: ExcalidrawSceneDataSchema.optional(),
})
export type UpdateSceneRequest = z.infer<typeof UpdateSceneRequestSchema>
