import {
  type CreateFolderRequestSchema,
  FolderSchema,
  type UpdateFolderRequestSchema,
} from '@excalimore/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { apiFetch } from './client'

const ListFoldersSchema = z.object({ folders: z.array(FolderSchema) })
const CreateFolderResponseSchema = z.object({ folder: FolderSchema })
const OkSchema = z.object({ ok: z.boolean() })

export function useFolders() {
  return useQuery({
    queryKey: ['folders'] as const,
    queryFn: async () => {
      const data = await apiFetch('/api/folders', { schema: ListFoldersSchema })
      return data.folders
    },
  })
}

export function useCreateFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: z.infer<typeof CreateFolderRequestSchema>) =>
      apiFetch('/api/folders', { method: 'POST', body: vars, schema: CreateFolderResponseSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['folders'] }),
  })
}

export function useUpdateFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; patch: z.infer<typeof UpdateFolderRequestSchema> }) =>
      apiFetch(`/api/folders/${vars.id}`, {
        method: 'PATCH',
        body: vars.patch,
        schema: OkSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['folders'] }),
  })
}

export function useDeleteFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      apiFetch(`/api/folders/${id}`, { method: 'DELETE', schema: OkSchema }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['folders'] })
      qc.invalidateQueries({ queryKey: ['scenes'] })
    },
  })
}
