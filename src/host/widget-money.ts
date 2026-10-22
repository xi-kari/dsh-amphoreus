import Big from 'big.js'
import type { WidgetMoneyRange, WidgetPriceQuote, WidgetTokenPrices, WidgetTokenUsage, WidgetUsageRecord, WidgetUsageSummary } from './widget-accounting-types.ts'

export function decimalMoney(value: string): string {
  if (value.length > 256) throw new Error('Invalid decimal amount')
  const amount = new Big(value)
  if (Math.abs(amount.e) > 100 || amount.c.length > 100) throw new Error('Decimal amount out of range')
  return amount.toFixed()
}

export function sumMoney(left: string, right: string): string {
  return decimalMoney(new Big(decimalMoney(left)).plus(decimalMoney(right)).toString())
}

export function moneyDifference(left: string, right: string): string {
  return decimalMoney(new Big(decimalMoney(left)).minus(decimalMoney(right)).toString())
}

export function positiveMoney(value: string): string {
  const normalized = decimalMoney(value)
  return new Big(normalized).gt(0) ? normalized : '0'
}

export const emptyWidgetUsage = (): WidgetTokenUsage => ({ inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0 })

export function checkedWidgetUsage(value: unknown): WidgetTokenUsage | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const usage = {
    inputTokens: raw.inputTokens, outputTokens: raw.outputTokens,
    cacheReadTokens: raw.cacheReadTokens ?? 0, cacheWriteTokens: raw.cacheWriteTokens ?? 0,
    reasoningTokens: raw.reasoningTokens ?? 0,
  }
  if (Object.values(usage).some(count => typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)) return null
  const result = usage as WidgetTokenUsage
  if (result.reasoningTokens > result.outputTokens) return null
  return result
}

function pricedTokens(usage: WidgetTokenUsage, prices: WidgetTokenPrices): string {
  const rows = [
    [usage.inputTokens, prices.input], [usage.cacheReadTokens, prices.cacheRead],
    [usage.cacheWriteTokens, prices.cacheWrite ?? '0'], [usage.outputTokens, prices.output],
  ] as const
  let total = new Big(0)
  for (const [tokens, rawRate] of rows) {
    const rate = new Big(decimalMoney(rawRate))
    if (rate.lt(0)) throw new Error('Negative token price')
    total = total.plus(rate.times(tokens))
  }
  return decimalMoney(total.times('0.000001').toString())
}

export function estimateWidgetUsage(usage: WidgetTokenUsage, quote: WidgetPriceQuote): WidgetMoneyRange | null {
  if (usage.cacheWriteTokens > 0 && (quote.low.cacheWrite === undefined || quote.high.cacheWrite === undefined)) return null
  const low = pricedTokens(usage, quote.low)
  const high = pricedTokens(usage, quote.high)
  if (new Big(low).gt(high)) throw new Error('Inverted token price range')
  return { currency: quote.currency, low, high }
}

export function mergeWidgetUsage(previous: WidgetUsageSummary, record: WidgetUsageRecord): WidgetUsageSummary {
  const usage = { ...previous.usage }
  if (record.usage !== null) {
    for (const key of Object.keys(usage) as (keyof WidgetTokenUsage)[]) {
      usage[key] += record.usage[key]
      if (!Number.isSafeInteger(usage[key])) throw new Error('Usage total out of range')
    }
  }
  const estimates = new Map(previous.estimates.map(estimate => [estimate.currency, { ...estimate }]))
  if (record.estimate !== null) {
    const estimate = record.estimate
    const current = estimates.get(estimate.currency)
    estimates.set(estimate.currency, current === undefined ? { ...estimate } : {
      currency: estimate.currency, low: sumMoney(current.low, estimate.low), high: sumMoney(current.high, estimate.high),
    })
  }
  const reports = previous.reports + (record.usage === null ? 0 : 1)
  const missingUsageReports = previous.missingUsageReports + (record.usage === null ? 1 : 0)
  const unpricedReports = previous.unpricedReports + (record.usage !== null && record.estimate === null ? 1 : 0)
  return {
    usage, reports, missingUsageReports, unpricedReports, estimates: [...estimates.values()],
    pricing: estimates.size > 0 ? missingUsageReports + unpricedReports > 0 ? 'partial' : 'estimated' : reports + missingUsageReports > 0 ? 'unavailable' : 'no-usage',
  }
}

export function emptyWidgetUsageSummary(): WidgetUsageSummary {
  return { usage: emptyWidgetUsage(), reports: 0, missingUsageReports: 0, unpricedReports: 0, estimates: [], pricing: 'no-usage' }
}
