import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  chordDigit,
  digitOf,
  installSeatHotkeys,
  isEditableTarget,
  type SeatHotkeyEvent,
  type SeatHotkeyWindow,
} from '../src/client/seat-hotkeys.ts'
import type { SeatView } from '../src/client/seat-model.ts'
import { fixtureView } from './fixture-seat-view.ts'

function fakeWindow() {
  const listeners = new Set<(event: SeatHotkeyEvent) => void>()
  const target: SeatHotkeyWindow = {
    addEventListener: (_type, listener) => { listeners.add(listener) },
    removeEventListener: (_type, listener) => { listeners.delete(listener) },
  }
  return {
    target,
    listeners,
    fire(overrides: Partial<SeatHotkeyEvent> & { key: string }): SeatHotkeyEvent & { prevented: boolean } {
      const event = {
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        target: { tagName: 'BODY' },
        prevented: false,
        preventDefault() { this.prevented = true },
        ...overrides,
      } as SeatHotkeyEvent & { prevented: boolean }
      for (const listener of listeners) listener(event)
      return event
    },
  }
}

const seats: SeatView[] = [
  fixtureView('amphoreus-aglaea', { displayName: 'Aglaea' }),
  fixtureView('amphoreus-anaxa', { displayName: '那刻夏' }),
]

const settle = () => new Promise(resolve => setImmediate(resolve))

test('isEditableTarget and digitOf classify targets and keys', () => {
  assert.equal(isEditableTarget({ tagName: 'INPUT' }), true)
  assert.equal(isEditableTarget({ tagName: 'textarea' }), true)
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(isEditableTarget({ tagName: 'BUTTON' }), false)
  assert.equal(isEditableTarget(null), false)
  assert.equal(isEditableTarget(undefined), false)
  assert.equal(digitOf({ key: '3', code: 'Digit3' }), 3)
  assert.equal(digitOf({ key: '0', code: 'Numpad0' }), 0)
  // Alt+digit on some layouts reports a symbol in `key`; `code` still carries the digit.
  assert.equal(digitOf({ key: '™', code: 'Digit2' }), 2)
  assert.equal(digitOf({ key: '7' }), 7)
  assert.equal(digitOf({ key: 'a', code: 'KeyA' }), undefined)
  assert.equal(digitOf({ key: '12' }), undefined)
})

test('chordDigit accepts Alt alone and rejects Ctrl/Meta/Shift combinations', () => {
  const base = { key: '2', code: 'Digit2', target: null, preventDefault() {} }
  assert.equal(chordDigit({ ...base, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false }), 2)
  assert.equal(chordDigit({ ...base, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }), undefined)
  assert.equal(chordDigit({ ...base, altKey: false, ctrlKey: true, metaKey: false, shiftKey: false }), undefined)
  assert.equal(chordDigit({ ...base, altKey: true, ctrlKey: true, metaKey: false, shiftKey: false }), undefined)
  assert.equal(chordDigit({ ...base, altKey: true, ctrlKey: false, metaKey: true, shiftKey: false }), undefined)
  assert.equal(chordDigit({ ...base, altKey: true, ctrlKey: false, metaKey: false, shiftKey: true }), undefined)
})

test('Alt+digit enters the matching seat, prevents default, and ignores digits beyond the seat count', async () => {
  const win = fakeWindow()
  const entered: string[] = []
  const dispose = installSeatHotkeys({
    target: win.target,
    seats: () => seats,
    enter: async view => { entered.push(view.skillName) },
    togglePortal: () => { throw new Error('portal must not toggle') },
  })
  assert.equal(win.listeners.size, 1)
  const hit = win.fire({ key: '2', code: 'Digit2', altKey: true })
  assert.equal(hit.prevented, true)
  await settle()
  assert.deepEqual(entered, ['amphoreus-anaxa'])
  const miss = win.fire({ key: '5', code: 'Digit5', altKey: true })
  assert.equal(miss.prevented, false)
  await settle()
  assert.deepEqual(entered, ['amphoreus-anaxa'])
  dispose()
  assert.equal(win.listeners.size, 0)
  win.fire({ key: '1', code: 'Digit1', altKey: true })
  await settle()
  assert.deepEqual(entered, ['amphoreus-anaxa'])
})

test('plain digits, Ctrl/Meta/Shift chords, IME composition, repeats and pre-handled events never fire', async () => {
  const win = fakeWindow()
  let entered = 0
  let toggled = 0
  installSeatHotkeys({
    target: win.target,
    seats: () => seats,
    enter: async () => { entered += 1 },
    togglePortal: () => { toggled += 1 },
  })
  const events = [
    win.fire({ key: '1', code: 'Digit1' }),
    win.fire({ key: '1', code: 'Digit1', ctrlKey: true }),
    win.fire({ key: '1', code: 'Digit1', altKey: true, ctrlKey: true }),
    win.fire({ key: '1', code: 'Digit1', altKey: true, metaKey: true }),
    win.fire({ key: '1', code: 'Digit1', altKey: true, shiftKey: true }),
    win.fire({ key: '1', code: 'Digit1', altKey: true, isComposing: true }),
    win.fire({ key: '1', code: 'Digit1', altKey: true, repeat: true }),
    win.fire({ key: '1', code: 'Digit1', altKey: true, defaultPrevented: true }),
    win.fire({ key: '0', code: 'Digit0', isComposing: true, altKey: true }),
    win.fire({ key: 'a', code: 'KeyA', altKey: true }),
  ]
  await settle()
  assert.equal(entered, 0)
  assert.equal(toggled, 0)
  for (const event of events) assert.equal(event.prevented, false)
})

test('typing a digit into the composer is left alone; Alt+digit from an editable target still switches', async () => {
  const win = fakeWindow()
  const entered: string[] = []
  installSeatHotkeys({
    target: win.target,
    seats: () => seats,
    enter: async view => { entered.push(view.skillName) },
    togglePortal: () => {},
  })
  const editable = { tagName: 'DIV', isContentEditable: true }
  const plain = win.fire({ key: '1', code: 'Digit1', target: editable })
  assert.equal(plain.prevented, false)
  const chord = win.fire({ key: '1', code: 'Digit1', altKey: true, target: editable })
  assert.equal(chord.prevented, true)
  const input = win.fire({ key: '2', code: 'Digit2', altKey: true, target: { tagName: 'INPUT' } })
  assert.equal(input.prevented, true)
  await settle()
  assert.deepEqual(entered, ['amphoreus-aglaea', 'amphoreus-anaxa'])
})

test('a seat start in flight debounces repeated presses for that seat only, and errors reach onError', async () => {
  const win = fakeWindow()
  let release: (() => void) | undefined
  const started: string[] = []
  const errors: unknown[] = []
  installSeatHotkeys({
    target: win.target,
    seats: () => seats,
    enter: view => {
      started.push(view.skillName)
      if (view.skillName === 'amphoreus-anaxa') return Promise.reject(new Error('boom'))
      return new Promise<void>(resolve => { release = resolve })
    },
    togglePortal: () => {},
    onError: error => { errors.push(error) },
  })
  win.fire({ key: '1', code: 'Digit1', altKey: true })
  win.fire({ key: '1', code: 'Digit1', altKey: true })
  const other = win.fire({ key: '2', code: 'Digit2', altKey: true })
  assert.equal(other.prevented, true)
  await settle()
  assert.deepEqual(started, ['amphoreus-aglaea', 'amphoreus-anaxa'])
  assert.equal(errors.length, 1)
  assert.equal((errors[0] as Error).message, 'boom')
  release?.()
  await settle()
  win.fire({ key: '1', code: 'Digit1', altKey: true })
  await settle()
  assert.deepEqual(started, ['amphoreus-aglaea', 'amphoreus-anaxa', 'amphoreus-aglaea'])
})

test('an external busy predicate blocks the start while still swallowing the chord', async () => {
  const win = fakeWindow()
  let entered = 0
  installSeatHotkeys({
    target: win.target,
    seats: () => seats,
    enter: async () => { entered += 1 },
    togglePortal: () => {},
    isBusy: skill => skill === 'amphoreus-aglaea',
  })
  const busy = win.fire({ key: '1', code: 'Digit1', altKey: true })
  assert.equal(busy.prevented, true)
  win.fire({ key: '2', code: 'Digit2', altKey: true })
  await settle()
  assert.equal(entered, 1)
})

test('Alt+0 toggles the portal without touching seats, even with no seats deployed', () => {
  const win = fakeWindow()
  let toggled = 0
  installSeatHotkeys({
    target: win.target,
    seats: () => [],
    enter: async () => { throw new Error('no seat expected') },
    togglePortal: () => { toggled += 1 },
  })
  const zero = win.fire({ key: '0', code: 'Digit0', altKey: true })
  assert.equal(zero.prevented, true)
  win.fire({ key: '0', code: 'Numpad0', altKey: true })
  assert.equal(toggled, 2)
  const one = win.fire({ key: '1', code: 'Digit1', altKey: true })
  assert.equal(one.prevented, false)
})
