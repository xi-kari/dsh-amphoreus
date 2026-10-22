import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')
const indexPath = '/amphoreus/workbench/api/index?includeHidden=1'
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))

function frame(failFirstIndex = false, hidden = false) {
  const requests: string[] = []
  const messages: Array<{ type: string }> = []
  const listeners = new Map<string, Array<(event: unknown) => void>>()
  const timers: Array<{ callback: () => void; delay: number }> = []
  let indexCount = 0
  const app = { innerHTML: '', addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] }
  const origin = 'http://localhost'
  const context = {
    console, URL, crypto, history: {}, CSS: { escape: String },
    location: { href: `${origin}/amphoreus/workbench/?mode=portal` },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      hidden, activeElement: null, documentElement: { dataset: {} },
      querySelector: (selector: string) => selector === '#app' ? app : null,
      querySelectorAll: () => [], addEventListener() {},
    },
    window: {
      parent: { postMessage: (message: { type: string }) => messages.push(message) },
      location: { origin },
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        const group = listeners.get(type) ?? []; group.push(listener); listeners.set(type, group)
      },
      setTimeout: (callback: () => void, delay: number) => { timers.push({ callback, delay }); return timers.length },
      clearTimeout() {}, requestAnimationFrame: (callback: () => void) => { callback(); return 1 },
      cancelAnimationFrame() {}, matchMedia: () => ({ matches: true }),
    },
    fetch: async (path: string) => {
      requests.push(path)
      if (path === '/amphoreus/api/state') return {
        ok: true, status: 200, json: async () => ({ canvas: [], prefs: { quickPhrases: [], quickPhrasesInitialized: true } }),
      }
      assert.equal(path, indexPath)
      indexCount++
      if (failFirstIndex && indexCount === 1) return { ok: false, status: 503 }
      return { ok: true, status: 200, json: async () => ({ revision: indexCount, sessions: [], unprojectable: [] }) }
    },
    EventSource: class { addEventListener() {} },
  }
  vm.runInNewContext(source, context)
  const open = () => {
    for (const listener of listeners.get('message') ?? []) listener({ origin, data: { source: 'dsh-amphoreus', type: 'amphoreus:map-opened' } })
  }
  return { requests, messages, timers, open, indexCount: () => indexCount,
    setHidden: (value: boolean) => { context.document.hidden = value },
  }
}

test('pending first open reuses its successful boot index, while reopening and a new frame refresh', async () => {
  const first = frame()
  first.open()
  await tick(); await tick()
  assert.equal(first.indexCount(), 1)
  assert.ok(first.messages.some(message => message.type === 'amphoreus:map-ready'))
  const retry = first.timers.find(timer => timer.delay === 240)
  assert.ok(retry)
  retry.callback()
  assert.equal(first.messages.filter(message => message.type === 'amphoreus:map-ready').length, 2)
  assert.equal(first.indexCount(), 1)
  first.open()
  await tick()
  assert.equal(first.indexCount(), 2)
  const reloaded = frame()
  reloaded.open()
  await tick(); await tick()
  assert.equal(reloaded.requests.filter(path => path === '/amphoreus/api/state').length, 1)
  assert.equal(reloaded.indexCount(), 1)
})

test('pending open retries a failed initial index instead of treating it as reusable', async () => {
  const failed = frame(true)
  failed.open()
  await tick(); await tick()
  assert.equal(failed.indexCount(), 2)
  assert.ok(failed.messages.some(message => message.type === 'amphoreus:map-ready'))
  failed.open()
  await tick()
  assert.equal(failed.indexCount(), 3)
})

test('an index skipped while hidden is fetched when the frame opens visibly', async () => {
  const hidden = frame(false, true)
  hidden.open()
  await tick(); await tick()
  assert.equal(hidden.indexCount(), 0)
  hidden.setHidden(false)
  hidden.open()
  await tick()
  assert.equal(hidden.indexCount(), 1)
})
