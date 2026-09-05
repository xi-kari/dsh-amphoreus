import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { SuiteResolver } from '../src/host/bridge.ts'
import { GlobalSchema, INITIAL_GLOBAL, type AmphoreusStores } from '../src/host/store.ts'
import { AmphoreusWebApi } from '../src/host/webapi.ts'
import { GRAMMAR_DEFAULTS, GRAMMAR_LIMITS } from '../src/shared/api.ts'
import { fixtureConfig } from './fixture-suite.ts'

const NONCE = 'grammar-prefs-nonce'

test('grammar prefs are optional in the stored global and default-merged in state', () => {
  assert.equal(GlobalSchema.safeParse(INITIAL_GLOBAL).success, true)
  assert.equal(GlobalSchema.safeParse({ ...INITIAL_GLOBAL, prefs: { ...INITIAL_GLOBAL.prefs, grammar: { blurScale: 1.5 } } }).success, true)
  assert.equal(GlobalSchema.safeParse({ ...INITIAL_GLOBAL, prefs: { ...INITIAL_GLOBAL.prefs, grammar: { blurScale: 9 } } }).success, false)
  for (const [key, limit] of Object.entries(GRAMMAR_LIMITS)) {
    const value = GRAMMAR_DEFAULTS[key as keyof typeof GRAMMAR_LIMITS]
    assert.ok(value >= limit.min && value <= limit.max, key)
  }
})

test('PUT /amphoreus/api/prefs patches, merges, rejects unknown knobs, and resets grammar', async () => {
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
  const put = (body: unknown) => fetch(`http://127.0.0.1:${address.port}/amphoreus/api/prefs`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': NONCE },
    body: JSON.stringify(body),
  })
  try {
    assert.deepEqual(api.state().effectiveConfig.grammar, GRAMMAR_DEFAULTS)

    const first = await put({ grammar: { blurScale: 1.4, mascot: 'static' } })
    assert.equal(first.status, 200)
    assert.deepEqual(api.state().effectiveConfig.grammar, { ...GRAMMAR_DEFAULTS, blurScale: 1.4, mascot: 'static' })

    const second = await put({ grammar: { ambient: false } })
    assert.equal(second.status, 200)
    assert.deepEqual(api.state().effectiveConfig.grammar, { ...GRAMMAR_DEFAULTS, blurScale: 1.4, mascot: 'static', ambient: false })
    assert.deepEqual(global.prefs.grammar, { blurScale: 1.4, mascot: 'static', ambient: false })

    const unrelated = await put({ magazineMode: 'full' })
    assert.equal(unrelated.status, 200)
    assert.deepEqual(global.prefs.grammar, { blurScale: 1.4, mascot: 'static', ambient: false }, 'other prefs writes keep grammar')

    const outOfRange = await put({ grammar: { frostScale: 3 } })
    assert.equal(outOfRange.status, 400)
    const unknown = await put({ grammar: { sparkle: true } })
    assert.equal(unknown.status, 400)

    const reset = await put({ grammar: null })
    assert.equal(reset.status, 200)
    assert.equal(Object.hasOwn(global.prefs, 'grammar'), false)
    assert.deepEqual(api.state().effectiveConfig.grammar, GRAMMAR_DEFAULTS)
  } finally {
    server.close()
    await once(server, 'close')
  }
})
