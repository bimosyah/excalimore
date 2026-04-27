const CSRF_COOKIE = 'excalimore_csrf'

/** Read the CSRF token from document.cookie, or null if absent. */
export function readCsrfToken(): string | null {
  const cookies = document.cookie.split(';')
  for (const c of cookies) {
    const [k, v] = c.trim().split('=', 2)
    if (k === CSRF_COOKIE && v) return decodeURIComponent(v)
  }
  return null
}
