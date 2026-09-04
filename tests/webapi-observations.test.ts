import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import type { SuiteResolver } from '../src/host/bridge.ts'
import type { AmphoreusStores } from '../src/host/store.ts'
import { AmphoreusWebApi } from '../src/host/webapi.ts'
import { fixtureConfig, fixtureSnapshot } from './fixture-suite.ts'

function memoryTable() {
  const values = new Map<string, unknown>()
  return {
    get: (key: string) => values.get(key),
    put: async (key: string, value: unknown) => { values.set(key, value) },
    update: async (key: string, transform: (current: unknown) => unknown) => {
      if (!values.has(key)) throw new Error('missing-key')
      const next = transform(values.get(key))
      values.set(key, next)
      return next
    },
    delete: async (key: string) => values.delete(key),
    entries: () => values.entries(),
  }
}

function fakeStores(): AmphoreusStores {
  const tables = new Map<string, ReturnType<typeof memoryTable>>()
  const table = (name: string) => {
    let value = tables.get(name)
    if (value === undefined) {
      value = memoryTable()
      tables.set(name, value)
    }
    return value
  }
  return { main: { table }, canvas: { table }, close: async () => {} } as unknown as AmphoreusStores
}

test('observations API authorizes, validates, persists, filters and patches dispatch records', async () => {
  const stores = fakeStores()
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
  const base = `http://127.0.0.1:${address.port}`
  const jsonHeaders = { 'content-type': 'application/json' }
  const authHeaders = { ...jsonHeaders, 'x-amphoreus-nonce': 'test-nonce' }
  const sessionId = 'session-00000000-0000-4000-8000-000000000001'
  const body = { sessionId, seq: 0, kind: 'dispatch', targetSkillName: 'amphoreus-testcard-a', payload: '测试', dispatchedFrom: 'panel' }
  const post = (value: unknown, headers: Record<string, string> = authHeaders) => fetch(`${base}/amphoreus/api/observations`, {
    method: 'POST', headers, body: JSON.stringify(value),
  })
  const put = (key: string, value: unknown) => fetch(`${base}/amphoreus/api/observations/${encodeURIComponent(key)}`, {
    method: 'PUT', headers: authHeaders, body: JSON.stringify(value),
  })

  try {
    assert.equal((await post(body, jsonHeaders)).status, 403)
    assert.equal((await post(body, { 'x-amphoreus-nonce': 'test-nonce' })).status, 415)

    const created = await post(body)
    assert.equal(created.status, 201)
    const createdBody = await created.json() as { observation: { status: string; acceptedSessionId?: string; kind: string; skillName?: string; targetSkillName?: string; rawLine: string; payload?: string } }
    assert.equal(createdBody.observation.status, 'accepted')
    assert.equal(createdBody.observation.acceptedSessionId, sessionId)
    assert.equal(createdBody.observation.kind, 'dispatch')
    assert.equal(createdBody.observation.skillName, 'amphoreus-testcard-a')
    assert.equal(createdBody.observation.targetSkillName, 'amphoreus-testcard-a')
    assert.equal(createdBody.observation.rawLine, body.payload)
    assert.equal(createdBody.observation.payload, body.payload)

    const matching = await fetch(`${base}/amphoreus/api/observations?sessionId=${sessionId}`)
    assert.equal(matching.status, 200)
    const matchingBody = await matching.json() as { observations: { kind: string }[] }
    assert.equal(matchingBody.observations.length, 1)
    assert.equal(matchingBody.observations[0]?.kind, 'dispatch')
    const other = await fetch(`${base}/amphoreus/api/observations?sessionId=session-ffffffff-ffff-4fff-8fff-ffffffffffff`)
    assert.deepEqual(await other.json(), { observations: [] })

    assert.equal((await post({ ...body, kind: 'receipt' })).status, 400)
    assert.equal((await post({ ...body, seq: 1 })).status, 400)
    assert.equal((await post({ ...body, payload: 'x'.repeat(4001) })).status, 400)
    assert.equal((await post({ ...body, targetSkillName: 'amphoreus-nobody' })).status, 404)
    assert.equal((await post({ ...body, payload: 'a'.repeat(70 * 1024) })).status, 413)

    assert.equal((await put('not-a-key', { status: 'dismissed' })).status, 400)
    assert.equal((await put(`${sessionId}:9:dispatch`, { status: 'dismissed' })).status, 404)
    const key = `${sessionId}:0:dispatch`
    assert.equal((await put(key, { status: 'bogus' })).status, 400)
    const patched = await put(key, { status: 'dismissed' })
    assert.equal(patched.status, 200)
    assert.equal(((await patched.json()) as { observation: { status: string } }).observation.status, 'dismissed')
    const after = await fetch(`${base}/amphoreus/api/observations?sessionId=${sessionId}`)
    assert.equal(((await after.json()) as { observations: { status: string }[] }).observations[0]?.status, 'dismissed')
  } finally {
    server.close()
    await once(server, 'close')
  }
})
