import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WidgetPublicState, WidgetPublicTurn } from '../src/shared/api.ts'
import { formatMascotData, formatWidgetMoney, formatWidgetRange, selectMascotTurn } from '../src/client/mascot-format.ts'
import { zh } from '../src/client/locales.ts'

const t = (key: keyof typeof zh, params: Record<string, unknown> = {}) => Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), zh[key])
const usage = { inputTokens: 1000, cacheReadTokens: 200, cacheWriteTokens: 0, outputTokens: 100, reasoningTokens: 20 }
const summary = { usage, reports: 1, missingUsageReports: 0, unpricedReports: 0, estimates: [{ currency: 'CNY', low: '.00012345', high: '.00067891' }], pricing: 'estimated' as const }
const turn = (id: string, sessionId: string, time: number, endedAt: number | null = time): WidgetPublicTurn => ({ ...summary, id, sessionId, turn: time, startedAt: time, endedAt, outcome: endedAt === null ? null : 'completed', observedFromStart: true })
const fixture = (): WidgetPublicState => ({
  revision: 1, observingSince: 1000, timeZone: 'Asia/Shanghai', refreshMs: 60000, storageStatus: 'ready',
  balance: { status: 'ready', source: 'api-key', reason: null, identityKnown: true, updatedAt: 2000,
    wallets: [{ currency: 'CNY', total: '12.345678901', recharge: '10', bonus: '2.345678901' }, { currency: 'USD', total: '1.25', recharge: null, bonus: null }] },
  observedToday: [{ day: '2026-10-22', source: 'api-key', currency: 'CNY', firstObservedAt: 1000, lastObservedAt: 2000,
    openingBalance: '12', currentBalance: '12.345678901', observedDecrease: '0.123', observedIncrease: '.468678901', samples: 2, crossDayGap: false }],
  usageToday: { ...summary, day: '2026-10-22' }, usageDays: [], turns: [turn('a', 'anaxa', 10), turn('b', 'other-anaxa', 20), turn('c', 'cyrene', 30)], activeTurns: [],
})
const bindings = [{ sessionId: 'anaxa', skillName: 'amphoreus-anaxa' }, { sessionId: 'other-anaxa', skillName: 'amphoreus-anaxa' }, { sessionId: 'cyrene', skillName: 'amphoreus-cyrene' }]

test('money retains eight decimal places, marks subprecision values and never turns invalid input into zero', () => {
  assert.equal(formatWidgetMoney('0.000000001', 'CNY'), 'CNY <0.00000001')
  assert.equal(formatWidgetMoney('12345678901234567890.123456789', 'CNY'), 'CNY 12345678901234567890.12345679')
  assert.equal(formatWidgetMoney('0', 'USD'), 'USD 0')
  assert.equal(formatWidgetMoney('not-a-number', 'USD'), '—')
  assert.equal(formatWidgetRange({ currency: 'USD', low: '.0001', high: '.0002' }), 'USD 0.0001–0.0002')
})

test('the balance currencies and observed changes remain separate from local token cost estimates', () => {
  const data = formatMascotData(fixture(), { skillName: 'amphoreus-anaxa', currentSessionId: 'anaxa', bindings, t })
  assert.equal(data.balance?.text, 'CNY 12.3456789 · USD 1.25')
  assert.match(data.observed?.text ?? '', /下降 CNY 0\.123/u)
  assert.match(data.observed?.text ?? '', /增加 CNY 0\.4686789/u)
  assert.match(data.observed?.detail ?? '', /不等于本机/u)
  assert.match(data.usage?.text ?? '', /估算/u)
  assert.match(data.usage?.detail ?? '', /1,000/u)
  assert.match(data.usage?.detail ?? '', /按记录时的报价/u)
  assert.doesNotMatch(data.usage?.detail ?? '', /报价基准 2026-10-22/u)
  assert.deepEqual(data.history?.map(item => item.id), ['b', 'a'])
})

test('current conversation wins over a newer role turn; unrelated roles never appear', () => {
  const state = fixture()
  assert.equal(selectMascotTurn(state, 'amphoreus-anaxa', 'anaxa', bindings)?.id, 'a')
  assert.equal(selectMascotTurn(state, 'amphoreus-anaxa', 'empty-anaxa', bindings)?.id, 'b')
  assert.equal(selectMascotTurn(state, 'unknown', undefined, bindings), undefined)
  state.activeTurns = [turn('running', 'anaxa', 40, null)]
  const data = formatMascotData(state, { skillName: 'amphoreus-anaxa', currentSessionId: 'anaxa', bindings, t })
  assert.equal(data.turn?.id, 'running')
  assert.equal(data.turn?.status, 'pending')
  assert.match(data.turn?.detail ?? '', /尚未观测到结束/u)
})

test('cached balances disclose failure, unpriced usage remains unknown, and gaps stay explicit', () => {
  const state = fixture()
  state.balance = { ...state.balance, status: 'failed', reason: 'network' }
  state.usageToday = { ...state.usageToday, estimates: [], pricing: 'unavailable', unpricedReports: 1 }
  state.observedToday = [{ ...state.observedToday[0]!, crossDayGap: true }]
  const data = formatMascotData(state, { skillName: 'amphoreus-anaxa', currentSessionId: 'anaxa', bindings, t })
  assert.match(data.balance?.detail ?? '', /缓存/u)
  assert.match(data.balance?.detail ?? '', /网络/u)
  assert.match(data.usage?.text ?? '', /无法估算/u)
  assert.match(data.observed?.detail ?? '', /跨日/u)
  assert.doesNotMatch(data.usage?.text ?? '', /CNY 0/u)
})

test('empty observations and absent token reports are unknown rather than measured zero', () => {
  const state = fixture()
  state.balance = { ...state.balance, status: 'unavailable', reason: 'not-configured', wallets: [], updatedAt: null }
  state.observedToday = []
  state.usageToday = { ...state.usageToday, reports: 0, missingUsageReports: 1, pricing: 'no-usage', estimates: [] }
  const data = formatMascotData(state, { skillName: 'amphoreus-anaxa', currentSessionId: 'anaxa', bindings, t })
  assert.equal(data.balance?.text, '—')
  assert.match(data.balance?.detail ?? '', /未配置/u)
  assert.match(data.observed?.text ?? '', /尚无观测/u)
  assert.match(data.usage?.text ?? '', /暂无用量/u)
  assert.doesNotMatch(data.usage?.detail ?? '', /输入 0/u)
})

test('quote references disclose actual custom dates without stamping every turn with the built-in quote date', () => {
  const state = { ...fixture(), priceReferences: [{ source: 'user-configured', asOf: '2026-11-03' }, { source: 'https://example.test/prices', asOf: '2026-10-10' }] }
  const data = formatMascotData(state, { skillName: 'amphoreus-anaxa', currentSessionId: 'anaxa', bindings, t })
  assert.match(data.usage?.detail ?? '', /自定义报价 2026-11-03/u)
  assert.match(data.usage?.detail ?? '', /2026-10-10/u)
  assert.doesNotMatch(data.turn?.detail ?? '', /2026-10-22/u)
  assert.match(data.turn?.detail ?? '', /按记录时的报价/u)
})

test('display dates follow the host user time zone across the UTC day boundary', () => {
  const at = Date.parse('2026-10-22T02:15:00Z')
  const state = { ...fixture(), timeZone: 'America/New_York', balance: { ...fixture().balance, updatedAt: at },
    usageToday: { ...fixture().usageToday, day: '2026-10-21' } }
  const data = formatMascotData(state, { skillName: 'amphoreus-anaxa', currentSessionId: 'anaxa', bindings, t })
  const expected = new Intl.DateTimeFormat(undefined, { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(at)
  assert.ok(data.balance?.detail?.includes(expected))
  assert.ok(data.usage?.detail?.includes('2026-10-21（America/New_York）'))
  assert.doesNotMatch(data.usage?.detail ?? '', /北京时间/u)
})
