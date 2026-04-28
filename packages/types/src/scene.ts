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

// Thumbnails are stored as `data:image/png;base64,...` URLs. We don't use
// `z.string().url()` here because it rejects data URLs in some environments
// and we want a tight, predictable validator anyway. The hard size cap is
// enforced client-side before we PATCH; this is the schema-level shape check.
const ThumbnailUrlSchema = z
  .string()
  .min(1)
  .refine((s) => s.startsWith('data:image/') || /^https?:\/\//.test(s), {
    message: 'thumbnailUrl must be a data:image/* or http(s) URL',
  })

export const SceneSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  folderId: z.string().uuid().nullable(),
  name: z.string().min(1).max(200),
  data: ExcalidrawSceneDataSchema,
  thumbnailUrl: ThumbnailUrlSchema.nullable(),
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
  thumbnailUrl: ThumbnailUrlSchema.nullable().optional(),
})
export type UpdateSceneRequest = z.infer<typeof UpdateSceneRequestSchema>
