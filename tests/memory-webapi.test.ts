import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import type { SuiteResolver } from '../src/host/bridge.ts'
import { INITIAL_GLOBAL, type AmphoreusStores, type MemoryRecord } from '../src/host/store.ts'
import { AmphoreusWebApi } from '../src/host/webapi.ts'
import { appendSeatNote } from '../src/host/memory.ts'
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

    // The append route always echoes the STORED note.
    const echoed = await call(`/${skill}/notes`, 'POST', { text: '回显' })
    const echoedBody = await echoed.json() as { note: { id: string; text: string }; memory: MemoryRecord }
    assert.deepEqual(echoedBody.memory.notes.find(note => note.id === echoedBody.note.id), echoedBody.note)

    // Legacy full PUT still replaces the record (64 KiB) but tombstones the replayable (seat/seq) notes it drops,
    // so the workbench ledger's delete cannot be undone by startup replay. Plain user notes leave no tombstone.
    const before = table('memory').get(skill) as MemoryRecord
    assert.ok(before.notes.some(note => note.author === 'seat'))
    const put = await call(`/${skill}`, 'PUT', { notes: [], pinnedSessionIds: [] })
    assert.equal(put.status, 200)
    const replaced = table('memory').get(skill) as MemoryRecord
    assert.equal(replaced.notes.length, 0)
    assert.deepEqual(replaced.deletedNoteIds, before.notes.filter(note => note.author === 'seat').map(note => note.id))
    assert.deepEqual(((await put.json()) as { memory: MemoryRecord }).memory.deletedNoteIds, replaced.deletedNoteIds)
    // A tombstoned id can no longer be appended.
    const tombstoned = replaced.deletedNoteIds![0]!
    assert.equal(await appendSeatNote(table('memory') as never, skill, { text: '复活？', author: 'seat', id: tombstoned }), undefined)
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

test('legacy whole-record PUT runs inside the memory write queue: a seat note appended meanwhile survives, and tombstones never shrink', async () => {
  const { stores, table } = fakeStores()
  // A slow `put` widens the get→put window so the race below is deterministic.
  const memory = table('memory')
  let release: (() => void) | undefined
  const originalPut = memory.put
  memory.put = async (key: string, value: unknown) => {
    if (release === undefined) await new Promise<void>(resolve => { release = resolve })
    await originalPut(key, value)
  }
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
  const skill = 'amphoreus-testcard-a'
  const auth = { 'content-type': 'application/json', 'x-amphoreus-nonce': 'test-nonce' }
  try {
    memory.values.set(skill, { skillName: skill, notes: [{ id: 'keep', text: '既有', createdAt: 1, author: 'user' }], pinnedSessionIds: [], updatedAt: 1, deletedNoteIds: ['old-tombstone'] })
    // Ledger echoes a stale record (it never saw the seat note) and drops the tombstone list entirely.
    const putRequest = fetch(`http://127.0.0.1:${address.port}/amphoreus/api/memory/${skill}`, {
      method: 'PUT', headers: auth, body: JSON.stringify({ notes: [{ id: 'keep', text: '既有', createdAt: 1, author: 'user' }], pinnedSessionIds: ['pinned'] }),
    })
    // Observer appends a seat note while the PUT is between its read and its (blocked) write.
    await new Promise(resolve => setTimeout(resolve, 30))
    const appended = appendSeatNote(memory as never, skill, { text: '席位留言', author: 'seat', id: 'session-x:5:note', seq: 5 })
    await new Promise(resolve => setTimeout(resolve, 30))
    release!()
    const [put, note] = await Promise.all([putRequest, appended])
    assert.equal(put.status, 200)
    assert.ok(note !== undefined)
    const stored = memory.get(skill) as MemoryRecord
    assert.deepEqual(stored.notes.map(entry => entry.id), ['keep', 'session-x:5:note'], 'the queued PUT landed first and the seat note was appended on top of it')
    assert.deepEqual(stored.pinnedSessionIds, ['pinned'])
    assert.deepEqual(stored.deletedNoteIds, ['old-tombstone'], 'a body without deletedNoteIds cannot erase stored tombstones')

    // A body that still carries a note tombstoned meanwhile (panel delete racing a stale ledger echo) does not resurrect it.
    memory.put = originalPut
    memory.values.set(skill, { ...stored, notes: [stored.notes[0]!], deletedNoteIds: ['old-tombstone', 'session-x:5:note'] })
    const stale = await fetch(`http://127.0.0.1:${address.port}/amphoreus/api/memory/${skill}`, {
      method: 'PUT', headers: auth, body: JSON.stringify({ notes: stored.notes, pinnedSessionIds: [], deletedNoteIds: ['old-tombstone'] }),
    })
    assert.equal(stale.status, 200)
    const after = memory.get(skill) as MemoryRecord
    assert.deepEqual(after.notes.map(entry => entry.id), ['keep'])
    assert.deepEqual(after.deletedNoteIds, ['old-tombstone', 'session-x:5:note'], 'tombstones are unioned, never shrunk by the client list')
  } finally {
    server.close()
    await once(server, 'close')
  }
})
