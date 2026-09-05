import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { SuiteResolver } from '../src/host/bridge.ts'
import { GlobalSchema, INITIAL_GLOBAL, type AmphoreusGlobal, type AmphoreusStores } from '../src/host/store.ts'
import { AmphoreusWebApi } from '../src/host/webapi.ts'
import { fixtureConfig } from './fixture-suite.ts'

const NONCE = 'visual-scheme-nonce'
const PATH = '/amphoreus/api/prefs/visual-scheme'

interface Harness {
  readonly origin: string
  readonly read: () => AmphoreusGlobal
  readonly write: (value: AmphoreusGlobal) => void
  readonly close: () => Promise<void>
}

async function harness(): Promise<Harness> {
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
    config: fixtureConfig(),
    stores,
    resolver: { current: () => undefined } as unknown as SuiteResolver,
    nonce: NONCE,
  })
  const server = createServer((request, response) => { void api.handle(request, response) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    read: () => global,
    write: value => { global = value },
    close: async () => {
      server.close()
      await once(server, 'close')
    },
  }
}

const SEEDED_PREFS: AmphoreusGlobal['prefs'] = {
  lastSeat: 'amphoreus-aglaea',
  wallpaperCursor: 7,
  quickPhrases: ['继续', '停'],
  quickPhrasesInitialized: true,
  magazineMode: 'full',
  grammar: { blurScale: 1.4, mascot: 'static' },
  customWallpapers: {
    aglaea: { fit: 'contain', x: 10, y: 90 },
    mydei: { scale: 2, paused: true },
  },
}

test('GET visual-scheme exports only the three visual prefs, sparse, as an attachment', async () => {
  const h = await harness()
  try {
    const empty = await fetch(`${h.origin}${PATH}`)
    assert.equal(empty.status, 200)
    assert.equal(empty.headers.get('content-disposition'), 'attachment; filename="amphoreus-visual-scheme.json"')
    assert.match(empty.headers.get('content-type') ?? '', /^application\/json/u)
    assert.equal(empty.headers.get('cache-control'), 'no-store')
    const emptyBody = await empty.json() as Record<string, unknown>
    assert.deepEqual(Object.keys(emptyBody).sort(), ['exportedAt', 'version'])
    assert.equal(emptyBody.version, 1)
    assert.equal(typeof emptyBody.exportedAt, 'number')

    h.write({ ...h.read(), prefs: structuredClone(SEEDED_PREFS) })
    const full = await fetch(`${h.origin}${PATH}`)
    assert.equal(full.status, 200)
    const body = await full.json() as Record<string, unknown>
    assert.deepEqual(Object.keys(body).sort(), ['customWallpapers', 'exportedAt', 'grammar', 'magazineMode', 'version'])
    assert.equal(body.magazineMode, 'full')
    assert.deepEqual(body.grammar, SEEDED_PREFS.grammar)
    assert.deepEqual(body.customWallpapers, SEEDED_PREFS.customWallpapers)
    for (const key of ['lastSeat', 'wallpaperCursor', 'quickPhrases', 'quickPhrasesInitialized']) assert.equal(Object.hasOwn(body, key), false, key)

    const head = await fetch(`${h.origin}${PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': NONCE }, body: '{}' })
    assert.equal(head.status, 405)
    assert.equal(head.headers.get('allow'), 'GET, PUT', 'Allow lists every served method (RFC 9110 §10.2.1)')
    const del = await fetch(`${h.origin}${PATH}`, { method: 'DELETE', headers: { 'x-amphoreus-nonce': NONCE } })
    assert.equal(del.status, 405)
    assert.equal(del.headers.get('allow'), 'GET, PUT')
  } finally {
    await h.close()
  }
})

test('PUT visual-scheme replaces exactly the visual prefs and keeps every other pref', async () => {
  const h = await harness()
  const put = (body: unknown, headers: Record<string, string> = { 'content-type': 'application/json', 'x-amphoreus-nonce': NONCE }) =>
    fetch(`${h.origin}${PATH}`, { method: 'PUT', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
  try {
    h.write({ ...h.read(), prefs: structuredClone(SEEDED_PREFS) })

    // Full replace: seat `mydei` is absent from the file and must disappear; grammar loses `mascot`.
    const scheme = {
      version: 1,
      exportedAt: 1_700_000_000_000,
      magazineMode: 'light',
      grammar: { blurScale: 0.5 },
      customWallpapers: { aglaea: { x: 33 }, cipher: { fit: 'fill', muted: false } },
    }
    const replaced = await put(scheme)
    assert.equal(replaced.status, 200)
    const payload = await replaced.json() as { prefs: AmphoreusGlobal['prefs'] }
    assert.deepEqual(payload.prefs, h.read().prefs)
    const prefs = h.read().prefs
    assert.equal(prefs.magazineMode, 'light')
    assert.deepEqual(prefs.grammar, { blurScale: 0.5 })
    assert.deepEqual(prefs.customWallpapers, { aglaea: { x: 33 }, cipher: { fit: 'fill', muted: false } })
    assert.equal(Object.hasOwn(prefs.customWallpapers ?? {}, 'mydei'), false, 'seat absent from the file is dropped')
    assert.equal(prefs.lastSeat, 'amphoreus-aglaea')
    assert.equal(prefs.wallpaperCursor, 7)
    assert.deepEqual(prefs.quickPhrases, ['继续', '停'])
    assert.equal(prefs.quickPhrasesInitialized, true)
    assert.equal(GlobalSchema.safeParse(h.read()).success, true, 'stored global still parses')

    // Minimal file clears all three visual keys (restore factory look) but nothing else.
    const cleared = await put({ version: 1 })
    assert.equal(cleared.status, 200)
    for (const key of ['magazineMode', 'grammar', 'customWallpapers']) assert.equal(Object.hasOwn(h.read().prefs, key), false, key)
    assert.equal(h.read().prefs.lastSeat, 'amphoreus-aglaea')
    assert.deepEqual(h.read().prefs.quickPhrases, ['继续', '停'])

    // Round trip: export → import yields identical stored visual prefs.
    h.write({ ...h.read(), prefs: structuredClone(SEEDED_PREFS) })
    const exported = await (await fetch(`${h.origin}${PATH}`)).json()
    h.write({ ...h.read(), prefs: { ...INITIAL_GLOBAL.prefs } })
    const roundTrip = await put(exported)
    assert.equal(roundTrip.status, 200)
    assert.equal(h.read().prefs.magazineMode, SEEDED_PREFS.magazineMode)
    assert.deepEqual(h.read().prefs.grammar, SEEDED_PREFS.grammar)
    assert.deepEqual(h.read().prefs.customWallpapers, SEEDED_PREFS.customWallpapers)

    // Validation failures leave the store untouched.
    const before = structuredClone(h.read())
    const cases: Array<[unknown, RegExp]> = [
      [{ version: 2 }, /version/u],
      [{}, /version/u],
      [{ version: 1, lastSeat: 'x' }, /lastSeat|Unrecognized/iu],
      [{ version: 1, grammar: { frostScale: 3 } }, /frostScale/u],
      [{ version: 1, grammar: { sparkle: true } }, /sparkle|Unrecognized/iu],
      [{ version: 1, grammar: null }, /grammar/u],
      [{ version: 1, customWallpapers: { aglaea: null } }, /aglaea/u],
      [{ version: 1, customWallpapers: { 'Bad Hero': { x: 1 } } }, /Bad Hero|regex|Invalid/iu],
      [{ version: 1, customWallpapers: { aglaea: { x: 101 } } }, /x/u],
      [{ version: 1, magazineMode: 'huge' }, /magazineMode/u],
      [[], /./u],
    ]
    for (const [body, pattern] of cases) {
      const response = await put(body)
      assert.equal(response.status, 400, JSON.stringify(body))
      const error = (await response.json() as { error: string }).error
      assert.match(error, pattern, JSON.stringify(body))
    }
    assert.deepEqual(h.read(), before)

    // Oversize body: 65 KiB → 413 from the shared readJson guard (limit 64 KiB).
    const big = await put(`{"version":1,"grammar":{"enabled":true},"pad":"${'x'.repeat(65 * 1024)}"}`)
    assert.equal(big.status, 413)
    assert.match((await big.json() as { error: string }).error, /exceeds 65536 bytes/u)

    // Write gate: nonce + JSON content-type are inherited from #authorize.
    const noNonce = await put({ version: 1 }, { 'content-type': 'application/json' })
    assert.equal(noNonce.status, 403)
    const wrongType = await put({ version: 1 }, { 'content-type': 'text/plain', 'x-amphoreus-nonce': NONCE })
    assert.equal(wrongType.status, 415)
    assert.deepEqual(h.read(), before)
  } finally {
    await h.close()
  }
})
