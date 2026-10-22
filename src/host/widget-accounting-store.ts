import { z } from 'zod'
import type { WidgetAccountingLedger } from './widget-accounting-types.ts'
import { decimalMoney } from './widget-money.ts'

const time = z.number().finite().nonnegative()
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const decimal = z.string().max(256).regex(/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu).refine(value => {
  try { decimalMoney(value); return true } catch { return false }
}, 'Decimal amount out of range')
const route = z.object({ provider: z.string(), model: z.string() })
const tokens = z.object({ inputTokens: count, cacheReadTokens: count, cacheWriteTokens: count, outputTokens: count, reasoningTokens: count })
const rates = z.object({ input: decimal, cacheRead: decimal, cacheWrite: decimal.optional(), output: decimal })
const quote = z.object({ id: z.string(), currency: z.string(), source: z.string(), asOf: z.string(), low: rates, high: rates })
const moneyRange = z.object({ currency: z.string(), low: decimal, high: decimal })
const summary = {
  usage: tokens,
  reports: count,
  missingUsageReports: count,
  unpricedReports: count,
  estimates: z.array(moneyRange),
  pricing: z.enum(['estimated', 'partial', 'unavailable', 'no-usage']),
}
const record = z.object({
  seq: count, at: time, route: route.nullable(), kind: z.enum(['message', 'attempt']),
  usage: tokens.nullable(), price: quote.nullable(), estimate: moneyRange.nullable(),
  unavailableReason: z.enum(['usage-missing', 'route-missing', 'price-unavailable', 'price-invalid', 'cache-write-price-unavailable']).nullable(),
})
const turn = z.object({
  ...summary, id: z.string(), sessionId: z.string(), turn: count,
  startedAt: time, endedAt: time.nullable(), outcome: z.string().nullable(),
  observedFromStart: z.boolean(), records: z.array(record),
})

export const widgetAccountingLedgerSchema: z.ZodType<WidgetAccountingLedger> = z.object({
  version: z.literal(1), observingSince: time,
  balanceDays: z.array(z.object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), scopeKey: z.string(), source: z.enum(['api-key', 'account']), currency: z.string(),
    firstObservedAt: time, lastObservedAt: time,
    openingBalance: decimal, currentBalance: decimal, observedDecrease: decimal, observedIncrease: decimal,
    samples: count, crossDayGap: z.boolean(),
  })),
  usageDays: z.array(z.object({ ...summary, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u) })),
  turns: z.array(turn), activeTurns: z.array(turn),
  watermarks: z.record(z.string(), count), routes: z.record(z.string(), route),
}).strict()

export function emptyWidgetAccountingLedger(now: number): WidgetAccountingLedger {
  return { version: 1, observingSince: now, balanceDays: [], usageDays: [], turns: [], activeTurns: [], watermarks: {}, routes: {} }
}
