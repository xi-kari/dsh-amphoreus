/**
 * Runs the host `apply()` against a stub Cordis context (no platform process), in both the
 * degraded mode (storage domain unavailable) and the normal mode (in-memory domains), and
 * awaits the effect's disposer. The seven feature branches each appended to the register /
 * dispose blocks in src/index.ts; until now only `indexOf` pins covered that file.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'
import type { AmphoreusConfig } from '../src/host/config.ts'
import { INITIAL_GLOBAL, type AmphoreusGlobal } from '../src/host/store.ts'
import { fixtureConfig } from './fixture-suite.ts'

interface Trace {
  readonly lines: string[]
  readonly errors: string[]
  readonly warns: string[]
  readonly onEvents: string[]
}

function fakeDomain(trace: Trace, name: string) {
  const tables = new Map<string, Map<string, unknown>>()
  let global: unknown = structuredClone(INITIAL_GLOBAL)
  const table = (tableName: string) => {
    let values = tables.get(tableName)
    if (values === undefined) {
      values = new Map()
      tables.set(tableName, values)
    }
    const store = values
    return {
      get: (key: string) => store.get(key),
      entries: () => new Map(store).entries(),
      keys: () => new Map(store).keys(),
      get size() { return store.size },
      put: async (key: string, value: unknown) => { store.set(key, value) },
      delete: async (key: string) => store.delete(key),
      update: async (key: string, transform: (current: unknown) => unknown) => {
        if (!store.has(key)) throw Object.assign(new Error('missing-key'), { code: 'missing-key' })
        const next = transform(store.get(key))
        store.set(key, next)
        return next
      },
    }
  }
  return {
    global: { get: () => global as AmphoreusGlobal, set: async (value: unknown) => { global = value } },
    table,
    close: async () => { trace.lines.push(`close:${name}`) },
  }
}

function stubContext(trace: Trace, options: { storage: 'ok' | 'fail' }): { ctx: Context; effects: Array<{ label: string; result: Promise<unknown> }> } {
  const effects: Array<{ label: string; result: Promise<unknown> }> = []
  const ctx = {
    logger: {
      info: () => {},
      debug: () => {},
      warn: (message: string) => { trace.warns.push(message) },
      error: (message: string) => { trace.errors.push(message) },
    },
    effect(execute: () => unknown, label: string) {
      const result = Promise.resolve().then(execute)
      effects.push({ label, result })
      return result
    },
    on(event: string) {
      trace.onEvents.push(event)
      return () => { trace.lines.push(`off:${event}`) }
    },
    get: () => undefined,
    sessions: { list: () => [] },
    skills: { registerProvider: () => () => {}, get: () => undefined },
    commands: { register: () => () => { trace.lines.push('off:command') } },
    webServer: { register: () => () => { trace.lines.push('off:route') } },
    storageDomain: {
      open: async (spec: { name?: string; id?: string }) => {
        if (options.storage === 'fail') throw new Error('domain store locked')
        return fakeDomain(trace, String(spec.name ?? spec.id ?? 'domain'))
      },
    },
  } as unknown as Context
  return { ctx, effects }
}

function config(dataDir: string): AmphoreusConfig {
  return {
    ...fixtureConfig(),
    dataDir,
    registerProvider: false,
    workbench: { ...fixtureConfig().workbench, enabled: false },
  }
}

test('apply() in degraded mode (storage unavailable) mounts, registers nothing that needs stores, and its disposer resolves', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'amphoreus-apply-degraded-'))
  const trace: Trace = { lines: [], errors: [], warns: [], onEvents: [] }
  try {
    const { ctx, effects } = stubContext(trace, { storage: 'fail' })
    apply(ctx, config(dataDir))
    assert.equal(effects.length, 1)
    assert.equal(effects[0]!.label, 'dsh-amphoreus/bridge')
    const dispose = await effects[0]!.result as () => Promise<void>
    assert.equal(typeof dispose, 'function')
    assert.equal(trace.errors.filter(line => /storage unavailable/u.test(line)).length, 1)
    // Seat permission, seat memory, observer, injector, seat prompt and the web api all need stores: none attached.
    assert.equal(trace.onEvents.includes('session/created'), false)
    assert.equal(trace.onEvents.includes('session/event'), false)
    assert.equal(trace.onEvents.includes('system-prompt/assemble'), false)
    assert.equal(trace.onEvents.includes('domain/changed'), false)
    // The first frame does not depend on storage and still injects.
    assert.deepEqual(trace.onEvents, ['webserver/index-inject'])
    await dispose()
    assert.deepEqual(trace.lines, ['off:webserver/index-inject'])
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('apply() with in-memory domains registers every feature listener and disposes them in the documented order, stores last', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'amphoreus-apply-full-'))
  const trace: Trace = { lines: [], errors: [], warns: [], onEvents: [] }
  try {
    const { ctx, effects } = stubContext(trace, { storage: 'ok' })
    apply(ctx, config(dataDir))
    const dispose = await effects[0]!.result as () => Promise<void>
    assert.deepEqual(trace.errors, [])
    // Registration order pinned by seat-permission / remember-command tests: observer, permission and memory attach after bridge.start.
    const created = trace.onEvents.filter(event => event === 'session/created')
    assert.equal(created.length, 4, 'injector, observer, seat-permission, seat-memory each listen to session/created')
    assert.ok(trace.onEvents.includes('system-prompt/assemble'))
    assert.ok(trace.onEvents.includes('domain/changed'))
    assert.ok(trace.onEvents.includes('webserver/index-inject'))
    const firstStorageListener = trace.onEvents.indexOf('domain/changed')
    assert.ok(trace.onEvents.indexOf('webserver/index-inject') > firstStorageListener, 'web api registers before the first frame')

    await dispose()
    // Exact disposer sequence (mirror of the dispose block in src/index.ts):
    // observer → seat-permission → seat-memory (command, event, created) → firstframe → seat-prompt → injector → webapi → stores.close (canvas, main).
    assert.deepEqual(trace.lines, [
      'off:session/event', 'off:session/created', // observer
      'off:session/created', // seat-permission
      'off:command', 'off:session/event', 'off:session/created', // seat-memory
      'off:webserver/index-inject', // firstframe
      'off:system-prompt/assemble', // seat-prompt
      'off:session/created', 'off:agent/session-start', 'off:agent/pre-step', 'off:agent/disposed', 'off:session/event', // injector
      'off:domain/changed', 'off:route', // webapi
      'close:amphoreus_canvas', 'close:amphoreus', // stores
    ])
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
