import {
  type CreateSceneRequestSchema,
  type ExcalidrawSceneDataSchema,
  SceneSchema,
  type UpdateSceneRequestSchema,
} from '@excalimore/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { apiFetch } from './client'

const ListItemSchema = SceneSchema.omit({ data: true }).extend({
  permission: z.enum(['view', 'edit']).optional(),
})
const ListResponseSchema = z.object({ scenes: z.array(ListItemSchema) })
const SceneDetailSchema = z.object({
  scene: SceneSchema,
  role: z.enum(['owner', 'edit', 'view']).optional(),
})
const CreateResponseSchema = z.object({ scene: SceneSchema })
const OkSchema = z.object({ ok: z.boolean() })

export type SceneListItem = z.infer<typeof ListItemSchema>

export function useScenes(opts: { folderId?: string | null; shared?: boolean } = {}) {
  const params = new URLSearchParams()
  if (opts.folderId) params.set('folder_id', opts.folderId)
  if (opts.shared) params.set('shared', 'true')
  const query = params.toString()
  return useQuery({
    queryKey: ['scenes', opts] as const,
    queryFn: async () => {
      const data = await apiFetch(`/api/scenes${query ? `?${query}` : ''}`, {
        schema: ListResponseSchema,
      })
      return data.scenes
    },
  })
}

export function useScene(id: string | undefined) {
  return useQuery({
    queryKey: ['scene', id] as const,
    enabled: Boolean(id),
    queryFn: async () => apiFetch(`/api/scenes/${id}`, { schema: SceneDetailSchema }),
  })
}

export function useCreateScene() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: z.infer<typeof CreateSceneRequestSchema>) =>
      apiFetch('/api/scenes', { method: 'POST', body: vars, schema: CreateResponseSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scenes'] }),
  })
}

export function useSaveScene(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: z.infer<typeof ExcalidrawSceneDataSchema>) =>
      apiFetch(`/api/scenes/${id}`, {
        method: 'PATCH',
        body: { data } satisfies z.infer<typeof UpdateSceneRequestSchema>,
        schema: OkSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scene', id] }),
  })
}

/**
 * Persist a freshly-rendered thumbnail for the scene. Kept separate from
 * `useSaveScene` so the data save and the thumbnail save can be debounced
 * independently — the data save is the user's primary edit path; the
 * thumbnail is a derivative and runs on a slower cadence so we don't burn
 * CPU on the export pipeline during a flurry of edits.
 *
 * The home grid (`['scenes']` query key) is invalidated on success so cards
 * refresh with the new image without requiring a reload.
 */
export function useSaveSceneThumbnail(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (thumbnailUrl: string) =>
      apiFetch(`/api/scenes/${id}`, {
        method: 'PATCH',
        body: { thumbnailUrl } satisfies z.infer<typeof UpdateSceneRequestSchema>,
        schema: OkSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scenes'] }),
  })
}

export function useRenameScene(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) =>
      apiFetch(`/api/scenes/${id}`, {
        method: 'PATCH',
        body: { name } satisfies z.infer<typeof UpdateSceneRequestSchema>,
        schema: OkSchema,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scene', id] })
      qc.invalidateQueries({ queryKey: ['scenes'] })
    },
  })
}

export function useDeleteScene() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      apiFetch(`/api/scenes/${id}`, { method: 'DELETE', schema: OkSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scenes'] }),
  })
}
