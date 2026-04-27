import { HTTPException } from 'hono/http-exception'

type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid_input'
  | 'rate_limited'
  | 'internal'

const STATUS_BY_CODE = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invalid_input: 422,
  rate_limited: 429,
  internal: 500,
} as const satisfies Record<ErrorCode, number>

export function httpError(code: ErrorCode, message: string): HTTPException {
  const status = STATUS_BY_CODE[code]
  return new HTTPException(status, {
    message,
    res: new Response(JSON.stringify({ error: code, message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  })
}
