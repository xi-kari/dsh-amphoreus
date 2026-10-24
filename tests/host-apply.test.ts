/** Exercises host mounting and cleanup with stock and enhanced workspace registries. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

function stubContext(trace: Trace, options: { storage: 'ok' | 'fail'; visibilityWrite?: () => Promise<void> }): { ctx: Context; effects: Array<{ label: string; result: Promise<unknown> }> } {
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
    get: (name: string) => name === 'workspaceRegistry' ? {
      list: () => [],
      ...(options.visibilityWrite === undefined ? {} : { setHiddenByOwner: options.visibilityWrite }),
    } : undefined,
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

for (const failOn of [1, 2]) {
  test(`visibility failure on write ${failOn} still releases routes, listeners, and stores`, async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'amphoreus-apply-visibility-'))
    const trace: Trace = { lines: [], errors: [], warns: [], onEvents: [] }
    let writes = 0
    try {
      const { ctx, effects } = stubContext(trace, { storage: 'ok', visibilityWrite: async () => {
        if (++writes === failOn) throw new Error('visibility disk failure')
      } })
      const mounting = apply(ctx, config(dataDir))
      if (failOn === 1) await assert.rejects(mounting, /visibility disk failure/u)
      else {
        await mounting
        const dispose = await effects[0]!.result as () => Promise<void>
        await assert.rejects(dispose(), /visibility disk failure/u)
      }
      assert.ok(trace.lines.includes('off:route'))
      assert.ok(trace.lines.includes('off:webserver/index-inject'))
      assert.deepEqual(trace.lines.slice(-2), ['close:amphoreus_canvas', 'close:amphoreus'])
    } finally { await rm(dataDir, { recursive: true, force: true }) }
  })
}

test('apply() in degraded mode (storage unavailable) mounts, registers nothing that needs stores, and its disposer resolves', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'amphoreus-apply-degraded-'))
  const trace: Trace = { lines: [], errors: [], warns: [], onEvents: [] }
  try {
    const { ctx, effects } = stubContext(trace, { storage: 'fail' })
    await apply(ctx, config(dataDir))
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

test('stock host keeps its UI and routes available when seat directory creation fails', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'amphoreus-apply-seat-file-'))
  const trace: Trace = { lines: [], errors: [], warns: [], onEvents: [] }
  try {
    const existing = join(dataDir, 'seats')
    await writeFile(existing, 'existing user file')
    const { ctx, effects } = stubContext(trace, { storage: 'ok' })
    await apply(ctx, config(dataDir))
    const dispose = await effects[0]!.result as () => Promise<void>
    assert.equal(typeof dispose, 'function')
    assert.equal(trace.errors.filter(line => /seat dirs unavailable/u.test(line)).length, 1)
    assert.ok(trace.onEvents.includes('webserver/index-inject'))
    assert.ok(trace.onEvents.includes('domain/changed'))
    await dispose()
    assert.ok(trace.lines.includes('off:route'))
    assert.deepEqual(trace.lines.slice(-2), ['close:amphoreus_canvas', 'close:amphoreus'])
    assert.equal(await readFile(existing, 'utf8'), 'existing user file')
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('apply() on a stock host registers every feature listener and disposes them with stores last', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'amphoreus-apply-full-'))
  const trace: Trace = { lines: [], errors: [], warns: [], onEvents: [] }
  try {
    const { ctx, effects } = stubContext(trace, { storage: 'ok' })
    await apply(ctx, config(dataDir))
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
      'off:session/event', 'off:credentials/reference-updated', 'off:credentials/record-updated',
      'off:deepseek-account/signed-out', 'off:deepseek-account/session-expired', 'off:app-boot/config-reload',
      'close:amphoreus_widget',
      'off:webserver/index-inject', // firstframe
      'off:system-prompt/assemble', // seat-prompt
      'off:session/created', 'off:agent/created', 'off:agent/pre-step', 'off:agent/disposed', 'off:session/event', // injector
      'off:domain/changed', 'off:route', // webapi
      'close:amphoreus_canvas', 'close:amphoreus', // stores
    ])
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
