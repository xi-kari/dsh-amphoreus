import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWidgetPriceResolver } from '../src/host/widget-pricing.ts'

const now = Date.parse('2026-10-22T07:30:00Z')
test('official quotes retain verified tariff bounds, currency, source and date', () => {
  const price = createWidgetPriceResolver()({ provider: 'deepseek-account', model: 'deepseek-flash' }, now)!
  assert.deepEqual(price.low, { input: '1', cacheRead: '0.02', output: '4' })
  assert.deepEqual(price.high, { input: '2', cacheRead: '0.04', output: '8' })
  assert.equal(price.currency, 'CNY')
  assert.equal(price.asOf, '2026-10-22')
  assert.match(price.source, /^https:\/\/api-docs.deepseek.com\//u)
  assert.equal(price.low.cacheWrite, undefined)
  const usd = createWidgetPriceResolver([], 'USD')({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }, now)!
  assert.equal(usd.low.output, '1.98')
  assert.equal(usd.high.output, '3.96')
})

test('third-party routes, unknown model names and earlier events do not inherit Flash prices', () => {
  const resolve = createWidgetPriceResolver()
  assert.equal(resolve({ provider: 'custom', model: 'deepseek-flash' }, now), undefined)
  assert.equal(resolve({ provider: 'deepseek-account', model: 'unknown' }, now), undefined)
  assert.equal(resolve({ provider: 'deepseek-account', model: 'deepseek-flash' }, 0), undefined)
  assert.ok(resolve({ provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' }, now))
})

test('explicit user prices match the complete route and retain cache-write pricing', () => {
  const resolve = createWidgetPriceResolver([{ provider: 'custom', model: 'model', currency: 'USD', input: '2', cacheRead: '0.2', cacheWrite: '3', output: '10', asOf: '2026-10-22' }])
  const price = resolve({ provider: 'custom', model: 'model' }, now)!
  assert.equal(price.low.cacheWrite, '3')
  assert.deepEqual(price.low, price.high)
  assert.equal(price.source, 'user-configured')
  assert.equal(resolve({ provider: 'other', model: 'model' }, now), undefined)
})
