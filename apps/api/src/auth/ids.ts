import { randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Generate a URL-safe random token of `bytes` random bytes encoded as base64url.
 * Used for session ids, invite tokens, bootstrap tokens, and CSRF tokens.
 */
export function generateToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url')
}

/**
 * Compare two strings in constant time to avoid leaking length-dependent timing.
 * Returns false for unequal lengths without short-circuiting.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) {
    // timingSafeEqual throws on length mismatch; do a dummy compare to keep
    // the cost roughly equal regardless of input lengths.
    timingSafeEqual(aBuf, aBuf)
    return false
  }
  return timingSafeEqual(aBuf, bBuf)
}
