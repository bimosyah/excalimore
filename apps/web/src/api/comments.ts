import {
  CommentSchema,
  type CreateCommentRequestSchema,
  type UpdateCommentRequestSchema,
} from '@excalimore/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { apiFetch } from './client'

const ListResponseSchema = z.object({ comments: z.array(CommentSchema) })
const CreateResponseSchema = z.object({ comment: CommentSchema })
const OkSchema = z.object({ ok: z.boolean() })

export type CommentListOptions = { includeResolved?: boolean }

export const commentEndpoints = {
  list: (sceneId: string, opts: CommentListOptions = {}): string => {
    const base = `/api/scenes/${sceneId}/comments`
    return opts.includeResolved ? `${base}?include_resolved=true` : base
  },
  create: (sceneId: string): string => `/api/scenes/${sceneId}/comments`,
  item: (id: string): string => `/api/comments/${id}`,
}

export function commentsQueryKey(sceneId: string, opts: CommentListOptions = {}) {
  return ['comments', sceneId, opts.includeResolved ?? false] as const
}

export function useComments(sceneId: string, opts: CommentListOptions = {}) {
  return useQuery({
    queryKey: commentsQueryKey(sceneId, opts),
    queryFn: async () => {
      const data = await apiFetch(commentEndpoints.list(sceneId, opts), {
        schema: ListResponseSchema,
      })
      return data.comments
    },
    enabled: Boolean(sceneId),
  })
}

export function useCreateComment(sceneId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: z.infer<typeof CreateCommentRequestSchema>) =>
      apiFetch(commentEndpoints.create(sceneId), {
        method: 'POST',
        body: vars,
        schema: CreateResponseSchema,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', sceneId] })
    },
  })
}

export function useUpdateComment(sceneId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; patch: z.infer<typeof UpdateCommentRequestSchema> }) =>
      apiFetch(commentEndpoints.item(vars.id), {
        method: 'PATCH',
        body: vars.patch,
        schema: OkSchema,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', sceneId] })
    },
  })
}

export function useDeleteComment(sceneId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      apiFetch(commentEndpoints.item(id), { method: 'DELETE', schema: OkSchema }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', sceneId] })
    },
  })
}
