import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AmphoreusClientModel } from '../src/client/state.ts'

class FakeSource {
  static instances: FakeSource[] = []
  readyState = 0
  onerror: (() => void) | null = null
  listeners = new Map<string, Array<() => void>>()
  readonly url: string
  constructor(url: string) { this.url = url; FakeSource.instances.push(this) }
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  emit(type: string): void { for (const listener of this.listeners.get(type) ?? []) listener() }
  fail(state = 2): void { this.readyState = state; this.onerror?.() }
  close(): void { this.readyState = 2 }
}

async function flush(): Promise<void> { for (let i = 0; i < 12; i++) await Promise.resolve() }

async function withHarness(run: (h: {
  model: AmphoreusClientModel
  timers: Map<number, { delay: number; callback: () => void }>
  fire(): Promise<number>
  setFetch(fetcher: typeof fetch): void
  calls(): number
  ready(): void
}) => Promise<void>): Promise<void> {
  const previous = new Map(['fetch', 'window', 'EventSource'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  const timers = new Map<number, { delay: number; callback: () => void }>()
  let timerId = 0
  let calls = 0
  let fetcher: typeof fetch = async () => new Response(null, { status: 404 })
  FakeSource.instances = []
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: (...args: Parameters<typeof fetch>) => { calls++; return fetcher(...args) } })
  Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: FakeSource })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout(callback: () => void, delay: number) { const id = ++timerId; timers.set(id, { callback, delay }); return id },
    clearTimeout(id: number) { timers.delete(id) },
  } })
  const model = new AmphoreusClientModel()
  try {
    await run({ model, timers, calls: () => calls, setFetch: value => { fetcher = value },
      ready() { fetcher = async () => Response.json({ revision: 1, bindings: [{ sessionId: 'aglaea', skillName: 'amphoreus-aglaea' }], assets: { running: false } }) },
      async fire() {
        const entry = timers.entries().next().value
        assert.ok(entry, 'a recovery timer must exist')
        const [id, timer] = entry
        timers.delete(id)
        timer.callback()
        await flush()
        return timer.delay
      },
    })
  } finally {
    model.close()
    for (const [name, descriptor] of previous) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name)
      else Object.defineProperty(globalThis, name, descriptor)
    }
  }
}

test('initial state 404 and terminal SSE failure recover without user interaction', async () => {
  await withHarness(async h => {
    await h.model.start()
    assert.equal(h.model.getSnapshot().phase, 'error')
    FakeSource.instances[0]!.fail()
    h.ready()
    assert.equal(await h.fire(), 500)
    assert.equal(h.model.getSnapshot().phase, 'ready')
    assert.equal(h.model.getSnapshot().state?.bindings[0]?.sessionId, 'aglaea')
    assert.equal(FakeSource.instances.length, 2)
    assert.equal(h.calls(), 2)
    assert.equal(h.timers.size, 0)
  })
})

test('repeated unavailable routes use one bounded backoff timer', async () => {
  await withHarness(async h => {
    await h.model.start()
    const delays = []
    for (let attempt = 0; attempt < 7; attempt++) {
      const source = FakeSource.instances.at(-1)!
      source.fail(); source.fail(); source.fail()
      assert.equal(h.timers.size, 1)
      delays.push(await h.fire())
    }
    assert.deepEqual(delays, [500, 1000, 2000, 4000, 8000, 10000, 10000])
    assert.equal(h.calls(), 8)
    assert.equal(h.timers.size, 1)
  })
})

test('native SSE reconnect retains its source and does not add a retry loop', async () => {
  await withHarness(async h => {
    h.ready()
    await h.model.start()
    const source = FakeSource.instances[0]!
    source.fail(0)
    assert.equal(h.timers.size, 0)
    source.emit('snapshot')
    assert.equal(await h.fire(), 120)
    assert.equal(FakeSource.instances.length, 1)
    assert.equal(h.calls(), 2)
  })
})

test('a successful SSE snapshot cancels the pending startup recovery timer', async () => {
  await withHarness(async h => {
    await h.model.start()
    h.ready()
    FakeSource.instances[0]!.emit('snapshot')
    const refresh = [...h.timers.entries()].find(([, timer]) => timer.delay === 120)!
    assert.ok(refresh)
    h.timers.delete(refresh[0]); refresh[1].callback(); await flush()
    assert.equal(h.model.getSnapshot().phase, 'ready')
    assert.equal(h.timers.size, 0)
    assert.equal(FakeSource.instances.length, 1)
  })
})

test('close cancels recovery and discards a late in-flight refresh', async () => {
  await withHarness(async h => {
    await h.model.start()
    FakeSource.instances[0]!.fail()
    let finish!: (response: Response) => void
    let signal: AbortSignal | undefined
    h.setFetch(async (_input, init) => { signal = init?.signal ?? undefined; return new Promise(resolve => { finish = resolve }) })
    await h.fire()
    h.model.close()
    assert.equal(signal?.aborted, true)
    const snapshot = h.model.getSnapshot()
    finish(Response.json({ revision: 2, assets: { running: false } }))
    await flush()
    assert.equal(h.model.getSnapshot(), snapshot)
    assert.equal(h.timers.size, 0)
    assert.equal(FakeSource.instances.length, 1)
  })
})

test('a stalled first state request times out, aborts its transport, and can recover on a fresh signal', async () => {
  await withHarness(async h => {
    let signal: AbortSignal | undefined
    h.setFetch(async (_input, init) => { signal = init?.signal ?? undefined; return new Promise(() => {}) })
    const start = h.model.start()
    await flush()
    assert.equal(h.timers.size, 1, 'the initial request owns a deadline')
    assert.equal(await h.fire(), 20_000)
    await start
    assert.equal(signal?.aborted, true)
    assert.match(h.model.getSnapshot().error ?? '', /超时/u)
    h.ready()
    assert.equal(await h.fire(), 500)
    assert.equal(h.model.getSnapshot().phase, 'ready')
    assert.equal(h.timers.size, 0)
  })
})

test('close settles startup even when a transport never delivers its pending response', async () => {
  await withHarness(async h => {
    let settled = false, signal: AbortSignal | undefined
    h.setFetch(async (_input, init) => { signal = init?.signal ?? undefined; return new Promise(() => {}) })
    void h.model.start().then(() => { settled = true })
    await flush()
    h.model.close()
    await flush()
    assert.equal(signal?.aborted, true)
    assert.equal(settled, true, 'startup must not hold the owner teardown barrier')
    assert.equal(h.timers.size, 0)
    assert.equal(FakeSource.instances.length, 0)
  })
})
