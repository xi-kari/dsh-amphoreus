import assert from 'node:assert/strict'
import test from 'node:test'
import { installSeatMotion } from '../src/client/seat-motion.ts'

function fixture(reduced = false) {
  const attrs = new Map<string, string>(), timers = new Map<number, () => void>(), listeners = new Set<() => void>()
  let id = 0, selected: string | null = 'aglaea'
  const media = Object.assign(new EventTarget(), { matches: reduced })
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
    documentElement: { dataset: new Proxy({} as Record<string, string>, {
      get: (_target, name: string) => attrs.get(`data-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`),
      set: (_target, name: string, value: string) => { attrs.set(`data-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value); return true },
      deleteProperty: (_target, name: string) => { attrs.delete(`data-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`); return true },
    }) },
    body: {
      getAttribute: (name: string) => attrs.get(name) ?? null,
      setAttribute: (name: string, value: string) => { attrs.set(name, value) },
      removeAttribute: (name: string) => { attrs.delete(name) },
    },
    defaultView: {
      matchMedia: () => media,
      setTimeout: (callback: () => void) => { timers.set(++id, callback); return id },
      clearTimeout: (timer: number) => { timers.delete(timer) },
    },
  })
  const seat = { getSnapshot: () => selected, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } }
  const publish = (value: string | null) => { selected = value; for (const listener of listeners) listener() }
  const options = { document: doc as unknown as Document, window: doc.defaultView as unknown as Window }
  const dispose = installSeatMotion(seat, options)
  return { attrs, timers, listeners, media, doc, publish, dispose, seat, options }
}

test('reduced motion keeps theme changes immediate and schedules no timer', () => {
  const f = fixture(true)
  f.publish('cyrene')
  assert.equal(f.attrs.get('data-amph-motion'), 'off')
  assert.equal(f.attrs.has('data-amph-changing'), false)
  assert.equal(f.timers.size, 0)
  f.dispose()
})

test('rapid role changes keep one bounded completion and ignore unchanged publications', () => {
  const f = fixture()
  f.publish('aglaea')
  assert.equal(f.timers.size, 0)
  f.publish('cerydra'); f.publish('cyrene')
  assert.equal(f.timers.size, 1)
  assert.ok(f.attrs.has('data-amph-changing'))
  const finish = [...f.timers.values()][0]!
  f.timers.clear(); finish()
  assert.equal(f.attrs.has('data-amph-changing'), false)
  f.dispose()
})

test('visibility and reduced-motion changes cancel active work without replay on resume', () => {
  const f = fixture()
  f.publish('cerydra')
  f.doc.visibilityState = 'hidden'; f.doc.dispatchEvent(new Event('visibilitychange'))
  assert.equal(f.timers.size, 0)
  assert.equal(f.attrs.get('data-amph-motion'), 'off')
  f.publish('cyrene')
  assert.equal(f.timers.size, 0)
  f.doc.visibilityState = 'visible'; f.doc.dispatchEvent(new Event('visibilitychange'))
  assert.equal(f.attrs.get('data-amph-motion'), 'on')
  assert.equal(f.timers.size, 0)
  f.publish('aglaea'); f.media.matches = true; f.media.dispatchEvent(new Event('change'))
  assert.equal(f.timers.size, 0)
  assert.equal(f.attrs.has('data-amph-changing'), false)
  f.dispose()
})

test('dispose releases subscriptions, timers and owned flags and ignores late completion', () => {
  const f = fixture()
  f.publish('cyrene')
  const late = [...f.timers.values()][0]!
  f.dispose(); f.dispose(); late()
  assert.equal(f.listeners.size, 0)
  assert.equal(f.timers.size, 0)
  assert.equal(f.attrs.size, 0)
  f.publish('cerydra'); f.doc.dispatchEvent(new Event('visibilitychange')); f.media.dispatchEvent(new Event('change'))
  assert.equal(f.attrs.size, 0)
})

test('replacement installation tears down the previous owner', () => {
  const f = fixture()
  f.publish('cyrene')
  const next = installSeatMotion(f.seat, f.options)
  assert.equal(f.listeners.size, 1)
  assert.equal(f.timers.size, 0)
  next(); f.dispose()
  assert.equal(f.listeners.size, 0)
  assert.equal(f.attrs.size, 0)
})
