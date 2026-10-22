import type { SessionEvent } from '@deepseek-ai/dsh-session'

export interface WidgetUsageRoute { readonly provider: string; readonly model: string }

export interface WidgetTokenUsage {
  readonly inputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
}

export interface WidgetTokenPrices {
  readonly input: string
  readonly cacheRead: string
  readonly cacheWrite?: string | undefined
  readonly output: string
}

/** Decimal prices per million tokens for one exact provider and model. */
export interface WidgetPriceQuote {
  readonly id: string
  readonly currency: string
  readonly source: string
  readonly asOf: string
  readonly low: WidgetTokenPrices
  readonly high: WidgetTokenPrices
}

export type WidgetPriceResolver = (route: WidgetUsageRoute, eventTime: number) => WidgetPriceQuote | undefined

export interface WidgetMoneyRange { readonly currency: string; readonly low: string; readonly high: string }

export interface WidgetUsageRecord {
  readonly seq: number
  readonly at: number
  readonly route: WidgetUsageRoute | null
  readonly kind: 'message' | 'attempt'
  readonly usage: WidgetTokenUsage | null
  readonly price: WidgetPriceQuote | null
  readonly estimate: WidgetMoneyRange | null
  readonly unavailableReason: 'usage-missing' | 'route-missing' | 'price-unavailable' | 'price-invalid' | 'cache-write-price-unavailable' | null
}

export interface WidgetUsageSummary {
  readonly usage: WidgetTokenUsage
  readonly reports: number
  readonly missingUsageReports: number
  readonly unpricedReports: number
  readonly estimates: readonly WidgetMoneyRange[]
  readonly pricing: 'estimated' | 'partial' | 'unavailable' | 'no-usage'
}

export interface WidgetTurnRecord extends WidgetUsageSummary {
  readonly id: string
  readonly sessionId: string
  readonly turn: number
  readonly startedAt: number
  readonly endedAt: number | null
  readonly outcome: string | null
  readonly observedFromStart: boolean
  readonly records: readonly WidgetUsageRecord[]
}

export interface WidgetUsageDay extends WidgetUsageSummary { readonly day: string }

export interface WidgetBalanceWallet {
  readonly currency: string
  readonly total: string
  readonly recharge: string | null
  readonly bonus: string | null
}

export type WidgetBalanceSourceName = 'api-key' | 'account'
export type WidgetBalanceFailure = 'network' | 'unauthorized' | 'invalid-response' | 'credential-changed' | 'credential-unavailable'

/** Internal query result; scopeKey never appears in a browser snapshot. */
export type WidgetBalanceRead =
  | { readonly status: 'ready'; readonly source: WidgetBalanceSourceName; readonly scopeKey: string | null; readonly wallets: readonly WidgetBalanceWallet[] }
  | { readonly status: 'unavailable'; readonly reason: 'not-configured' | 'signed-out' | 'unsupported-source' }
  | { readonly status: 'failed'; readonly reason: WidgetBalanceFailure; readonly source?: WidgetBalanceSourceName; readonly scopeKey?: string }

export interface WidgetBalanceDay {
  readonly day: string
  readonly source: WidgetBalanceSourceName
  readonly currency: string
  readonly firstObservedAt: number
  readonly lastObservedAt: number
  readonly openingBalance: string
  readonly currentBalance: string
  readonly observedDecrease: string
  readonly observedIncrease: string
  readonly samples: number
  readonly crossDayGap: boolean
}

export interface WidgetStoredBalanceDay extends WidgetBalanceDay { readonly scopeKey: string }

export interface WidgetBalanceSnapshot {
  readonly status: 'idle' | 'refreshing' | 'ready' | 'unavailable' | 'failed'
  readonly source: WidgetBalanceSourceName | null
  readonly reason: WidgetBalanceFailure | 'not-configured' | 'signed-out' | 'unsupported-source' | null
  readonly updatedAt: number | null
  readonly wallets: readonly WidgetBalanceWallet[]
  readonly identityKnown: boolean
}

export interface WidgetAccountingSnapshot {
  readonly revision: number
  readonly observingSince: number
  readonly timeZone: string
  readonly refreshMs: number
  readonly balance: WidgetBalanceSnapshot
  readonly observedToday: readonly WidgetBalanceDay[]
  readonly usageToday: WidgetUsageDay
  readonly usageDays: readonly WidgetUsageDay[]
  readonly turns: readonly WidgetTurnRecord[]
  readonly activeTurns: readonly WidgetTurnRecord[]
  readonly storageStatus: 'ready' | 'failed'
}

export interface WidgetAccountingLedger {
  readonly version: 1
  readonly observingSince: number
  readonly balanceDays: readonly WidgetStoredBalanceDay[]
  readonly usageDays: readonly WidgetUsageDay[]
  readonly turns: readonly WidgetTurnRecord[]
  readonly activeTurns: readonly WidgetTurnRecord[]
  readonly watermarks: Readonly<Record<string, number>>
  readonly routes: Readonly<Record<string, WidgetUsageRoute>>
}

export interface WidgetAccountingDependencies {
  readonly readBalance: (signal: AbortSignal) => Promise<WidgetBalanceRead>
  readonly priceFor: WidgetPriceResolver
  readonly load: () => Promise<unknown>
  readonly save: (ledger: WidgetAccountingLedger) => Promise<void>
  readonly now?: () => number
  readonly timeZone?: string
  readonly refreshMs?: number
  readonly maxTurns?: number
  readonly maxDays?: number
}

export interface WidgetAccounting {
  start(): Promise<void>
  refresh(): Promise<WidgetAccountingSnapshot>
  snapshot(): WidgetAccountingSnapshot
  onChange(listener: () => void): () => void
  accept(sessionId: string, event: SessionEvent): Promise<void>
  invalidateBalance(): void
  dispose(): Promise<void>
}
