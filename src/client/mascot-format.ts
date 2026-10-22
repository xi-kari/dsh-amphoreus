import Big from 'big.js'
import type { WidgetPublicState, WidgetPublicTurn } from '../shared/api.ts'
import type { WidgetMoneyRange, WidgetUsageSummary } from '../host/widget-accounting-types.ts'
import type { AmphoreusKey } from './locales.ts'
import type { MascotWidgetData } from './mascot-widget.tsx'

type Translate = (key: AmphoreusKey, params?: Record<string, unknown>) => string
type Binding = { readonly sessionId: string; readonly skillName: string }

function decimal(value: string): string | undefined {
  try {
    const number = new Big(value)
    const rounded = number.toFixed(8).replace(/\.?0+$/u, '')
    if (number.eq(0)) return '0'
    if (new Big(rounded || '0').eq(0)) return number.lt(0) ? '>-0.00000001' : '<0.00000001'
    return rounded
  } catch { return undefined }
}

export function formatWidgetMoney(value: string, currency: string): string {
  const amount = decimal(value)
  return amount === undefined ? '—' : `${currency} ${amount}`
}

export function formatWidgetRange(range: WidgetMoneyRange): string {
  const low = decimal(range.low), high = decimal(range.high)
  if (low === undefined || high === undefined) return '—'
  return `${range.currency} ${low === high ? low : `${low}–${high}`}`
}

function roleTurns(widget: WidgetPublicState, skillName: string, bindings: readonly Binding[]): WidgetPublicTurn[] {
  const ids = new Set(bindings.filter(binding => binding.skillName === skillName).map(binding => binding.sessionId))
  return [...widget.activeTurns, ...widget.turns].filter(turn => ids.has(turn.sessionId))
    .sort((left, right) => (right.endedAt ?? right.startedAt) - (left.endedAt ?? left.startedAt))
    .filter((turn, index, all) => all.findIndex(item => item.id === turn.id) === index)
}

export function selectMascotTurn(widget: WidgetPublicState, skillName: string, currentSessionId: string | undefined, bindings: readonly Binding[]): WidgetPublicTurn | undefined {
  const turns = roleTurns(widget, skillName, bindings)
  return turns.find(turn => turn.sessionId === currentSessionId && turn.endedAt === null)
    ?? turns.find(turn => turn.sessionId === currentSessionId) ?? turns[0]
}

function time(value: number | null, timeZone: string): string {
  if (value === null || !Number.isFinite(value)) return '—'
  try { return new Intl.DateTimeFormat(undefined, { timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value) }
  catch { return new Date(value).toISOString().slice(0, 16).replace('T', ' ') }
}

function estimateText(summary: WidgetUsageSummary, t: Translate): string {
  if (summary.reports === 0) return t('widget.noUsage')
  if (summary.estimates.length === 0) return t('widget.unpriced')
  return `${t(summary.pricing === 'partial' ? 'widget.partialEstimate' : 'widget.estimate')} ${summary.estimates.map(formatWidgetRange).join(' · ')}`
}

function usageDetail(summary: WidgetUsageSummary, t: Translate, references?: WidgetPublicState['priceReferences']): string {
  const parts: string[] = []
  const number = (value: number) => Number.isSafeInteger(value) && value >= 0 ? new Intl.NumberFormat().format(value) : '—'
  if (summary.reports > 0) parts.push(t('widget.tokens', {
    input: number(summary.usage.inputTokens), output: number(summary.usage.outputTokens), cacheRead: number(summary.usage.cacheReadTokens),
    cacheWrite: number(summary.usage.cacheWriteTokens), reasoning: number(summary.usage.reasoningTokens),
  }))
  if (summary.missingUsageReports > 0) parts.push(t('widget.missingUsage', { n: summary.missingUsageReports }))
  if (summary.unpricedReports > 0) parts.push(t('widget.missingPrice', { n: summary.unpricedReports }))
  if (summary.estimates.length > 0) {
    parts.push(t('widget.priceAtRecord'))
    const quotes = [...new Set((references ?? []).map(reference => reference.source === 'user-configured'
      ? t('widget.customQuote', { date: reference.asOf }) : reference.asOf))]
    if (quotes.length > 0) parts.push(t('widget.priceReferences', { references: quotes.join(' · ') }))
  }
  return parts.join(' · ')
}

const reasonKeys = {
  network: 'widget.reason.network', unauthorized: 'widget.reason.unauthorized', 'invalid-response': 'widget.reason.invalidResponse',
  'credential-changed': 'widget.reason.credentialChanged', 'credential-unavailable': 'widget.reason.credentialUnavailable',
  'not-configured': 'widget.reason.notConfigured', 'signed-out': 'widget.reason.signedOut', 'unsupported-source': 'widget.reason.unsupported',
} as const

export interface MascotFormatOptions {
  readonly skillName: string
  readonly currentSessionId?: string | undefined
  readonly bindings: readonly Binding[]
  readonly t: Translate
}

export function formatMascotData(widget: WidgetPublicState, { skillName, currentSessionId, bindings, t }: MascotFormatOptions): MascotWidgetData {
  const balance = widget.balance
  const balanceDetail: string[] = []
  if (balance.source) balanceDetail.push(t(balance.source === 'api-key' ? 'widget.source.apiKey' : 'widget.source.account'))
  if (balance.status === 'failed') balanceDetail.push(t(balance.wallets.length > 0 ? 'widget.cached' : 'widget.balanceFailed', {
    reason: balance.reason ? t(reasonKeys[balance.reason]) : t('widget.reason.network'),
  }))
  else if (balance.status === 'unavailable' && balance.reason) balanceDetail.push(t(reasonKeys[balance.reason]))
  else if (balance.status === 'idle' || balance.status === 'refreshing') balanceDetail.push(t('mascot.loading'))
  if (balance.updatedAt !== null) balanceDetail.push(t('widget.updated', { time: time(balance.updatedAt, widget.timeZone) }))
  for (const wallet of balance.wallets) {
    if (wallet.recharge !== null) balanceDetail.push(t('widget.recharge', { value: formatWidgetMoney(wallet.recharge, wallet.currency) }))
    if (wallet.bonus !== null) balanceDetail.push(t('widget.bonus', { value: formatWidgetMoney(wallet.bonus, wallet.currency) }))
  }
  const observations = widget.observedToday
  const observedDetail = [t('widget.observedHint'), ...new Set(observations.map(item => t('widget.samples', {
    n: item.samples, first: time(item.firstObservedAt, widget.timeZone), last: time(item.lastObservedAt, widget.timeZone),
  })))]
  if (observations.some(item => item.crossDayGap)) observedDetail.push(t('widget.crossDayGap'))
  const current = selectMascotTurn(widget, skillName, currentSessionId, bindings)
  const turnDetail = (turn: WidgetPublicTurn) => [
    t(turn.sessionId === currentSessionId ? 'widget.currentConversation' : 'widget.roleRecent'),
    t('widget.turnNumber', { n: turn.turn }), time(turn.endedAt ?? turn.startedAt, widget.timeZone),
    turn.routes?.length ? t('widget.models', { models: turn.routes.map(route => `${route.provider}/${route.model}`).join(', ') }) : '',
    turn.endedAt === null ? t('widget.running') : t(turn.outcome === 'error' ? 'widget.endedError' : turn.outcome === 'aborted' || turn.outcome === 'cancelled' ? 'widget.endedInterrupted' : 'widget.completed'),
    turn.observedFromStart ? '' : t('widget.partialTurn'), usageDetail(turn, t),
  ].filter(Boolean).join(' · ')
  const history = roleTurns(widget, skillName, bindings).slice(0, 20).map(turn => ({
    id: turn.id, label: `${t('widget.turnNumber', { n: turn.turn })} · ${time(turn.endedAt ?? turn.startedAt, widget.timeZone)}`,
    amount: estimateText(turn, t), detail: turnDetail(turn),
  }))
  return {
    balance: { text: balance.wallets.length > 0 ? balance.wallets.map(wallet => formatWidgetMoney(wallet.total, wallet.currency)).join(' · ') : '—',
      detail: balanceDetail.join(' · '), status: balance.status },
    observed: { text: observations.length === 0 ? t('widget.noObservations') : observations.map(item =>
      t('widget.observedChange', { decrease: formatWidgetMoney(item.observedDecrease, item.currency), increase: formatWidgetMoney(item.observedIncrease, item.currency) })).join(' · '),
    detail: observedDetail.join(' · ') },
    usage: { text: estimateText(widget.usageToday, t), detail: [t('widget.localToday', { day: widget.usageToday.day, zone: widget.timeZone }),
      usageDetail(widget.usageToday, t, widget.priceReferences), t('widget.observingSince', { time: time(widget.observingSince, widget.timeZone) })].filter(Boolean).join(' · ') },
    ...(current ? { turn: { id: current.id, text: estimateText(current, t), detail: turnDetail(current), status: current.endedAt === null ? 'pending' : 'complete' } } : {}),
    history,
  }
}
