import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { SuiteResolver } from '../src/host/bridge.ts'
import type { AmphoreusConfig } from '../src/host/config.ts'
import { INITIAL_GLOBAL, type AmphoreusStores, type BindingRecord } from '../src/host/store.ts'
import { AmphoreusWebApi } from '../src/host/webapi.ts'

const NONCE = 'bindings-delete-test'
const SESSION_A = 'session-00000000-0000-0000-0000-000000000001'
const SESSION_B = 'session-00000000-0000-0000-0000-000000000002'
const SKILL = 'amphoreus-aglaea'

class QueuedBindings {
  readonly values = new Map<string, BindingRecord>()
  #tail: Promise<void> = Promise.resolve()
  #putGate: Promise<void> | undefined
  #releasePut: (() => void) | undefined
  #putEnqueued: (() => void) | undefined
  #deleteEnqueued: (() => void) | undefined

  get(key: string): BindingRecord | undefined {
    return this.values.get(key)
  }

  put(key: string, value: BindingRecord): Promise<void> {
    this.#putEnqueued?.()
    this.#putEnqueued = undefined
    const gate = this.#putGate
    const operation = this.#tail.then(async () => {
      await gate
      this.values.set(key, value)
    })
    this.#tail = operation.catch(() => {})
    return operation
  }

  delete(key: string): Promise<boolean> {
    this.#deleteEnqueued?.()
    this.#deleteEnqueued = undefined
    let deleted = false
    const operation = this.#tail.then(() => {
      deleted = this.values.delete(key)
    })
    this.#tail = operation.catch(() => {})
    return operation.then(() => deleted)
  }

  entries() {
    return this.values.entries()
  }

  pauseNextPut(): { putEnqueued: Promise<void>; deleteEnqueued: Promise<void>; release(): void } {
    this.#putGate = new Promise(resolve => { this.#releasePut = resolve })
    const putEnqueued = new Promise<void>(resolve => { this.#putEnqueued = resolve })
    const deleteEnqueued = new Promise<void>(resolve => { this.#deleteEnqueued = resolve })
    return {
      putEnqueued,
      deleteEnqueued,
      release: () => {
        this.#releasePut?.()
        this.#releasePut = undefined
        this.#putGate = undefined
      },
    }
  }
}

function config(): AmphoreusConfig {
  return {
    skillRoots: [], dataDir: '', assetsRoot: '', commonPath: '', relationsPath: '', sectionAliases: {}, providerName: '', providerSource: '', providerRank: 0, registerProvider: true, forceUserOnly: false,
    heroWorkspaceMode: 'seats', magazineMode: 'light', seatStyle: true,
    wallpaper: { enabled: false, global: 'fixed', globalIndex: 0, sidebarIndex: 0, perSeat: false, darkMask: 0, lightMask: 0, surfaceAlpha: { light: 0.22, dark: 0.4 } },
    autoInvoke: { enabled: true, sources: [] }, receiptParsing: true, handoff: { enabled: true },
    workbench: { enabled: false, host: 'iframe', defaultView: 'chat', cardTextLimit: 8000, autoProjection: false },
    suiteWatch: { mode: 'off', pollMs: 15_000, debounceMs: 800 }, validate: { enabled: false, python: 'python' },
    sync: { source: '', ref: '', keepBackups: 3 }, trustedHosts: [],
    memory: { inject: true, autoNote: true, injectLimit: 8, command: 'remember' },
  }
}

function stores(bindings: QueuedBindings): AmphoreusStores {
  let global = structuredClone(INITIAL_GLOBAL)
  const empty = new Map()
  return {
    main: {
      global: { get: () => global, set: async value => { global = value } },
      table: (name: string) => {
        if (name === 'bindings') return bindings
        if (name === 'seats') return { get: (key: string) => key === SKILL ? { status: 'deployed' } : undefined, entries: () => empty.entries() }
        return { entries: () => empty.entries() }
      },
    },
    canvas: { table: () => ({ entries: () => empty.entries() }) },
    close: async () => {},
  } as unknown as AmphoreusStores
}

async function fixture() {
  const bindings = new QueuedBindings()
  const api = new AmphoreusWebApi({} as Context, {
    config: config(),
    stores: stores(bindings),
    resolver: { current: () => undefined } as unknown as SuiteResolver,
    nonce: NONCE,
  })
  const server = createServer((request, response) => { void api.handle(request, response) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  return { bindings, server, origin: `http://127.0.0.1:${address.port}` }
}

const binding = (sessionId: string): BindingRecord => ({
  sessionId,
  skillName: SKILL,
  boundAt: 1,
  source: 'manual',
  injection: { state: 'pending' },
})

test('DELETE without a body returns 404 for missing, 200 for existing, then 404 again', async () => {
  const { bindings, server, origin } = await fixture()
  const remove = (sessionId: string, nonce = NONCE) => fetch(`${origin}/amphoreus/api/bindings/${sessionId}`, {
    method: 'DELETE',
    headers: { 'x-amphoreus-nonce': nonce },
  })
  try {
    const missing = await remove(SESSION_A)
    assert.equal(missing.status, 404)
    assert.deepEqual(await missing.json(), { error: 'binding not found' })

    const unauthenticated = await fetch(`${origin}/amphoreus/api/bindings/${SESSION_A}`, { method: 'DELETE' })
    assert.equal(unauthenticated.status, 403)
    assert.deepEqual(await unauthenticated.json(), { error: 'invalid amphoreus nonce' })

    bindings.values.set(SESSION_A, binding(SESSION_A))
    const existing = await remove(SESSION_A)
    assert.equal(existing.status, 200)
    assert.deepEqual(await existing.json(), { deleted: true })
    assert.equal(bindings.values.has(SESSION_A), false)

    const repeated = await remove(SESSION_A)
    assert.equal(repeated.status, 404)
    assert.deepEqual(await repeated.json(), { error: 'binding not found' })
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('queued concurrent PUT then DELETE observes the committed PUT and leaves no binding', async () => {
  const { bindings, server, origin } = await fixture()
  const gate = bindings.pauseNextPut()
  const path = `${origin}/amphoreus/api/bindings/${SESSION_B}`
  const headers = { 'content-type': 'application/json', 'x-amphoreus-nonce': NONCE }
  try {
    const put = fetch(path, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ skill: SKILL, boundBy: 'manual' }),
    })
    await gate.putEnqueued
    const remove = fetch(path, { method: 'DELETE', headers: { 'x-amphoreus-nonce': NONCE } })
    await gate.deleteEnqueued
    gate.release()

    const [putResponse, deleteResponse] = await Promise.all([put, remove])
    assert.equal(putResponse.status, 200)
    assert.equal(deleteResponse.status, 200)
    assert.deepEqual(await deleteResponse.json(), { deleted: true })
    assert.equal(bindings.values.has(SESSION_B), false)

    const get = await fetch(path)
    assert.equal(get.status, 404)
    assert.deepEqual(await get.json(), { error: 'binding not found' })
  } finally {
    gate.release()
    server.close()
    await once(server, 'close')
  }
})

test('DELETE uses the table result directly and leaves existing binding contracts untouched', () => {
  const source = readFileSync(new URL('../src/host/webapi.ts', import.meta.url), 'utf8')
  const route = source.slice(source.indexOf('async #bindingsRoute'), source.indexOf('async #memoryRoute'))
  const remove = route.slice(route.indexOf("request.method === 'DELETE'"), route.indexOf("if (!method(request, response, 'PUT'))"))
  assert.match(remove, /const deleted = await table\.delete\(sessionId\)/)
  assert.doesNotMatch(remove, /table\.get\(/)
  assert.match(source, /request\.method !== 'DELETE' && !\(request\.headers\['content-type'\]/)
  assert.match(source, /const SESSION_ID = \/\^session-\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$\/iu/)
  assert.match(source, /boundBy: z\.enum\(\['seat-new', 'seat-enter', 'handoff', 'handoff-fork', 'fork-inherit', 'manual', 'dispatch'\]\)/)
  assert.doesNotMatch(source, /WorkbenchThread|SeatResolver/)
})

test('repeating a binding preserves accepted injection while a changed seat face starts a new binding', async () => {
  const { bindings, server, origin } = await fixture()
  const path = `${origin}/amphoreus/api/bindings/${SESSION_A}`
  const put = (face?: string) => fetch(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': NONCE },
    body: JSON.stringify({ skill: SKILL, boundBy: 'seat-enter', ...(face === undefined ? {} : { face }) }),
  })
  try {
    const original: BindingRecord = { ...binding(SESSION_A), injection: { state: 'done', at: 2 } }
    bindings.values.set(SESSION_A, original)
    const repeated = await put()
    assert.equal(repeated.status, 200)
    const same = (await repeated.json() as { binding: BindingRecord }).binding
    assert.equal(same.boundAt, 1)
    assert.deepEqual(same.injection, original.injection)

    const changed = await put('dialogue')
    assert.equal(changed.status, 200)
    const next = (await changed.json() as { binding: BindingRecord }).binding
    assert.ok(next.boundAt > original.boundAt)
    assert.equal(next.face, 'dialogue')
    assert.deepEqual(next.injection, { state: 'pending' })
  } finally {
    server.close()
    await once(server, 'close')
  }
})
