import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { SuiteResolver } from '../src/host/bridge.ts'
import type { AmphoreusConfig } from '../src/host/config.ts'
import { INITIAL_GLOBAL, type AmphoreusStores, type SeatRecord } from '../src/host/store.ts'
import { AmphoreusWebApi } from '../src/host/webapi.ts'

const NONCE = 'seat-preset-test'
const SKILL = 'amphoreus-aglaea'

function config(): AmphoreusConfig {
  return {
    skillRoots: [], dataDir: '', assetsRoot: '', commonPath: '', relationsPath: '', sectionAliases: {}, providerName: '', providerSource: '', providerRank: 0, registerProvider: true, forceUserOnly: false,
    heroWorkspaceMode: 'seats', magazineMode: 'light', seatStyle: true,
    wallpaper: { enabled: false, global: 'fixed', globalIndex: 0, sidebarIndex: 0, perSeat: false, darkMask: 0, lightMask: 0, surfaceAlpha: { light: 0.22, dark: 0.4 } },
    autoInvoke: { enabled: true, sources: [] }, receiptParsing: true, handoff: { enabled: true },
    workbench: { enabled: false, host: 'iframe', defaultView: 'chat', cardTextLimit: 8000, autoProjection: false },
    suiteWatch: { mode: 'off', pollMs: 15_000, debounceMs: 800 }, validate: { enabled: false, python: 'python' },
    sync: { source: '', ref: '', keepBackups: 3 }, trustedHosts: [],
  }
}

const seat = (): SeatRecord => ({
  skillName: SKILL, heroId: 'aglaea', displayName: '阿格莱雅', aliases: [], duties: [], status: 'deployed', order: 1, firstSeenAt: 1, lastSeenAt: 1, userOrder: 5,
})

async function fixture() {
  const seats = new Map<string, SeatRecord>([[SKILL, seat()]])
  const puts: [string, SeatRecord][] = []
  let global = structuredClone(INITIAL_GLOBAL)
  const empty = new Map()
  const stores = {
    main: {
      global: { get: () => global, set: async (value: typeof global) => { global = value } },
      table: (name: string) => name === 'seats'
        ? {
            get: (key: string) => seats.get(key),
            put: async (key: string, value: SeatRecord) => { puts.push([key, value]); seats.set(key, value) },
            // Platform semantics: atomic read-modify-write at the queue slot; a missing key rejects.
            update: async (key: string, transform: (current: SeatRecord) => SeatRecord) => {
              const current = seats.get(key)
              if (current === undefined) throw Object.assign(new Error('missing-key'), { code: 'missing-key' })
              const next = transform(current)
              puts.push([key, next])
              seats.set(key, next)
              return next
            },
            entries: () => seats.entries(),
          }
        : { entries: () => empty.entries() },
    },
    canvas: { table: () => ({ entries: () => empty.entries() }) },
    close: async () => {},
  } as unknown as AmphoreusStores
  const api = new AmphoreusWebApi({} as Context, { config: config(), stores, resolver: { current: () => undefined } as unknown as SuiteResolver, nonce: NONCE })
  const server = createServer((request, response) => { void api.handle(request, response) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const put = (skill: string, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json', 'x-amphoreus-nonce': NONCE }) =>
    fetch(`${origin}/amphoreus/api/seats/${skill}/preset`, { method: 'PUT', headers, body: JSON.stringify(body) })
  return { seats, puts, server, origin, put }
}

test('PUT seats/<skill>/preset stores, replaces and clears the tiers; the seat record otherwise survives untouched', async () => {
  const { seats, puts, server, origin, put } = await fixture()
  try {
    const stored = await put(SKILL, { agentPreset: 'standard', model: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' }, permission: 'workspace-write' })
    assert.equal(stored.status, 200)
    assert.deepEqual(await stored.json(), { preset: { agentPreset: 'standard', model: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' }, permission: 'workspace-write' } })
    assert.equal(seats.get(SKILL)?.userOrder, 5)
    assert.equal(seats.get(SKILL)?.displayName, '阿格莱雅')

    const replaced = await put(SKILL, { permission: 'read-only' })
    assert.deepEqual(await replaced.json(), { preset: { permission: 'read-only' } })

    const read = await fetch(`${origin}/amphoreus/api/seats/${SKILL}/preset`)
    assert.equal(read.status, 200)
    assert.deepEqual(await read.json(), { preset: { permission: 'read-only' } })

    const cleared = await put(SKILL, null)
    assert.equal(cleared.status, 200)
    assert.deepEqual(await cleared.json(), { preset: null })
    assert.equal(Object.hasOwn(seats.get(SKILL)!, 'preset'), false)

    const emptyObject = await put(SKILL, {})
    assert.deepEqual(await emptyObject.json(), { preset: null })
    assert.equal(Object.hasOwn(seats.get(SKILL)!, 'preset'), false)
    assert.equal(puts.length, 4)

    const list = await fetch(`${origin}/amphoreus/api/seats`)
    assert.equal(list.status, 200)
    assert.equal(((await list.json()) as { seats: SeatRecord[] }).seats.length, 1)
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('PUT seats/<skill>/preset validates strictly and refuses unknown seats and paths', async () => {
  const { server, origin, put } = await fixture()
  try {
    assert.equal((await put('amphoreus-nobody', { permission: 'read-only' })).status, 404)
    assert.equal((await fetch(`${origin}/amphoreus/api/seats/${SKILL}/other`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': NONCE }, body: '{}' })).status, 404)
    assert.equal((await fetch(`${origin}/amphoreus/api/seats/${SKILL}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': NONCE }, body: '{}' })).status, 404)
    assert.equal((await fetch(`${origin}/amphoreus/api/seats/Bad%20Name/preset`)).status, 404)

    for (const body of [
      { agentPreset: 'Bad Preset' },
      { model: { provider: 'deepseek' } },
      { model: { provider: 'deepseek', model: 'deepseek-chat', extra: 1 } },
      { permission: '' },
      { unknown: true },
      [],
      'text',
    ]) {
      const response = await put(SKILL, body)
      assert.equal(response.status, 400, JSON.stringify(body))
    }

    const noNonce = await put(SKILL, { permission: 'read-only' }, { 'content-type': 'application/json' })
    assert.equal(noNonce.status, 403)
    const notJson = await put(SKILL, { permission: 'read-only' }, { 'content-type': 'text/plain', 'x-amphoreus-nonce': NONCE })
    assert.equal(notJson.status, 415)
    const wrongMethod = await fetch(`${origin}/amphoreus/api/seats/${SKILL}/preset`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': NONCE }, body: '{}' })
    assert.equal(wrongMethod.status, 405)
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('the seat preset branch sits after the exact /amphoreus/api/seats check and is nonce/json gated like bindings', () => {
  const source = readFileSync(new URL('../src/host/webapi.ts', import.meta.url), 'utf8')
  const exact = source.indexOf("if (path === '/amphoreus/api/seats') {")
  const prefix = source.indexOf("if (path.startsWith('/amphoreus/api/seats/')) {")
  assert.ok(exact >= 0 && prefix > exact)
  assert.match(source, /async #seatPresetRoute\(/u)
  assert.match(source, /const SeatPresetInput = z\.object\(\{[\s\S]*?\}\)\.strict\(\)\.nullable\(\)/u)
  const route = source.slice(source.indexOf('async #seatPresetRoute'), source.indexOf('#authorize(request: IncomingMessage'))
  assert.match(route, /SKILL_NAME\.test\(skill\)/u)
  assert.match(route, /await readJson\(request\)/u)
})

test('PUT seats/<skill>/preset merges against the live record: a reconcile landing between read and write is not reverted', async () => {
  const { seats, server, put } = await fixture()
  try {
    // Simulate reconcileSeats writing status/name changes right after the route read the seat (before the body arrived).
    const originalGet = seats.get.bind(seats)
    let renamed = false
    seats.get = ((key: string) => {
      const value = originalGet(key)
      if (value !== undefined && !renamed) {
        renamed = true
        queueMicrotask(() => { seats.set(key, { ...value, displayName: '阿格莱雅（改）', lastSeenAt: 99 }) })
      }
      return value
    }) as typeof seats.get
    const stored = await put(SKILL, { permission: 'read-only' })
    assert.equal(stored.status, 200)
    const record = seats.get(SKILL)!
    assert.deepEqual(record.preset, { permission: 'read-only' })
    assert.equal(record.displayName, '阿格莱雅（改）', 'the concurrent reconcile write survives')
    assert.equal(record.lastSeenAt, 99)
  } finally {
    server.close()
    await once(server, 'close')
  }
})
