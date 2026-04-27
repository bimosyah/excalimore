import { type SseEvent, SseEventSchema } from '@excalimore/types'

/**
 * Subscribe to per-scene server-sent events. The browser's native EventSource
 * handles reconnection itself; the React caller should refetch the comment
 * list on focus/visibility changes to reconcile any events missed during the
 * gap (per spec §7).
 */
export function subscribeToSceneEvents(
  sceneId: string,
  onEvent: (event: SseEvent) => void,
): () => void {
  const url = `/api/events?scene_id=${encodeURIComponent(sceneId)}`
  const source = new EventSource(url, { withCredentials: true })

  source.onmessage = (msg: MessageEvent) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(msg.data)
    } catch {
      return
    }
    const result = SseEventSchema.safeParse(parsed)
    if (!result.success) return
    onEvent(result.data)
  }

  return () => source.close()
}
