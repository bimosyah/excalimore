import type { Context } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'

export const SESSION_COOKIE = 'excalimore_session'
export const CSRF_COOKIE = 'excalimore_csrf'

interface SessionCookieOptions {
  maxAgeSeconds: number
  secure: boolean
}

export function setSessionCookie(c: Context, value: string, opts: SessionCookieOptions): void {
  setCookie(c, SESSION_COOKIE, value, {
    httpOnly: true,
    secure: opts.secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: opts.maxAgeSeconds,
  })
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

/**
 * CSRF cookie is intentionally NOT HttpOnly — frontend JS reads it and echoes
 * the value as the X-CSRF-Token header on mutating requests (double-submit pattern).
 */
export function setCsrfCookie(c: Context, value: string, secure: boolean): void {
  setCookie(c, CSRF_COOKIE, value, {
    httpOnly: false,
    secure,
    sameSite: 'Lax',
    path: '/',
  })
}

export function clearCsrfCookie(c: Context): void {
  deleteCookie(c, CSRF_COOKIE, { path: '/' })
}
