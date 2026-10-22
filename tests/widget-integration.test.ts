import assert from 'node:assert/strict'
import { test } from 'node:test'
import { once } from 'node:events'
import { createServer } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { widgetDomain, widgetProviderFacts } from '../src/host/widget.ts'
import { publicWidgetState } from '../src/host/webapi.ts'
import { AmphoreusWebApi } from '../src/host/webapi.ts'
import { WidgetAccountingService } from '../src/host/widget-accounting.ts'
import { INITIAL_GLOBAL, type AmphoreusStores } from '../src/host/store.ts'
import type { SuiteResolver } from '../src/host/bridge.ts'
import { fixtureConfig } from './fixture-suite.ts'
import { emptyWidgetUsageSummary } from '../src/host/widget-money.ts'
import type { WidgetAccountingSnapshot, WidgetTurnRecord } from '../src/host/widget-accounting-types.ts'

test('widget storage wraps its optional ledger without using the storage null sentinel', () => {
  assert.equal(widgetDomain.global.schema.safeParse(null).success, false)
  assert.deepEqual(widgetDomain.global.schema.parse({ ledger: null }), { ledger: null })
})

test('widget refresh is nonce-protected and display preferences merge, validate, and reset', async () => {
  let global = structuredClone(INITIAL_GLOBAL)
  const stores = {
    main: { global: { get: () => global, set: async (value: typeof global) => { global = value } }, table: () => ({ entries: () => new Map().entries() }) },
    canvas: { table: () => ({ entries: () => new Map().entries() }) }, close: async () => {},
  } as unknown as AmphoreusStores
  const widget = new WidgetAccountingService({ readBalance: async () => ({ status: 'unavailable', reason: 'not-configured' }),
    priceFor: () => undefined, load: async () => undefined, save: async () => {} })
  await widget.start()
  const nonce = 'widget-test-nonce'
  const api = new AmphoreusWebApi({} as Context, { config: fixtureConfig(), stores,
    resolver: { current: () => undefined } as unknown as SuiteResolver, nonce, widget })
  const server = createServer((request, response) => { void api.handle(request, response) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const headers = { 'content-type': 'application/json', 'x-amphoreus-nonce': nonce }
  try {
    assert.equal((await fetch(`${origin}/amphoreus/api/widget/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403)
    assert.equal((await fetch(`${origin}/amphoreus/api/widget/refresh`)).status, 405)
    const response = await fetch(`${origin}/amphoreus/api/widget/refresh`, { method: 'POST', headers, body: '{}' })
    assert.equal(response.status, 200)
    const snapshot = await response.json() as WidgetAccountingSnapshot
    assert.equal(snapshot.balance.status, 'unavailable')
    assert.equal(snapshot.balance.reason, 'not-configured')
    const put = (body: unknown) => fetch(`${origin}/amphoreus/api/prefs`, { method: 'PUT', headers, body: JSON.stringify(body) })
    assert.equal((await put({ widget: { allowTopDock: true } })).status, 200)
    assert.equal((await put({ widget: { autoHideSeconds: 0 }, backgroundMode: 'none' })).status, 200)
    assert.deepEqual(api.state().effectiveConfig.widget, { enabled: true, allowTopDock: true, showTurnBubble: true, autoHideSeconds: 0 })
    assert.equal((await put({ widget: { autoHideSeconds: -1 } })).status, 400)
    assert.equal((await put({ widget: { secretKey: 'not-a-valid-preference' } })).status, 400)
    assert.equal((await put({ widget: null })).status, 200)
    assert.equal(api.state().effectiveConfig.widget.allowTopDock, false)
    assert.equal(api.state().effectiveConfig.wallpaper.mode, 'none')
  } finally {
    await widget.dispose()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('provider configuration is read redacted and a custom endpoint never receives official pricing or balance keys', () => {
  let redacted = false
  const services = {
    llm: { listConfigurableProviders: () => [{ provider: 'deepseek-official', settingsNs: 'official-entry' }] },
    settings: { describe: (options: { redactSecrets: boolean }) => {
      redacted = options.redactSecrets
      return [{ ns: 'official-entry', value: { baseURL: 'https://private.example/v1', apiKeyEnv: 'CUSTOM_DEEPSEEK_KEY' } }]
    } },
  }
  const ctx = { get: (name: keyof typeof services) => services[name] } as unknown as Context
  assert.deepEqual(widgetProviderFacts(ctx, 'deepseek-official'), { official: false, keyRef: 'CUSTOM_DEEPSEEK_KEY' })
  assert.equal(redacted, true)
})

test('browser accounting projection keeps summaries bounded and removes per-request details', () => {
  const summary = emptyWidgetUsageSummary()
  const turn: WidgetTurnRecord = { ...summary, id: 'turn', sessionId: 'session', turn: 1, startedAt: 1, endedAt: 2, outcome: 'completed', observedFromStart: true,
    records: [{ seq: 2, at: 2, route: { provider: 'custom', model: 'custom' }, kind: 'message', usage: null, estimate: null, unavailableReason: null,
      price: { id: 'price', source: 'user-configured', asOf: '2026-10-20', currency: 'USD', low: { input: '1', cacheRead: '1', output: '1' }, high: { input: '1', cacheRead: '1', output: '1' } } }] }
  const input: WidgetAccountingSnapshot = {
    revision: 1, observingSince: 0, timeZone: 'America/New_York', refreshMs: 60000,
    balance: { status: 'unavailable', source: null, reason: 'not-configured', updatedAt: null, wallets: [], identityKnown: false },
    observedToday: [], usageToday: { ...summary, day: '2026-10-22' },
    usageDays: Array.from({ length: 10 }, (_, index) => ({ ...summary, day: `2026-10-${String(index + 1).padStart(2, '0')}` })),
    turns: Array.from({ length: 70 }, (_, index) => ({ ...turn, id: `turn-${index}`, endedAt: index + 2 })), activeTurns: [], storageStatus: 'ready',
  }
  const output = publicWidgetState(input)
  assert.equal(output.turns.length, 50)
  assert.equal(output.turns[0]?.id, 'turn-69')
  assert.equal(output.usageDays.length, 7)
  assert.equal(Object.hasOwn(output.turns[0]!, 'records'), false)
  assert.deepEqual(output.turns[0]!.routes, [{ provider: 'custom', model: 'custom' }])
  assert.deepEqual(output.priceReferences, [{ source: 'user-configured', asOf: '2026-10-20' }])
  assert.equal(input.turns.length, 70)
})
