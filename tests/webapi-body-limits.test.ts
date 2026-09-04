import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { AmphoreusConfig } from '../src/host/config.ts'
import type { SuiteResolver } from '../src/host/bridge.ts'
import { INITIAL_GLOBAL, type AmphoreusStores, type CanvasRecord } from '../src/host/store.ts'
import { AmphoreusWebApi } from '../src/host/webapi.ts'

const SESSION_ID = 'session-00000000-0000-0000-0000-000000000001'
const NONCE = 'body-limit-test'

test('canvas alone accepts more than 4 KiB while all routes fail at their own hard limit', async () => {
  const canvas = new Map<string, CanvasRecord>()
  let global = structuredClone(INITIAL_GLOBAL)
  const stores = {
    main: {
      global: {
        get: () => global,
        set: async (value: typeof global) => { global = value },
      },
      table: () => ({ entries: () => new Map().entries() }),
    },
    canvas: {
      table: () => ({
        get: (key: string) => canvas.get(key),
        put: async (key: string, value: CanvasRecord) => { canvas.set(key, value) },
      }),
    },
    close: async () => {},
  } as unknown as AmphoreusStores
  const api = new AmphoreusWebApi({} as Context, {
    config: { trustedHosts: [] } as AmphoreusConfig,
    stores,
    resolver: { current: () => undefined } as unknown as SuiteResolver,
    nonce: NONCE,
  })
  const server = createServer((request, response) => { void api.handle(request, response) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`

  const put = (path: string, body: string, revision?: string) => fetch(`${origin}${path}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-amphoreus-nonce': NONCE,
      ...(revision === undefined ? {} : { 'x-amphoreus-canvas-revision': revision }),
    },
    body,
  })

  try {
    const positions = Object.fromEntries(Array.from({ length: 70 }, (_, index) => [
      `${SESSION_ID}:turn:${index}`,
      { x: index * 11, y: index * 13 },
    ]))
    const canvasBody = JSON.stringify({ positions, collapsed: [], branchAnchors: {} })
    assert.ok(Buffer.byteLength(canvasBody) > 4 * 1024)
    assert.ok(Buffer.byteLength(canvasBody) < 64 * 1024)
    const accepted = await put(`/amphoreus/api/canvas/${SESSION_ID}`, canvasBody)
    assert.equal(accepted.status, 200)
    assert.equal(Object.keys(canvas.get(SESSION_ID)?.positions ?? {}).length, 70)

    const generation = (x: number) => JSON.stringify({ positions: { [`${SESSION_ID}:turn:1`]: { x, y: x } }, collapsed: [], branchAnchors: {} })
    const newer = await put(`/amphoreus/api/canvas/${SESSION_ID}`, generation(200), '200')
    assert.equal(newer.status, 200)
    const older = await put(`/amphoreus/api/canvas/${SESSION_ID}`, generation(100), '100')
    assert.equal(older.status, 200)
    assert.equal((await older.json() as { stale: boolean }).stale, true)
    assert.equal(canvas.get(SESSION_ID)?.positions[`${SESSION_ID}:turn:1`]?.x, 200)

    for (const revision of ['-1', '1.5', String(Number.MAX_SAFE_INTEGER + 1)]) {
      const invalidRevision = await put(`/amphoreus/api/canvas/${SESSION_ID}`, generation(300), revision)
      assert.equal(invalidRevision.status, 400)
      assert.deepEqual(await invalidRevision.json(), { error: 'invalid canvas revision' })
    }

    const canvasOversize = JSON.stringify({ positions: {}, collapsed: [], branchAnchors: {}, padding: 'x'.repeat(64 * 1024) })
    const rejectedCanvas = await put(`/amphoreus/api/canvas/${SESSION_ID}`, canvasOversize)
    assert.equal(rejectedCanvas.status, 413)
    assert.deepEqual(await rejectedCanvas.json(), { error: 'request body exceeds 65536 bytes' })

    const initializedPrefs = await put('/amphoreus/api/prefs', JSON.stringify({ quickPhrases: [] }))
    assert.equal(initializedPrefs.status, 200)
    assert.equal(global.prefs.quickPhrasesInitialized, true)

    const rejectedPrefs = await put('/amphoreus/api/prefs', JSON.stringify({ padding: 'x'.repeat(4 * 1024) }))
    assert.equal(rejectedPrefs.status, 413)
    assert.deepEqual(await rejectedPrefs.json(), { error: 'request body exceeds 4096 bytes' })
  } finally {
    server.close()
    await once(server, 'close')
  }
})
