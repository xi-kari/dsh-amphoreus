import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installSeatMotion } from '../src/client/seat-motion.ts'

function fixture() {
  let current: string | null = null, enabled = true, hidden = false, reduced = false, sequence = 0
  const listeners = new Set<() => void>(), prefs = new Set<() => void>(), mediaListeners = new Set<() => void>(), visibility = new Set<() => void>()
  const timers = new Map<number, () => void>()
  const dataset: Record<string, string> = {}
  const doc = { documentElement: { dataset }, get visibilityState() { return hidden ? 'hidden' : 'visible' },
    addEventListener: (_name: string, fn: () => void) => visibility.add(fn), removeEventListener: (_name: string, fn: () => void) => visibility.delete(fn) }
  const view = { matchMedia: () => ({ get matches() { return reduced },
    addEventListener: (_name: string, fn: () => void) => mediaListeners.add(fn), removeEventListener: (_name: string, fn: () => void) => mediaListeners.delete(fn) }),
    setTimeout: (fn: () => void) => { timers.set(++sequence, fn); return sequence }, clearTimeout: (id: number) => timers.delete(id) }
  const seat = { getSnapshot: () => current, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } } }
  return { dataset, timers, listeners, prefs, mediaListeners, visibility,
    install: () => installSeatMotion(seat, { document: doc as never, window: view as never, enabled: () => enabled,
      subscribe: fn => { prefs.add(fn); return () => { prefs.delete(fn) } } }),
    seat(value: string) { current = value; for (const listener of listeners) listener() },
    reduce(value: boolean) { reduced = value; for (const listener of mediaListeners) listener() },
    hide(value: boolean) { hidden = value; for (const listener of visibility) listener() },
    enable(value: boolean) { enabled = value; for (const listener of prefs) listener() },
    finish() { for (const [id, fn] of [...timers]) { timers.delete(id); fn() } },
  }
}

test('rapid role switches keep one finite arrival and settle on the latest role', () => {
  const h = fixture(), dispose = h.install()
  try {
    assert.equal(h.dataset.amphMotion, 'on')
    assert.equal(h.timers.size, 0)
    h.seat('aglaea'); const first = h.dataset.amphChanging
    const canceled = [...h.timers.values()][0]!
    h.seat('mydei')
    canceled()
    assert.notEqual(h.dataset.amphChanging, first)
    assert.equal(h.timers.size, 1)
    h.finish()
    assert.equal(h.dataset.amphChanging, undefined)
    h.seat('mydei')
    assert.equal(h.timers.size, 0)
  } finally { dispose() }
})

test('reduced motion, hidden pages and disabled ambient effects settle immediately', () => {
  const h = fixture(), dispose = h.install()
  try {
    h.seat('aglaea'); h.reduce(true)
    assert.equal(h.dataset.amphMotion, 'off'); assert.equal(h.timers.size, 0)
    h.seat('mydei'); assert.equal(h.dataset.amphChanging, undefined)
    h.reduce(false); h.seat('cyrene'); h.hide(true)
    assert.equal(h.dataset.amphMotion, 'off'); assert.equal(h.timers.size, 0)
    h.seat('anaxa'); h.hide(false)
    assert.equal(h.dataset.amphMotion, 'on'); assert.equal(h.dataset.amphChanging, undefined)
    h.seat('aglaea'); h.enable(false)
    assert.equal(h.dataset.amphMotion, 'off'); assert.equal(h.timers.size, 0)
  } finally { dispose() }
})

test('replacement installation and repeated hot disposal leave no timers or subscriptions', () => {
  const h = fixture(), first = h.install()
  h.seat('aglaea')
  const second = h.install()
  first()
  assert.equal(h.dataset.amphMotion, 'on')
  assert.equal(h.listeners.size, 1)
  h.seat('mydei'); second(); second()
  assert.deepEqual(h.dataset, {})
  for (const resource of [h.timers, h.listeners, h.prefs, h.mediaListeners, h.visibility]) assert.equal(resource.size, 0)
})
