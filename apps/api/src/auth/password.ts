import argon2 from 'argon2'

// OWASP-recommended argon2id parameters for interactive logins, 2026.
// Tune with benchmarking on the target box if first-login feels slow (>250ms).
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, HASH_OPTIONS)
}

/**
 * Returns true iff the provided plaintext matches the stored hash.
 * Returns false (does not throw) on malformed/invalid hash strings — so
 * callers can treat any failure uniformly without leaking error shape.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(storedHash, plain)
  } catch {
    return false
  }
}
