import { constantTimeEqual, generateToken } from './ids'

const CSRF_TOKEN_BYTES = 32

export function generateCsrfToken(): string {
  return generateToken(CSRF_TOKEN_BYTES)
}

/**
 * Double-submit cookie pattern: the value carried in the CSRF cookie must equal
 * the value sent in the X-CSRF-Token header. Both must be present.
 */
export function verifyCsrf(
  cookieValue: string | undefined,
  headerValue: string | undefined,
): boolean {
  if (!cookieValue || !headerValue) return false
  return constantTimeEqual(cookieValue, headerValue)
}
