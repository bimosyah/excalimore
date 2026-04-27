import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeToSceneEvents } from '../../src/lib/comment-events'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  readyState = 1
  closed = false
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  close() {
    this.closed = true
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }
}

beforeEach(() => {
  FakeEventSource.instances = []
  ;(globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource = FakeEventSource
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('subscribeToSceneEvents', () => {
  it('opens an EventSource for the scene', () => {
    const onEvent = vi.fn()
    subscribeToSceneEvents('scene-1', onEvent)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0]!.url).toContain('scene_id=scene-1')
  })

  it('parses comment.created and forwards typed payload', () => {
    const onEvent = vi.fn()
    subscribeToSceneEvents('scene-1', onEvent)
    const fake = FakeEventSource.instances[0]!
    const payload = {
      id: '00000000-0000-0000-0000-000000000001',
      sceneId: '00000000-0000-0000-0000-000000000002',
      authorId: '00000000-0000-0000-0000-000000000003',
      elementId: 'el-1',
      xOffset: 0,
      yOffset: 0,
      lastKnownX: 1,
      lastKnownY: 2,
      body: 'hi',
      resolved: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    fake.emit({ type: 'comment.created', payload })
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith({ type: 'comment.created', payload })
  })

  it('ignores non-JSON / unknown event payloads', () => {
    const onEvent = vi.fn()
    subscribeToSceneEvents('scene-1', onEvent)
    const fake = FakeEventSource.instances[0]!
    fake.onmessage?.({ data: 'not json' } as MessageEvent)
    fake.emit({ type: 'mystery.event', payload: {} })
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('returns an unsubscribe that closes the connection', () => {
    const off = subscribeToSceneEvents('scene-1', vi.fn())
    off()
    expect(FakeEventSource.instances[0]!.closed).toBe(true)
  })
})
