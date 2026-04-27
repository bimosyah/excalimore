import type { SseEvent } from '@excalimore/types'

type Subscriber = (event: SseEvent) => void

class EventBroker {
  private byScene = new Map<string, Set<Subscriber>>()

  subscribe(sceneId: string, fn: Subscriber): () => void {
    let set = this.byScene.get(sceneId)
    if (!set) {
      set = new Set()
      this.byScene.set(sceneId, set)
    }
    set.add(fn)
    return () => {
      const cur = this.byScene.get(sceneId)
      if (!cur) return
      cur.delete(fn)
      if (cur.size === 0) this.byScene.delete(sceneId)
    }
  }

  publish(sceneId: string, event: SseEvent): void {
    const set = this.byScene.get(sceneId)
    if (!set) return
    for (const fn of set) fn(event)
  }
}

export const eventBroker = new EventBroker()
