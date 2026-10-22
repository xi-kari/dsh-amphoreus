import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { SuiteResolver } from '../src/host/bridge.ts'
import { GlobalSchema, INITIAL_GLOBAL, type AmphoreusStores } from '../src/host/store.ts'
import { AmphoreusWebApi } from '../src/host/webapi.ts'
import { CODE_BACKGROUND_DEFAULTS } from '../src/shared/code-background.ts'
import { fixtureConfig } from './fixture-suite.ts'

const NONCE = 'code-background-test-nonce'

async function fixture(run: (api: AmphoreusWebApi, request: (path: string, body?: unknown, nonce?: string) => Promise<Response>, stored: () => typeof INITIAL_GLOBAL) => Promise<void>) {
  let global = structuredClone(INITIAL_GLOBAL)
  const stores = {
    main: {
      global: { get: () => global, set: async (value: typeof global) => { global = value } },
      table: () => ({ entries: () => new Map().entries() }),
    },
    canvas: { table: () => ({ entries: () => new Map().entries() }) },
    close: async () => {},
  } as unknown as AmphoreusStores
  const api = new AmphoreusWebApi({} as Context, {
    config: fixtureConfig(), stores,
    resolver: { current: () => undefined } as unknown as SuiteResolver,
    nonce: NONCE,
  })
  const server = createServer((request, response) => { void api.handle(request, response) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const request = (path: string, body?: unknown, nonce = NONCE) => fetch(`http://127.0.0.1:${address.port}/amphoreus/api/${path}`, {
    method: body === undefined ? 'GET' : 'PUT',
    headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': nonce },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  try { await run(api, request, () => global) } finally { server.close(); await once(server, 'close') }
}

test('code background is optional in storage, defaults off, and rejects invalid finite ranges', async () => {
  assert.equal(GlobalSchema.safeParse(INITIAL_GLOBAL).success, true)
  const withPrefs = (codeBackground: unknown) => ({ ...INITIAL_GLOBAL, prefs: { ...INITIAL_GLOBAL.prefs, codeBackground } })
  for (const intensity of [0, 0.45, 1]) {
    const result = GlobalSchema.parse(withPrefs({ intensity }))
    assert.deepEqual(result.prefs.codeBackground, { intensity })
  }
  for (const intensity of [-0.01, 1.01, NaN, Infinity, '0.45', null]) assert.equal(GlobalSchema.safeParse(withPrefs({ intensity })).success, false)
  await fixture(async api => {
    assert.deepEqual(api.state().effectiveConfig.codeBackground, CODE_BACKGROUND_DEFAULTS)
    assert.equal(api.state().effectiveConfig.wallpaper.mode, 'none')
  })
})

test('code background patches merge independently, serialize with other preferences, and reset only their override', async () => {
  await fixture(async (api, request, stored) => {
    assert.equal((await request('prefs', { codeBackground: { enabled: true, intensity: 0.7 } })).status, 200)
    assert.deepEqual(api.state().effectiveConfig.codeBackground, { enabled: true, intensity: 0.7, interactive: true })
    const responses = await Promise.all([
      request('prefs', { codeBackground: { interactive: false } }),
      request('prefs', { backgroundMode: 'preset', grammar: { ambient: false }, widget: { allowTopDock: true } }),
    ])
    assert.ok(responses.every(response => response.status === 200))
    assert.deepEqual(stored().prefs.codeBackground, { enabled: true, intensity: 0.7, interactive: false })
    assert.equal(stored().prefs.backgroundMode, 'preset')
    assert.deepEqual(stored().prefs.grammar, { ambient: false })
    assert.deepEqual(stored().prefs.widget, { allowTopDock: true })
    assert.equal((await request('prefs', { codeBackground: { enabled: false } })).status, 200)
    assert.deepEqual(api.state().effectiveConfig.codeBackground, { enabled: false, intensity: 0.7, interactive: false })
    assert.equal((await request('prefs', { codeBackground: null })).status, 200)
    assert.equal(Object.hasOwn(stored().prefs, 'codeBackground'), false)
    assert.deepEqual(api.state().effectiveConfig.codeBackground, CODE_BACKGROUND_DEFAULTS)
    assert.equal(stored().prefs.backgroundMode, 'preset')
    assert.equal(GlobalSchema.safeParse(stored()).success, true)
  })
})

test('code background mutation validates nested keys and requires the existing nonce', async () => {
  await fixture(async (_, request, stored) => {
    for (const codeBackground of [{ intensity: -1 }, { intensity: 2 }, { intensity: '0.5' }, { intensity: null }, { enabled: 1 }, { interactive: 'yes' }, { motion: 'full' }]) {
      assert.equal((await request('prefs', { codeBackground })).status, 400)
    }
    assert.equal((await request('prefs', { codeBackground: { enabled: true } }, '')).status, 403)
    assert.equal(Object.hasOwn(stored().prefs, 'codeBackground'), false)
  })
})

test('visual schemes round trip code background while legacy imports preserve it and explicit reset clears it', async () => {
  await fixture(async (api, request, stored) => {
    const prefs = { enabled: true, intensity: 0.3, interactive: false }
    await request('prefs', { codeBackground: prefs, backgroundMode: 'custom' })
    const exported = await (await request('prefs/visual-scheme')).json()
    assert.equal(exported.version, 1)
    assert.deepEqual(exported.codeBackground, prefs)
    assert.equal(exported.backgroundMode, undefined)
    assert.equal((await request('prefs/visual-scheme', { version: 1, grammar: { ambient: false } })).status, 200)
    assert.deepEqual(stored().prefs.codeBackground, prefs)
    assert.equal((await request('prefs/visual-scheme', { version: 1 })).status, 200)
    assert.deepEqual(stored().prefs.codeBackground, prefs)
    assert.equal((await request('prefs/visual-scheme', { version: 1, codeBackground: { intensity: 0.9 } })).status, 200)
    assert.deepEqual(api.state().effectiveConfig.codeBackground, { ...CODE_BACKGROUND_DEFAULTS, intensity: 0.9 })
    assert.equal((await request('prefs/visual-scheme', exported)).status, 200)
    assert.deepEqual(stored().prefs.codeBackground, prefs)
    assert.equal((await request('prefs/visual-scheme', { version: 1, codeBackground: { intensity: 1.2 } })).status, 400)
    assert.deepEqual(stored().prefs.codeBackground, prefs)
    assert.equal((await request('prefs/visual-scheme', { version: 1, codeBackground: null })).status, 200)
    assert.deepEqual(api.state().effectiveConfig.codeBackground, CODE_BACKGROUND_DEFAULTS)
    assert.equal(stored().prefs.backgroundMode, 'custom')
  })
})
