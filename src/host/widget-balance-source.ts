import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { WidgetBalanceRead, WidgetBalanceWallet } from './widget-accounting-types.ts'
import { decimalMoney, sumMoney } from './widget-money.ts'

export interface WidgetAccountClientMetadata {
  readonly version: string
  readonly locale: string
  readonly timezoneOffsetSeconds: number
}

export interface WidgetDshAccount {
  getState(): Promise<{ readonly status: 'signed-out' | 'credential-stored' }>
  getProfile(client: WidgetAccountClientMetadata): Promise<{ readonly status: 'ready'; readonly value: { readonly id: string | null } } | { readonly status: 'failed' } | null>
  getBalance(client: WidgetAccountClientMetadata): Promise<{
    readonly status: 'ready'
    readonly value: readonly { readonly currency: 'CNY' | 'USD'; readonly balance: string }[]
    readonly bonusWallets: readonly { readonly currency: 'CNY' | 'USD'; readonly balance: string }[]
  } | { readonly status: 'failed' } | null>
  getDeviceIdentity(): Promise<{ readonly userId?: string }>
}

export interface WidgetDshCredentials {
  resolve(ref: string): Promise<{ readonly value: string } | undefined>
}

export interface WidgetDshBalanceDependencies {
  readonly getAccount: () => WidgetDshAccount | undefined
  readonly getCredentials: () => WidgetDshCredentials | undefined
  readonly clientMetadata: () => WidgetAccountClientMetadata
  readonly mode?: 'auto' | 'account' | 'api-key'
  readonly apiKeyRef?: string
  /** False prevents an API-key query when the configured provider uses a nonofficial endpoint. */
  readonly officialApiKeyRoute?: () => boolean
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
}

const officialBalanceUrl = 'https://api.deepseek.com/user/balance'
const balanceBody = z.object({
  balance_infos: z.array(z.object({
    currency: z.enum(['CNY', 'USD']), total_balance: z.string().max(256),
    granted_balance: z.string().max(256).optional(), topped_up_balance: z.string().max(256).optional(),
  })).min(1).max(16),
})

function scopeFor(source: 'api-key' | 'account', identity: string): string {
  return `${source}:${createHash('sha256').update(identity).digest('hex')}`
}

export function createDshWidgetBalanceReader(dependencies: WidgetDshBalanceDependencies): (signal: AbortSignal) => Promise<WidgetBalanceRead> {
  const mode = dependencies.mode ?? 'auto'
  const ref = dependencies.apiKeyRef ?? 'DEEPSEEK_API_KEY'
  const timeoutMs = dependencies.timeoutMs ?? 30_000
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(ref)) throw new Error('Invalid widget credential reference')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new Error('Invalid widget query timeout')

  async function keyBalance(key: string, signal: AbortSignal): Promise<WidgetBalanceRead> {
    const scopeKey = scopeFor('api-key', key)
    if (dependencies.officialApiKeyRoute?.() === false) return { status: 'unavailable', reason: 'unsupported-source' }
    if (key.length === 0 || !/^[\x20-\x7e]+$/u.test(key)) return { status: 'failed', source: 'api-key', scopeKey, reason: 'credential-unavailable' }
    try {
      const response = await (dependencies.fetch ?? fetch)(officialBalanceUrl, {
        method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${key}` },
        signal,
      })
      signal.throwIfAborted()
      const text = response.ok ? await response.text() : ''
      signal.throwIfAborted()
      const current = await dependencies.getCredentials()?.resolve(ref)
      signal.throwIfAborted()
      if (current?.value.trim() !== key) return { status: 'failed', source: 'api-key', reason: 'credential-changed' }
      if (dependencies.officialApiKeyRoute?.() === false) return { status: 'unavailable', reason: 'unsupported-source' }
      if (!response.ok) return { status: 'failed', source: 'api-key', scopeKey, reason: response.status === 401 || response.status === 403 ? 'unauthorized' : 'network' }
      if (text.length > 65_536) return { status: 'failed', source: 'api-key', scopeKey, reason: 'invalid-response' }
      try {
        const parsed = balanceBody.safeParse(JSON.parse(text))
        if (!parsed.success) return { status: 'failed', source: 'api-key', scopeKey, reason: 'invalid-response' }
        const wallets: WidgetBalanceWallet[] = parsed.data.balance_infos.map(wallet => ({
          currency: wallet.currency, total: decimalMoney(wallet.total_balance),
          recharge: wallet.topped_up_balance === undefined ? null : decimalMoney(wallet.topped_up_balance),
          bonus: wallet.granted_balance === undefined ? null : decimalMoney(wallet.granted_balance),
        }))
        if (new Set(wallets.map(wallet => wallet.currency)).size !== wallets.length) return { status: 'failed', source: 'api-key', scopeKey, reason: 'invalid-response' }
        return { status: 'ready', source: 'api-key', scopeKey, wallets }
      } catch { return { status: 'failed', source: 'api-key', scopeKey, reason: 'invalid-response' } }
    } catch (error) {
      signal.throwIfAborted()
      return { status: 'failed', source: 'api-key', scopeKey, reason: error instanceof SyntaxError ? 'invalid-response' : 'network' }
    }
  }

  async function accountBalance(signal: AbortSignal): Promise<WidgetBalanceRead> {
    const account = dependencies.getAccount()
    if (account === undefined) return { status: 'unavailable', reason: 'not-configured' }
    try {
      const state = await account.getState()
      signal.throwIfAborted()
      if (state.status === 'signed-out') return { status: 'unavailable', reason: 'signed-out' }
      const client = dependencies.clientMetadata()
      const [profile, balance] = await Promise.all([account.getProfile(client), account.getBalance(client)])
      signal.throwIfAborted()
      if (profile === null || balance === null) return { status: 'failed', source: 'account', reason: 'credential-changed' }
      const identity = profile.status === 'ready' ? profile.value.id : null
      const after = await account.getDeviceIdentity()
      signal.throwIfAborted()
      if (identity !== null && after.userId !== identity) return { status: 'failed', source: 'account', reason: 'credential-changed' }
      const scopeKey = identity === null ? null : scopeFor('account', identity)
      if (balance.status === 'failed') return { status: 'failed', source: 'account', ...(scopeKey === null ? {} : { scopeKey }), reason: 'network' }
      const totals = new Map<string, { recharge: string; bonus: string }>()
      for (const [kind, wallets] of [['recharge', balance.value], ['bonus', balance.bonusWallets]] as const) {
        for (const wallet of wallets) {
          const row = totals.get(wallet.currency) ?? { recharge: '0', bonus: '0' }
          row[kind] = sumMoney(row[kind], decimalMoney(wallet.balance))
          totals.set(wallet.currency, row)
        }
      }
      return {
        status: 'ready', source: 'account', scopeKey,
        wallets: [...totals].map(([currency, row]) => ({ currency, ...row, total: sumMoney(row.recharge, row.bonus) })),
      }
    } catch {
      signal.throwIfAborted()
      return { status: 'failed', source: 'account', reason: 'network' }
    }
  }

  const query = async (signal: AbortSignal): Promise<WidgetBalanceRead> => {
    signal.throwIfAborted()
    if (mode !== 'account') {
      let key: string | undefined
      try { key = (await dependencies.getCredentials()?.resolve(ref))?.value }
      catch { return { status: 'failed', source: 'api-key', reason: 'credential-unavailable' } }
      signal.throwIfAborted()
      if (key !== undefined) return keyBalance(key.trim(), signal)
      if (mode === 'api-key') return { status: 'unavailable', reason: 'not-configured' }
    }
    return accountBalance(signal)
  }

  return async signal => {
    signal.throwIfAborted()
    const deadline = new AbortController()
    const active = AbortSignal.any([signal, deadline.signal])
    const timer = setTimeout(() => deadline.abort(), timeoutMs)
    let cancel!: () => void
    const interrupted = new Promise<WidgetBalanceRead>(resolve => {
      cancel = () => resolve({ status: 'failed', reason: 'network' })
      active.addEventListener('abort', cancel, { once: true })
    })
    try {
      const result = await Promise.race([query(active), interrupted])
      signal.throwIfAborted()
      return result
    } catch {
      signal.throwIfAborted()
      return { status: 'failed', reason: 'network' }
    } finally {
      clearTimeout(timer)
      active.removeEventListener('abort', cancel)
      deadline.abort()
    }
  }
}
