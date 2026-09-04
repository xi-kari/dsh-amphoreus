import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')

test('failed state hydration stays closed until one nonconcurrent retry succeeds', async () => {
  const origin = 'http://localhost'
  const requests: string[] = []
  const parentMessages: Array<{ type?: string }> = []
  const windowListeners = new Map<string, Array<(event: { origin: string; data: { source: string; type: string } }) => void>>()
  const timers: Array<{ callback: () => void; delay: number; cleared: boolean }> = []
  const storage = new Map([['dsh-amphoreus:quick-phrases:v1', JSON.stringify(['迁移词'])]])
  let failState = true
  let eventSources = 0
  const app = {
    innerHTML: '',
    addEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  const windowObject = {
    parent: { postMessage: (message: { type?: string }) => parentMessages.push(message) },
    location: { origin },
    addEventListener: (type: string, listener: (event: { origin: string; data: { source: string; type: string } }) => void) => {
      const entries = windowListeners.get(type) ?? []
      entries.push(listener)
      windowListeners.set(type, entries)
    },
    setTimeout: (callback: () => void, delay: number) => {
      timers.push({ callback, delay, cleared: false })
      return timers.length
    },
    clearTimeout: (id: number) => { if (timers[id - 1] !== undefined) timers[id - 1]!.cleared = true },
    requestAnimationFrame: (callback: () => void) => { callback(); return 1 },
    cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: true }),
  }
  const context = {
    console,
    history: {},
    URL,
    location: { href: 'http://localhost/amphoreus/workbench/?mode=portal' },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    document: {
      hidden: false,
      activeElement: null,
      documentElement: { dataset: {} },
      querySelector: (selector: string) => selector === '#app' ? app : null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    window: windowObject,
    fetch: async (path: string) => {
      requests.push(path)
      if (path === '/amphoreus/api/state' && failState) {
        return { ok: true, status: 200, json: async () => ({}) }
      }
      if (path === '/amphoreus/api/state') {
        return { ok: true, status: 200, json: async () => ({ canvas: [], prefs: { quickPhrases: [], quickPhrasesInitialized: false } }) }
      }
      if (path === '/amphoreus/api/prefs') {
        return { ok: false, status: 500, json: async () => ({ error: 'migration failed' }) }
      }
      if (path === '/amphoreus/workbench/api/index?includeHidden=1') {
        return { ok: true, status: 200, json: async () => ({ revision: 0, sessions: [], unprojectable: [] }) }
      }
      throw new Error(`unexpected request: ${path}`)
    },
    EventSource: class {
      constructor() { eventSources += 1 }
      addEventListener() {}
    },
    crypto,
    CSS: { escape: String },
    globalThis: {} as Record<string, unknown>,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${source}\nglobalThis.__probe = { state, scheduleCanvasSave, flushCanvasSaves, persistQuickPhrases }`, context)
  const runtime = context.globalThis.__probe as {
    state: { persistenceHydrated: boolean; bootstrapped: boolean; mapOpenPending: boolean; error: string }
    scheduleCanvasSave(sessionId: string): void
    flushCanvasSaves(): Promise<void>
    persistQuickPhrases(): Promise<unknown>
  }
  const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))
  await tick()

  assert.deepEqual(requests, ['/amphoreus/api/state'])
  assert.equal(runtime.state.persistenceHydrated, false)
  assert.equal(runtime.state.bootstrapped, false)
  assert.equal(eventSources, 0)
  assert.deepEqual(parentMessages, [])
  assert.throws(() => runtime.scheduleCanvasSave('session-00000000-0000-0000-0000-000000000001'), /尚未加载/)
  await assert.rejects(runtime.flushCanvasSaves(), /尚未加载/)
  await assert.rejects(runtime.persistQuickPhrases(), /尚未加载/)
  assert.deepEqual(requests, ['/amphoreus/api/state'])

  const onMessage = windowListeners.get('message')?.[0]
  assert.ok(onMessage !== undefined)
  onMessage({ origin, data: { source: 'dsh-amphoreus', type: 'amphoreus:map-opened' } })
  assert.equal(runtime.state.mapOpenPending, true)
  assert.equal(parentMessages.some(message => message.type === 'amphoreus:map-ready'), false)

  const retry = timers.find(timer => timer.delay === 1000 && !timer.cleared)
  assert.ok(retry !== undefined)
  failState = false
  retry.callback()
  retry.callback()
  await tick()
  await tick()

  assert.equal(requests.filter(path => path === '/amphoreus/api/state').length, 2)
  assert.ok(requests.filter(path => path === '/amphoreus/workbench/api/index?includeHidden=1').length >= 1)
  assert.equal(runtime.state.persistenceHydrated, true)
  assert.equal(runtime.state.bootstrapped, true)
  assert.equal(runtime.state.error, 'migration failed')
  assert.equal(eventSources, 1)
  assert.equal(storage.has('dsh-amphoreus:quick-phrases:v1'), true)
  assert.equal(requests.filter(path => path === '/amphoreus/api/prefs').length, 1)
  assert.equal(parentMessages.some(message => message.type === 'amphoreus:request-current'), true)
  assert.equal(parentMessages.some(message => message.type === 'amphoreus:request-config'), true)
  assert.equal(parentMessages.some(message => message.type === 'amphoreus:map-ready'), true)
})
