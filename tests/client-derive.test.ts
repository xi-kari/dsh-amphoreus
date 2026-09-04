import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AmphoreusClientModel, parseDeriveProgress } from '../src/client/state.ts'
import type { AmphoreusState } from '../src/shared/api.ts'

function state(running: boolean, revision = 1): AmphoreusState {
  return {
    revision,
    nonce: 'client-derive-nonce',
    assets: {
      root: 'X:/assets',
      cacheDir: 'X:/cache',
      derivedCount: 0,
      derived: [],
      magick: 'Version: synthetic',
      running,
      lastDerive: null,
    },
  } as unknown as AmphoreusState
}

class FakeEventSource {
  static latest: FakeEventSource | undefined
  readonly listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>()
  readonly url: string
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeEventSource.latest = this
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  emit(type: string, value: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: typeof value === 'string' ? value : JSON.stringify(value) } as MessageEvent<string>)
  }

  close(): void {}
}

function response(value: AmphoreusState): Response {
  return { ok: true, status: 200, json: async () => value } as Response
}

test('derive progress parser accepts only bounded complete payloads', () => {
  assert.deepEqual(parseDeriveProgress({ kind: 'covers', done: 2, total: 13, current: 'aglaea cover-34.webp' }), {
    kind: 'covers', done: 2, total: 13, current: 'aglaea cover-34.webp',
  })
  assert.deepEqual(parseDeriveProgress({ kind: 'cards', done: 1, total: 13, current: 'card.webp', error: 'failed' }), {
    kind: 'cards', done: 1, total: 13, current: 'card.webp', error: 'failed',
  })
  for (const invalid of [
    null,
    [],
    { kind: 'other', done: 1, total: 1, current: 'x' },
    { kind: 'covers', done: -1, total: 13, current: 'x' },
    { kind: 'covers', done: 14, total: 13, current: 'x' },
    { kind: 'covers', done: 1.5, total: 13, current: 'x' },
    { kind: 'covers', done: 1, total: 0, current: 'x' },
    { kind: 'covers', done: 1, total: 13, current: '' },
    { kind: 'covers', done: 1, total: 13, current: 'x'.repeat(501) },
    { kind: 'covers', done: 1, total: 13, current: 'x', error: 1 },
  ]) assert.equal(parseDeriveProgress(invalid), undefined)
})

test('SSE progress is buffered before running state, visible while running, and cleared at completion', async () => {
  const oldFetch = globalThis.fetch
  const oldEventSource = Object.getOwnPropertyDescriptor(globalThis, 'EventSource')
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let nextState = state(false)
  globalThis.fetch = (async () => response(nextState)) as typeof fetch
  Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: FakeEventSource })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { setTimeout, clearTimeout, __AMPHOREUS_BOOT__: { nonce: 'client-derive-nonce' } },
  })
  const model = new AmphoreusClientModel()
  try {
    await model.start()
    const source = FakeEventSource.latest!
    source.emit('derive-progress', '{broken')
    source.emit('derive-progress', { kind: 'covers', done: -1, total: 13, current: 'bad' })
    assert.equal(model.getSnapshot().deriveProgress, undefined)

    source.emit('derive-progress', { kind: 'covers', done: 1, total: 13, current: 'early.webp' })
    assert.equal(model.getSnapshot().deriveProgress, undefined)
    nextState = state(true, 2)
    await model.refresh()
    assert.equal(model.getSnapshot().deriveProgress?.current, 'early.webp')

    source.emit('derive-progress', { kind: 'covers', done: 2, total: 13, current: 'visible.webp' })
    assert.equal(model.getSnapshot().deriveProgress?.current, 'visible.webp')
    nextState = state(false, 3)
    await model.refresh()
    assert.equal(model.getSnapshot().deriveProgress, undefined)
  } finally {
    model.close()
    globalThis.fetch = oldFetch
    if (oldEventSource === undefined) Reflect.deleteProperty(globalThis, 'EventSource')
    else Object.defineProperty(globalThis, 'EventSource', oldEventSource)
    if (oldWindow === undefined) Reflect.deleteProperty(globalThis, 'window')
    else Object.defineProperty(globalThis, 'window', oldWindow)
  }
})

test('deriveAssets clears stale progress before POST and preserves a progress event racing the 202 response', async () => {
  const oldFetch = globalThis.fetch
  const oldEventSource = Object.getOwnPropertyDescriptor(globalThis, 'EventSource')
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const requests: Array<{ path: string; init?: RequestInit }> = []
  let nextState = state(false)
  Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: FakeEventSource })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { setTimeout, clearTimeout, __AMPHOREUS_BOOT__: { nonce: 'client-derive-nonce' } },
  })
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input)
    requests.push({ path, ...(init === undefined ? {} : { init }) })
    if (path === '/amphoreus/api/assets/derive') {
      nextState = state(true, 2)
      FakeEventSource.latest?.emit('derive-progress', { kind: 'covers', done: 1, total: 13, current: 'raced.webp' })
      return { ok: true, status: 202, json: async () => ({ started: true }) } as Response
    }
    return response(nextState)
  }) as typeof fetch
  const model = new AmphoreusClientModel()
  try {
    await model.start()
    await model.deriveAssets(true)
    const request = requests.find(value => value.path === '/amphoreus/api/assets/derive')!
    assert.equal(request.init?.method, 'POST')
    assert.deepEqual(request.init?.headers, {
      'content-type': 'application/json',
      'x-amphoreus-nonce': 'client-derive-nonce',
    })
    assert.equal(request.init?.body, '{"force":true}')
    assert.equal(model.getSnapshot().state?.assets.running, true)
    assert.equal(model.getSnapshot().deriveProgress?.current, 'raced.webp')
  } finally {
    model.close()
    globalThis.fetch = oldFetch
    if (oldEventSource === undefined) Reflect.deleteProperty(globalThis, 'EventSource')
    else Object.defineProperty(globalThis, 'EventSource', oldEventSource)
    if (oldWindow === undefined) Reflect.deleteProperty(globalThis, 'window')
    else Object.defineProperty(globalThis, 'window', oldWindow)
  }
})

test('a stale earlier refresh cannot overwrite a newer terminal snapshot', async () => {
  const oldFetch = globalThis.fetch
  const pending: Array<(value: Response) => void> = []
  globalThis.fetch = (() => new Promise<Response>(resolve => pending.push(resolve))) as typeof fetch
  const model = new AmphoreusClientModel()
  try {
    const earlier = model.refresh()
    const later = model.refresh()
    assert.equal(pending.length, 2)
    pending[1]!(response(state(false, 20)))
    await later
    pending[0]!(response(state(true, 10)))
    await earlier
    assert.equal(model.getSnapshot().state?.revision, 20)
    assert.equal(model.getSnapshot().state?.assets.running, false)
    assert.equal(model.getSnapshot().refreshing, false)
  } finally {
    model.close()
    globalThis.fetch = oldFetch
  }
})
