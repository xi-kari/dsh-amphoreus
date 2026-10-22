import { lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  WidgetAccounting, WidgetAccountingDependencies, WidgetAccountingLedger, WidgetAccountingSnapshot,
  WidgetBalanceRead, WidgetBalanceSnapshot, WidgetStoredBalanceDay, WidgetTurnRecord, WidgetUsageRecord, WidgetUsageRoute,
} from './widget-accounting-types.ts'
import { emptyWidgetAccountingLedger, widgetAccountingLedgerSchema } from './widget-accounting-store.ts'
import { checkedWidgetUsage, decimalMoney, emptyWidgetUsageSummary, estimateWidgetUsage, mergeWidgetUsage, moneyDifference, positiveMoney, sumMoney } from './widget-money.ts'

const emptyBalance = (): WidgetBalanceSnapshot => ({ status: 'idle', source: null, reason: null, updatedAt: null, wallets: [], identityKnown: false })

async function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let abort!: () => void
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error('Widget query cancelled'))
    signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([task, cancelled]) }
  finally { signal.removeEventListener('abort', abort) }
}

function positiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result <= 0 || result > maximum) throw new Error('Invalid widget accounting option')
  return result
}

export class WidgetAccountingService implements WidgetAccounting {
  readonly #dependencies: WidgetAccountingDependencies
  readonly #now: () => number
  readonly #formatter: Intl.DateTimeFormat
  readonly #timeZone: string
  readonly #refreshMs: number
  readonly #maxTurns: number
  readonly #maxDays: number
  readonly #listeners = new Set<() => void>()
  #ledger: WidgetAccountingLedger
  #pendingLedger: WidgetAccountingLedger | undefined
  #balance = emptyBalance()
  #scope: string | null = null
  #revision = 0
  #generation = 0
  #storageStatus: 'ready' | 'failed' = 'ready'
  #started: Promise<void> | undefined
  #queue = Promise.resolve()
  #refreshing: Promise<WidgetAccountingSnapshot> | undefined
  #request: AbortController | undefined
  #timer: ReturnType<typeof setInterval> | undefined
  #disposed = false
  #closing: Promise<void> | undefined

  constructor(dependencies: WidgetAccountingDependencies) {
    this.#dependencies = dependencies
    this.#now = dependencies.now ?? Date.now
    this.#timeZone = dependencies.timeZone ?? 'Asia/Shanghai'
    this.#formatter = new Intl.DateTimeFormat('en', { timeZone: this.#timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    this.#refreshMs = positiveInteger(dependencies.refreshMs, 60_000, 2_147_483_647)
    this.#maxTurns = positiveInteger(dependencies.maxTurns, 200, 10_000)
    this.#maxDays = positiveInteger(dependencies.maxDays, 90, 3_660)
    this.#ledger = emptyWidgetAccountingLedger(this.#now())
  }

  start(): Promise<void> {
    this.#started ??= (async () => {
      const stored = await this.#dependencies.load()
      const ledger = stored === undefined ? this.#ledger : widgetAccountingLedgerSchema.parse(stored)
      this.#ledger = ledger
      if (this.#disposed) return
      this.#timer = setInterval(() => { void this.refresh() }, this.#refreshMs)
      this.#timer.unref?.()
      this.#publish()
      void this.refresh()
    })()
    return this.#started
  }

  snapshot(): WidgetAccountingSnapshot {
    const day = this.#day(this.#now())
    const observedToday = this.#ledger.balanceDays
      .filter(row => row.scopeKey === this.#scope && row.day === day)
      .map(({ scopeKey: _scopeKey, ...row }) => row)
    return structuredClone({
      revision: this.#revision, observingSince: this.#ledger.observingSince, timeZone: this.#timeZone,
      refreshMs: this.#refreshMs, balance: this.#balance, observedToday,
      usageToday: this.#ledger.usageDays.find(row => row.day === day) ?? { day, ...emptyWidgetUsageSummary() },
      usageDays: this.#ledger.usageDays, turns: this.#ledger.turns, activeTurns: this.#ledger.activeTurns,
      storageStatus: this.#storageStatus,
    })
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  refresh(): Promise<WidgetAccountingSnapshot> {
    if (this.#disposed) return Promise.resolve(this.snapshot())
    if (this.#refreshing !== undefined) return this.#refreshing
    const generation = this.#generation
    const request = new AbortController()
    this.#request = request
    this.#balance = { ...this.#balance, status: 'refreshing', reason: null }
    this.#publish()
    const task = (async () => {
      await this.start()
      if (this.#disposed || generation !== this.#generation) return this.snapshot()
      let result: WidgetBalanceRead
      try { result = await abortable(this.#dependencies.readBalance(request.signal), request.signal) }
      catch { result = { status: 'failed', reason: 'network' } }
      if (this.#disposed || generation !== this.#generation) return this.snapshot()
      const at = this.#now()
      try {
        await this.#enqueue(async () => {
          if (this.#disposed || generation !== this.#generation) return
          if (result.status === 'ready') {
            const wallets = result.wallets.map(wallet => ({
              currency: wallet.currency, total: decimalMoney(wallet.total),
              recharge: wallet.recharge === null ? null : decimalMoney(wallet.recharge),
              bonus: wallet.bonus === null ? null : decimalMoney(wallet.bonus),
            }))
            const next = this.#observeBalance({ ...result, wallets }, at)
            await this.#commit(next)
            if (this.#disposed || generation !== this.#generation) return
            this.#scope = result.scopeKey
            this.#balance = { status: 'ready', source: result.source, reason: null, updatedAt: at, wallets, identityKnown: result.scopeKey !== null }
          } else {
            if (this.#pendingLedger !== undefined) await this.#commit(this.#pendingLedger)
            const sameScope = result.status === 'failed' && result.scopeKey !== undefined && result.scopeKey === this.#scope
            if (!sameScope) this.#scope = null
            this.#balance = {
              ...(sameScope ? this.#balance : emptyBalance()), status: result.status, reason: result.reason,
              source: result.status === 'failed' ? result.source ?? null : null,
            }
          }
          this.#publish()
        })
      } catch {
        if (generation === this.#generation && !this.#disposed) {
          this.#balance = this.#storageStatus === 'failed'
            ? { ...this.#balance, status: 'failed', reason: null }
            : { ...emptyBalance(), status: 'failed', reason: 'invalid-response' }
          if (this.#storageStatus !== 'failed') this.#scope = null
          this.#publish()
        }
      }
      return this.snapshot()
    })().finally(() => {
      if (this.#refreshing === task) this.#refreshing = undefined
      if (this.#request === request) this.#request = undefined
    })
    this.#refreshing = task
    return task
  }

  invalidateBalance(): void {
    this.#generation++
    this.#request?.abort()
    this.#refreshing = undefined
    this.#scope = null
    this.#balance = emptyBalance()
    if (!this.#disposed) this.#publish()
  }

  async accept(sessionId: string, event: SessionEvent): Promise<void> {
    if (this.#disposed) return
    if (!['request/header', 'request/context', 'turn/start', 'turn/end', 'assistant/message', 'assistant/attempt'].includes(event.type)) return
    const ready = this.start()
    await this.#enqueue(async () => {
      await ready
      const state = this.#pendingLedger ?? this.#ledger
      if (event.seq <= (state.watermarks[sessionId] ?? -1)) {
        if (this.#pendingLedger !== undefined) await this.#commit(state)
        return
      }
      const next = structuredClone(state)
      const routes = { ...next.routes }
      const active = [...next.activeTurns]
      const completed = [...next.turns]
      let usageDays = [...next.usageDays]
      if (event.type === 'request/header' || event.type === 'request/context') {
        const route = event.type === 'request/header' ? event.data.header.config : event.data
        if (routes[sessionId]?.provider === route.provider && routes[sessionId]?.model === route.model) return
        routes[sessionId] = { provider: route.provider, model: route.model }
      }
      else if (event.type === 'turn/start' || event.type === 'turn/end' || event.type === 'assistant/message' || event.type === 'assistant/attempt') {
        const turn = event.data.turn
        const id = `${sessionId}:${turn}`
        if (event.type === 'turn/start') {
          for (let index = active.length - 1; index >= 0; index--) {
            const previous = active[index]!
            if (previous.sessionId === sessionId && previous.id !== id) {
              completed.unshift({ ...previous, endedAt: event.time, outcome: 'observation-ended' })
              active.splice(index, 1)
            }
          }
        }
        const position = active.findIndex(row => row.id === id)
        let row: WidgetTurnRecord = active[position] ?? {
          ...emptyWidgetUsageSummary(), id, sessionId, turn, startedAt: event.time, endedAt: null,
          outcome: null, observedFromStart: event.type === 'turn/start', records: [],
        }
        if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
          const route = event.type === 'assistant/message'
            ? { provider: event.data.message.source.provider, model: event.data.message.source.model }
            : routes[sessionId] ?? null
          const usage = event.type === 'assistant/message'
            ? event.data.usage ?? lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
            : lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
          const record = this.#usageRecord(event.seq, event.time, route, usage, event.type === 'assistant/message' ? 'message' : 'attempt')
          row = { ...row, ...mergeWidgetUsage(row, record), records: [...row.records, record] }
          const day = this.#day(event.time)
          const previousDay = usageDays.find(value => value.day === day) ?? { day, ...emptyWidgetUsageSummary() }
          usageDays = [...usageDays.filter(value => value.day !== day), { day, ...mergeWidgetUsage(previousDay, record) }]
        }
        if (position >= 0) active.splice(position, 1)
        if (event.type === 'turn/end') completed.unshift({ ...row, endedAt: event.time, outcome: event.data.reason.kind })
        else active.push(row)
      }
      await this.#commit({
        ...next, routes, watermarks: { ...next.watermarks, [sessionId]: event.seq }, activeTurns: active,
        turns: completed.sort((left, right) => (right.endedAt ?? 0) - (left.endedAt ?? 0)).slice(0, this.#maxTurns),
        usageDays: usageDays.sort((left, right) => right.day.localeCompare(left.day)).slice(0, this.#maxDays),
      })
      if (!this.#disposed) this.#publish()
    })
  }

  dispose(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing
    const refreshing = this.#refreshing
    this.#disposed = true
    if (this.#timer !== undefined) clearInterval(this.#timer)
    this.invalidateBalance()
    this.#closing = (async () => {
      try {
        await this.#started?.catch(() => undefined)
        await refreshing?.catch(() => undefined)
        await this.#queue
        if (this.#pendingLedger !== undefined) await this.#commit(this.#pendingLedger)
      } finally { this.#listeners.clear() }
    })()
    return this.#closing
  }

  #day(at: number): string {
    const parts = this.#formatter.formatToParts(at)
    const value = (type: string) => parts.find(part => part.type === type)?.value ?? ''
    return `${value('year')}-${value('month')}-${value('day')}`
  }

  #usageRecord(seq: number, at: number, route: WidgetUsageRoute | null, rawUsage: unknown, kind: WidgetUsageRecord['kind']): WidgetUsageRecord {
    const usage = checkedWidgetUsage(rawUsage)
    const base = { seq, at, route, kind, usage, price: null, estimate: null }
    if (usage === null) return { ...base, unavailableReason: 'usage-missing' }
    if (route === null) return { ...base, unavailableReason: 'route-missing' }
    try {
      const price = this.#dependencies.priceFor(route, at)
      if (price === undefined) return { ...base, unavailableReason: 'price-unavailable' }
      const estimate = estimateWidgetUsage(usage, price)
      return { ...base, price: structuredClone(price), estimate, unavailableReason: estimate === null ? 'cache-write-price-unavailable' : null }
    } catch { return { ...base, unavailableReason: 'price-invalid' } }
  }

  #observeBalance(result: Extract<WidgetBalanceRead, { status: 'ready' }>, at: number): WidgetAccountingLedger {
    const state = this.#pendingLedger ?? this.#ledger
    if (result.scopeKey === null) return state
    const day = this.#day(at)
    const rows = [...state.balanceDays]
    for (const wallet of result.wallets) {
      const matches = (row: WidgetStoredBalanceDay) => row.scopeKey === result.scopeKey && row.currency === wallet.currency && row.source === result.source
      const previous = rows.filter(matches).sort((left, right) => right.lastObservedAt - left.lastObservedAt)[0]
      if (previous !== undefined && at <= previous.lastObservedAt) continue
      const position = rows.findIndex(row => matches(row) && row.day === day)
      const current = rows[position]
      const row: WidgetStoredBalanceDay = current === undefined ? {
        day, scopeKey: result.scopeKey, source: result.source, currency: wallet.currency,
        firstObservedAt: at, lastObservedAt: at, openingBalance: wallet.total, currentBalance: wallet.total,
        observedDecrease: '0', observedIncrease: '0', samples: 1, crossDayGap: previous !== undefined,
      } : {
        ...current, lastObservedAt: at, currentBalance: wallet.total, samples: current.samples + 1,
        observedDecrease: sumMoney(current.observedDecrease, positiveMoney(moneyDifference(current.currentBalance, wallet.total))),
        observedIncrease: sumMoney(current.observedIncrease, positiveMoney(moneyDifference(wallet.total, current.currentBalance))),
      }
      if (position >= 0) rows[position] = row
      else rows.push(row)
    }
    const days = new Set([...new Set(rows.map(row => row.day))].sort().reverse().slice(0, this.#maxDays))
    return { ...state, balanceDays: rows.filter(row => days.has(row.day)) }
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const task = this.#queue.then(operation)
    this.#queue = task.catch(() => undefined)
    return task
  }

  async #commit(ledger: WidgetAccountingLedger): Promise<void> {
    this.#pendingLedger = ledger
    try { await this.#dependencies.save(structuredClone(ledger)) }
    catch (error) { this.#storageStatus = 'failed'; this.#publish(); throw error }
    this.#ledger = ledger
    this.#pendingLedger = undefined
    this.#storageStatus = 'ready'
  }

  #publish(): void {
    if (this.#disposed) return
    this.#revision++
    for (const listener of this.#listeners) {
      try { listener() } catch { /* Subscribers cannot reverse a committed observation. */ }
    }
  }
}
