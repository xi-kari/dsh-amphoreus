import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import type { SuiteResolver } from '../src/host/bridge.ts'
import { INITIAL_GLOBAL, type AmphoreusStores, type MemoryRecord } from '../src/host/store.ts'
import { AmphoreusWebApi } from '../src/host/webapi.ts'
import { fixtureConfig, fixtureSnapshot } from './fixture-suite.ts'

function memoryTable() {
  const values = new Map<string, unknown>()
  return {
    values,
    get: (key: string) => values.get(key),
    put: async (key: string, value: unknown) => { values.set(key, value) },
    update: async (key: string, transform: (current: unknown) => unknown) => {
      if (!values.has(key)) throw Object.assign(new Error('missing-key'), { code: 'missing-key' })
      const next = transform(values.get(key))
      values.set(key, next)
      return next
    },
    delete: async (key: string) => values.delete(key),
    entries: () => values.entries(),
  }
}

function fakeStores() {
  const tables = new Map<string, ReturnType<typeof memoryTable>>()
  const table = (name: string) => {
    let value = tables.get(name)
    if (value === undefined) {
      value = memoryTable()
      tables.set(name, value)
    }
    return value
  }
  const global = { get: () => INITIAL_GLOBAL, set: async () => {} }
  return { stores: { main: { table, global }, canvas: { table }, close: async () => {} } as unknown as AmphoreusStores, table }
}

test('memory sub-routes append, delete and patch without replacing the record; skill is validated after splitting', async () => {
  const { stores, table } = fakeStores()
  const snapshot = fixtureSnapshot()
  const resolver = { current: () => snapshot, onSnapshot: () => () => {} } as unknown as SuiteResolver
  const ctx = {
    webServer: { register: () => () => {} },
    on: () => () => {},
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    sessions: { list: () => [] },
  } as unknown as Context
  const api = new AmphoreusWebApi(ctx, { config: fixtureConfig(), stores, resolver, nonce: 'test-nonce' })
  const server = createServer((request, response) => { void api.handle(request, response) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/amphoreus/api/memory`
  const jsonHeaders = { 'content-type': 'application/json' }
  const auth = { ...jsonHeaders, 'x-amphoreus-nonce': 'test-nonce' }
  const skill = 'amphoreus-testcard-a'
  const call = (path: string, method: string, body?: unknown, headers: Record<string, string> = auth) => fetch(`${base}${path}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  try {
    // Authorization gates apply to every write.
    assert.equal((await call(`/${skill}/notes`, 'POST', { text: 'x' }, jsonHeaders)).status, 403)
    assert.equal((await call(`/${skill}/notes`, 'POST', { text: 'x' }, { 'x-amphoreus-nonce': 'test-nonce' })).status, 415)
    assert.equal((await call(`/${skill}/notes/abc`, 'DELETE', undefined, {})).status, 403)

    // Skill validation happens on the first segment only.
    assert.equal((await call('/not-a-skill/notes', 'POST', { text: 'x' })).status, 400)
    assert.equal((await call(`/${skill}/unknown`, 'GET')).status, 404)
    assert.equal((await call(`/${skill}/notes`, 'GET')).status, 405)
    assert.equal((await call(`/${skill}/settings`, 'POST', {})).status, 405)

    // Append creates the record and defaults author to 'user'.
    const created = await call(`/${skill}/notes`, 'POST', { text: '  记住雨天  ' })
    assert.equal(created.status, 201)
    const createdBody = await created.json() as { note: { id: string; text: string; author: string }; memory: MemoryRecord }
    assert.equal(createdBody.note.text, '记住雨天')
    assert.equal(createdBody.note.author, 'user')
    assert.equal(createdBody.memory.notes.length, 1)
    assert.deepEqual(createdBody.memory.pinnedSessionIds, [])

    // Validation: empty, too long, unknown keys, wrong author.
    assert.equal((await call(`/${skill}/notes`, 'POST', { text: '' })).status, 400)
    assert.equal((await call(`/${skill}/notes`, 'POST', { text: 'x'.repeat(501) })).status, 400)
    assert.equal((await call(`/${skill}/notes`, 'POST', { text: 'x', extra: 1 })).status, 400)
    assert.equal((await call(`/${skill}/notes`, 'POST', { text: 'x', author: 'ghost' })).status, 400)
    assert.equal((await call(`/${skill}/notes`, 'POST', { text: '   ' })).status, 400)
    // 4 KiB body limit on the append route (500-char texts fit; padding does not).
    assert.equal((await call(`/${skill}/notes`, 'POST', { text: 'x', pad: 'y'.repeat(5000) })).status, 413)

    // A seat-authored append and a >200 text is clamped, not rejected.
    const seat = await call(`/${skill}/notes`, 'POST', { text: '長'.repeat(300), author: 'seat' })
    assert.equal(seat.status, 201)
    const seatBody = await seat.json() as { note: { text: string; author: string } }
    assert.equal([...seatBody.note.text].length, 200)
    assert.equal(seatBody.note.author, 'seat')

    // Append never clobbers a concurrent host-side note (update semantic, no full replace).
    const record = table('memory').get(skill) as MemoryRecord
    table('memory').values.set(skill, { ...record, notes: [...record.notes, { id: 'host-note', text: '宿主写的', createdAt: 1, author: 'seat' }] })
    await call(`/${skill}/notes`, 'POST', { text: '再一条' })
    const afterAppend = table('memory').get(skill) as MemoryRecord
    assert.deepEqual(afterAppend.notes.map(note => note.text), ['记住雨天', '長'.repeat(200), '宿主写的', '再一条'])

    // Delete by id; unknown id → 404; GET of the record still works.
    const removed = await call(`/${skill}/notes/${encodeURIComponent(createdBody.note.id)}`, 'DELETE', undefined, { 'x-amphoreus-nonce': 'test-nonce' })
    assert.equal(removed.status, 200)
    assert.equal(((await removed.json()) as { memory: MemoryRecord }).memory.notes.length, 3)
    assert.equal((await call(`/${skill}/notes/${encodeURIComponent(createdBody.note.id)}`, 'DELETE', undefined, { 'x-amphoreus-nonce': 'test-nonce' })).status, 404)
    const got = await call(`/${skill}`, 'GET')
    assert.equal(got.status, 200)
    assert.equal(((await got.json()) as { memory: MemoryRecord }).memory.notes.length, 3)

    // Settings patch merges and reports the effective view; unknown keys and out-of-range values are rejected.
    const patched = await call(`/${skill}/settings`, 'PUT', { inject: false })
    assert.equal(patched.status, 200)
    const patchedBody = await patched.json() as { memory: MemoryRecord; effective: { inject: boolean; autoNote: boolean; injectLimit: number } }
    assert.deepEqual(patchedBody.memory.settings, { inject: false })
    assert.deepEqual(patchedBody.effective, { inject: false, autoNote: true, injectLimit: 8 })
    assert.equal(patchedBody.memory.notes.length, 3, 'settings patch keeps notes')
    const limited = await call(`/${skill}/settings`, 'PUT', { injectLimit: 3 })
    assert.deepEqual(((await limited.json()) as { memory: MemoryRecord }).memory.settings, { inject: false, injectLimit: 3 })
    assert.equal((await call(`/${skill}/settings`, 'PUT', { injectLimit: 51 })).status, 400)
    assert.equal((await call(`/${skill}/settings`, 'PUT', { injectLimit: 1.5 })).status, 400)
    assert.equal((await call(`/${skill}/settings`, 'PUT', { bogus: true })).status, 400)
    // Settings for a seat without any record creates an otherwise empty record.
    const fresh = await call('/amphoreus-testcard-b/settings', 'PUT', { autoNote: false })
    assert.equal(fresh.status, 200)
    const freshBody = ((await fresh.json()) as { memory: MemoryRecord }).memory
    assert.deepEqual({ ...freshBody, updatedAt: 0 }, { skillName: 'amphoreus-testcard-b', notes: [], pinnedSessionIds: [], settings: { autoNote: false }, updatedAt: 0 })

    // Legacy full PUT is untouched (still whole-record replace) and state exposes effectiveConfig.memory.
    const put = await call(`/${skill}`, 'PUT', { notes: [], pinnedSessionIds: [] })
    assert.equal(put.status, 200)
    assert.equal((table('memory').get(skill) as MemoryRecord).notes.length, 0)
    const state = await fetch(`http://127.0.0.1:${address.port}/amphoreus/api/state`)
    const stateBody = await state.json() as { effectiveConfig: { memory: unknown }; memory: MemoryRecord[] }
    assert.deepEqual(stateBody.effectiveConfig.memory, { inject: true, autoNote: true, injectLimit: 8, command: 'remember' })
    assert.equal(stateBody.memory.length, 2)
  } finally {
    server.close()
    await once(server, 'close')
  }
})
