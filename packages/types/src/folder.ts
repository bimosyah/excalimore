import { z } from 'zod'

export const FolderSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Folder = z.infer<typeof FolderSchema>

export const CreateFolderRequestSchema = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().uuid().nullable().optional(),
})
export type CreateFolderRequest = z.infer<typeof CreateFolderRequestSchema>

export const UpdateFolderRequestSchema = CreateFolderRequestSchema.partial()
export type UpdateFolderRequest = z.infer<typeof UpdateFolderRequestSchema>

export const MAX_FOLDER_DEPTH = 5
