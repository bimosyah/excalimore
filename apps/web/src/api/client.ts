import type { z } from 'zod'
import { readCsrfToken } from '../lib/csrf'

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface ApiOptions<Schema extends z.ZodTypeAny> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  schema: Schema
  signal?: AbortSignal
}

export async function apiFetch<Schema extends z.ZodTypeAny>(
  path: string,
  opts: ApiOptions<Schema>,
): Promise<z.infer<Schema>> {
  const method = opts.method ?? 'GET'
  const headers: Record<string, string> = {}

  let body: BodyInit | undefined
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  if (method !== 'GET') {
    const csrf = readCsrfToken()
    if (csrf) headers['X-CSRF-Token'] = csrf
  }

  const res = await fetch(path, {
    method,
    headers,
    body,
    credentials: 'include',
    signal: opts.signal,
  })

  let parsedBody: unknown = null
  const text = await res.text()
  if (text.length > 0) {
    try {
      parsedBody = JSON.parse(text)
    } catch {
      // Non-JSON body — leave parsedBody as null.
    }
  }

  if (!res.ok) {
    const code = (parsedBody as { error?: string } | null)?.error ?? 'http_error'
    const message =
      (parsedBody as { message?: string } | null)?.message ?? `HTTP ${res.status}`
    throw new ApiError(code, message, res.status)
  }

  return opts.schema.parse(parsedBody)
}
