import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { WidgetAccountingService } from '../src/host/widget-accounting.ts'
import type { WidgetAccountingLedger, WidgetBalanceRead, WidgetPriceQuote, WidgetTokenUsage } from '../src/host/widget-accounting-types.ts'

const services: WidgetAccountingService[] = []
afterEach(async () => { for (const service of services.splice(0)) await service.dispose() })
const base = Date.UTC(2026, 9, 22, 4)
const quote: WidgetPriceQuote = {
  id: 'fixture-price', currency: 'CNY', source: 'fixture-only', asOf: '2026-10-22',
  low: { input: '2', cacheRead: '0.2', cacheWrite: '3', output: '4' },
  high: { input: '4', cacheRead: '0.4', cacheWrite: '6', output: '8' },
}
const usage: WidgetTokenUsage = { inputTokens: 100, cacheReadTokens: 50, cacheWriteTokens: 10, outputTokens: 20, reasoningTokens: 5 }
const event = (type: string, seq: number, data: unknown, time = base): SessionEvent => ({ type, seq, time, data }) as SessionEvent
const assistant = (seq: number, turn = 1, value: unknown = usage, time = base) => event('assistant/message', seq, {
  turn, step: seq, usage: value, stream: [],
  message: { source: { kind: 'model', provider: 'fixture-provider', model: 'fixture-model' }, content: [{ type: 'text', text: 'PRIVATE_BODY_MUST_NOT_BE_SAVED' }] },
}, time)
const balance = (total: string, scopeKey = 'test-scope', currency = 'CNY'): WidgetBalanceRead => ({
  status: 'ready', source: 'api-key', scopeKey, wallets: [{ currency, total, recharge: total, bonus: null }],
})

function fixture(options: { stored?: unknown; readBalance?: (signal: AbortSignal) => Promise<WidgetBalanceRead>; priceFor?: (at: number) => WidgetPriceQuote | undefined; maxTurns?: number } = {}) {
  let clock = base
  let stored = options.stored
  let failing = false
  let saveGate: Promise<void> | undefined
  let reads = 0
  let saves = 0
  let currentBalance: WidgetBalanceRead = { status: 'unavailable', reason: 'not-configured' }
  const service = new WidgetAccountingService({
    now: () => clock,
    readBalance: signal => { reads++; return options.readBalance?.(signal) ?? Promise.resolve(currentBalance) },
    priceFor: (_route, at) => options.priceFor === undefined ? quote : options.priceFor(at),
    load: async () => stored,
    save: async ledger => { await saveGate; if (failing) throw new Error('storage unavailable'); stored = structuredClone(ledger); saves++ },
    ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
  })
  services.push(service)
  return {
    service, setTime: (time: number) => { clock = time }, setBalance: (value: WidgetBalanceRead) => { currentBalance = value },
    failSave: (value: boolean) => { failing = value }, stored: () => stored as WidgetAccountingLedger,
    blockSaves: (gate: Promise<void>) => { saveGate = gate },
    reads: () => reads, saves: () => saves,
    ready: async () => { await service.start(); await service.refresh() },
  }
}

test('usage includes disjoint cache writes and does not bill reasoning twice; records contain no message body', async () => {
  const f = fixture()
  await f.ready()
  await f.service.accept('session-one', event('turn/start', 0, { turn: 1 }))
  await f.service.accept('session-one', assistant(1))
  await f.service.accept('session-one', event('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }))
  const row = f.service.snapshot().turns[0]!
  assert.deepEqual(row.usage, usage)
  assert.deepEqual(row.estimates, [{ currency: 'CNY', low: '0.00032', high: '0.00064' }])
  assert.equal(row.pricing, 'estimated')
  assert.equal(row.records[0]?.price?.id, quote.id)
  assert.equal(JSON.stringify(f.stored()).includes('PRIVATE_BODY_MUST_NOT_BE_SAVED'), false)
})

test('settled failed attempts count their last usage chunk once and share the recorded route', async () => {
  const f = fixture()
  await f.ready()
  await f.service.accept('session-one', event('request/context', 0, { provider: 'fixture-provider', model: 'fixture-model' }))
  await f.service.accept('session-one', event('assistant/attempt', 1, { turn: 1, step: 1, stream: [
    { type: 'chunk', time: base, chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } } },
    { type: 'chunk', time: base, chunk: { type: 'usage', usage: { inputTokens: 2, outputTokens: 3 } } },
  ] }))
  await f.service.accept('session-one', assistant(2, 1, { inputTokens: 5, outputTokens: 7 }))
  await f.service.accept('session-one', event('turn/end', 3, { turn: 1, reason: { kind: 'error', error: { message: 'not saved' } } }))
  const row = f.service.snapshot().turns[0]!
  assert.equal(row.reports, 2)
  assert.equal(row.usage.inputTokens, 7)
  assert.equal(row.usage.outputTokens, 10)
  assert.equal(row.records[0]?.kind, 'attempt')
  assert.equal(row.outcome, 'error')
  assert.equal(row.observedFromStart, false)
})

test('unknown prices, missing usage, and unknown cache-write prices remain unavailable', async () => {
  for (const mode of ['price', 'usage', 'cache-write'] as const) {
    const f = fixture({ priceFor: () => mode === 'price' ? undefined : mode === 'cache-write'
      ? { ...quote, low: { input: '2', cacheRead: '.2', output: '4' }, high: { input: '4', cacheRead: '.4', output: '8' } } : quote })
    await f.ready()
    await f.service.accept('one', assistant(0, 1, mode === 'usage' ? { inputTokens: -1, outputTokens: 3 } : usage))
    const row = f.service.snapshot().activeTurns[0]!
    assert.equal(row.pricing, 'unavailable', mode)
    assert.deepEqual(row.estimates, [], mode)
    assert.equal(row.records[0]?.unavailableReason, mode === 'price' ? 'price-unavailable' : mode === 'usage' ? 'usage-missing' : 'cache-write-price-unavailable')
  }
})

test('zero-priced usage is recorded and duplicate events remain deduplicated across restart', async () => {
  const zero = { ...quote, low: { input: '0', cacheRead: '0', cacheWrite: '0', output: '0' }, high: { input: '0', cacheRead: '0', cacheWrite: '0', output: '0' } }
  const f = fixture({ priceFor: () => zero })
  await f.ready()
  await Promise.all([f.service.accept('one', assistant(1)), f.service.accept('one', assistant(1))])
  await f.service.accept('one', event('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }))
  assert.equal(f.service.snapshot().turns[0]?.reports, 1)
  assert.deepEqual(f.service.snapshot().turns[0]?.estimates, [{ currency: 'CNY', low: '0', high: '0' }])
  const restored = fixture({ stored: f.stored() })
  await restored.ready()
  await restored.service.accept('one', assistant(1))
  assert.equal(restored.service.snapshot().turns.length, 1)
  assert.equal(restored.service.snapshot().usageToday.reports, 1)
})

test('parallel sessions and midnight usage keep separate turns and event-date daily totals', async () => {
  const times: number[] = []
  const f = fixture({ priceFor: at => { times.push(at); return quote }, maxTurns: 2 })
  await f.ready()
  const beforeMidnight = Date.UTC(2026, 9, 22, 15, 59, 59)
  const afterMidnight = beforeMidnight + 2_000
  await f.service.accept('one', assistant(1, 1, usage, beforeMidnight))
  await f.service.accept('one', assistant(2, 1, usage, afterMidnight))
  await f.service.accept('two', assistant(1, 1, usage, afterMidnight))
  await f.service.accept('one', event('turn/end', 3, { turn: 1, reason: { kind: 'completed' } }, afterMidnight))
  await f.service.accept('two', event('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }, afterMidnight))
  f.setTime(afterMidnight)
  const snapshot = f.service.snapshot()
  assert.equal(snapshot.turns.length, 2)
  assert.equal(snapshot.usageToday.reports, 2)
  assert.equal(snapshot.usageDays.find(day => day.day === '2026-10-22')?.reports, 1)
  assert.deepEqual(times, [beforeMidnight, afterMidnight, afterMidnight])
})

test('observed decreases and increases never cancel each other or claim unobserved transactions', async () => {
  const f = fixture()
  f.setBalance(balance('100'))
  await f.ready()
  for (const [index, amount] of ['97', '147', '145'].entries()) {
    f.setTime(base + index + 1)
    f.setBalance(balance(amount))
    await f.service.refresh()
  }
  const row = f.service.snapshot().observedToday[0]!
  assert.equal(row.observedDecrease, '5')
  assert.equal(row.observedIncrease, '50')
  assert.equal(row.openingBalance, '100')
  assert.equal(row.currentBalance, '145')
  assert.equal(row.samples, 4)
  assert.equal(JSON.stringify(f.service.snapshot()).includes('test-scope'), false)
})

test('exact fractional balances, identity changes, currencies, clock rollback and midnight remain separate', async () => {
  const f = fixture()
  f.setBalance(balance('100.0000000000000001'))
  await f.ready()
  f.setTime(base + 1)
  f.setBalance(balance('100'))
  await f.service.refresh()
  assert.equal(f.service.snapshot().observedToday[0]?.observedDecrease, '0.0000000000000001')
  f.setTime(base)
  f.setBalance(balance('90'))
  await f.service.refresh()
  assert.equal(f.service.snapshot().observedToday[0]?.samples, 2)
  f.setTime(base + 2)
  f.setBalance(balance('7', 'another-account', 'USD'))
  await f.service.refresh()
  assert.equal(f.service.snapshot().observedToday[0]?.observedDecrease, '0')
  assert.equal(f.service.snapshot().observedToday[0]?.currency, 'USD')
  f.setTime(Date.UTC(2026, 9, 23, 4))
  f.setBalance(balance('6', 'another-account', 'USD'))
  await f.service.refresh()
  assert.equal(f.service.snapshot().observedToday[0]?.observedDecrease, '0')
  assert.equal(f.service.snapshot().observedToday[0]?.crossDayGap, true)
})

test('failed persistence does not advance usage or deduplication and a retry commits once', async () => {
  const f = fixture()
  await f.ready()
  f.failSave(true)
  await assert.rejects(f.service.accept('one', assistant(1)), /storage unavailable/u)
  assert.equal(f.service.snapshot().activeTurns.length, 0)
  assert.equal(f.service.snapshot().storageStatus, 'failed')
  f.failSave(false)
  await f.service.accept('one', assistant(1))
  assert.equal(f.service.snapshot().activeTurns[0]?.reports, 1)
  assert.equal(f.service.snapshot().storageStatus, 'ready')
})

test('a balance persistence failure leaves refreshing state and retains the prior committed observation', async () => {
  const f = fixture()
  f.setBalance(balance('100'))
  await f.ready()
  f.failSave(true)
  f.setTime(base + 1)
  f.setBalance(balance('90'))
  await f.service.refresh()
  assert.equal(f.service.snapshot().balance.status, 'failed')
  assert.equal(f.service.snapshot().storageStatus, 'failed')
  assert.equal(f.service.snapshot().observedToday[0]?.currentBalance, '100')
  f.failSave(false)
})

test('later events recover a failed usage write before advancing the persisted watermark', async () => {
  const f = fixture()
  await f.ready()
  f.failSave(true)
  await assert.rejects(f.service.accept('one', assistant(1)))
  f.failSave(false)
  await f.service.accept('one', event('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }))
  await f.service.accept('one', assistant(1))
  assert.equal(f.service.snapshot().turns[0]?.reports, 1)
  assert.equal(f.service.snapshot().usageToday.reports, 1)
  assert.equal(f.stored().watermarks.one, 2)
})

test('disposal drains accepted queued events before storage can be closed', async () => {
  const f = fixture()
  await f.ready()
  let release!: () => void
  f.blockSaves(new Promise(resolve => { release = resolve }))
  const first = f.service.accept('one', event('turn/start', 0, { turn: 1 }))
  const middle = f.service.accept('one', assistant(1))
  const last = f.service.accept('one', event('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }))
  await new Promise(resolve => setImmediate(resolve))
  const closing = f.service.dispose()
  release()
  await Promise.all([first, middle, last, closing])
  assert.equal(f.stored().turns[0]?.reports, 1)
  assert.equal(f.stored().watermarks.one, 2)
})

test('the default polling interval is 60 seconds and disposal cancels further polls', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] })
  const f = fixture()
  await f.ready()
  assert.equal(f.service.snapshot().refreshMs, 60_000)
  assert.equal(f.reads(), 1)
  context.mock.timers.tick(59_999)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.reads(), 1)
  context.mock.timers.tick(1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.reads(), 2)
  await f.service.dispose()
  context.mock.timers.tick(120_000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.reads(), 2)
})

test('malformed persisted ledgers fail closed without querying balances or overwriting storage', async () => {
  const f = fixture({ stored: { version: 99 } })
  await assert.rejects(f.service.start())
  assert.equal(f.reads(), 0)
  assert.equal(f.saves(), 0)
})

test('persisted decimal exponents outside the arithmetic range fail at load', async () => {
  const f = fixture()
  f.setBalance(balance('1'))
  await f.ready()
  const stored = structuredClone(f.stored())
  const damaged = { ...stored, balanceDays: stored.balanceDays.map(row => ({ ...row, currentBalance: '1e999999' })) }
  const restored = fixture({ stored: damaged })
  await assert.rejects(restored.service.start())
  assert.equal(restored.reads(), 0)
  assert.equal(restored.saves(), 0)
})

test('manual refreshes share one query and identity invalidation discards its late response', async () => {
  let finish!: (value: WidgetBalanceRead) => void
  let query = 0
  const f = fixture({ readBalance: async () => {
    query++
    if (query === 1) return await new Promise(resolve => { finish = resolve })
    return balance('7', 'new-account')
  } })
  await f.service.start()
  const first = f.service.refresh()
  assert.equal(f.service.refresh(), first)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(query, 1)
  f.service.invalidateBalance()
  await f.service.refresh()
  finish(balance('999', 'old-account'))
  await first
  assert.equal(f.service.snapshot().balance.wallets[0]?.total, '7')
  assert.equal(f.service.snapshot().observedToday[0]?.openingBalance, '7')
})

test('disposal aborts an outstanding refresh and ignores its later result', async () => {
  let complete!: (value: WidgetBalanceRead) => void
  const f = fixture({ readBalance: async () => await new Promise(resolve => { complete = resolve }) })
  await f.service.start()
  const refresh = f.service.refresh()
  await new Promise(resolve => setImmediate(resolve))
  let notified = 0
  f.service.onChange(() => { notified++ })
  await f.service.dispose()
  const stopped = f.service.snapshot()
  complete(balance('999'))
  await refresh
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(f.service.snapshot(), stopped)
  assert.equal(notified, 0)
  assert.equal(f.saves(), 0)
})
