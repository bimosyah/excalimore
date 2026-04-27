import { useEffect, useState } from 'react'

/**
 * `useState`-style boolean persisted to localStorage.
 *
 * - Default value applies until the first render reads localStorage,
 *   so SSR / first-paint behaviour is deterministic.
 * - The setter writes through synchronously; reading another tab's value
 *   would need a `storage` listener, which is out of scope for this hook.
 */
export function useCollapsed(key: string, defaultValue = false) {
  const [collapsed, setCollapsed] = useState(defaultValue)

  // Load from localStorage on mount (avoid SSR window access).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw !== null) setCollapsed(raw === '1')
    } catch {
      // Private mode / disabled storage — keep the default.
    }
  }, [key])

  useEffect(() => {
    try {
      window.localStorage.setItem(key, collapsed ? '1' : '0')
    } catch {
      // ignore
    }
  }, [key, collapsed])

  return [collapsed, setCollapsed] as const
}
