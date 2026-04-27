export interface DebouncedFn<Args extends unknown[]> {
  (...args: Args): void
  cancel(): void
}

/**
 * Returns a debounced version of `fn` — calls within `delayMs` of each other
 * coalesce; only the trailing call's args are passed.
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
): DebouncedFn<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastArgs: Args | undefined

  const debounced = ((...args: Args) => {
    lastArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      if (lastArgs) fn(...lastArgs)
      lastArgs = undefined
    }, delayMs)
  }) as DebouncedFn<Args>

  debounced.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    lastArgs = undefined
  }

  return debounced
}
