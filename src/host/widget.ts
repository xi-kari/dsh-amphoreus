import type { Context } from '@deepseek-ai/cordis'
import { APP_IDENTITY } from '@deepseek-ai/dsh-llm'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { AmphoreusConfig } from './config.ts'
import { WidgetAccountingService } from './widget-accounting.ts'
import { widgetAccountingLedgerSchema } from './widget-accounting-store.ts'
import { createDshWidgetBalanceReader, type WidgetDshAccount, type WidgetDshCredentials } from './widget-balance-source.ts'
import { createWidgetPriceResolver } from './widget-pricing.ts'

export const widgetDomain = defineDomain({
  name: 'amphoreus_widget', version: 1, layout: 'single',
  global: { schema: z.object({ ledger: widgetAccountingLedgerSchema.nullable() }), initial: { ledger: null } },
  tables: {},
})

interface ProviderDirectory { listConfigurableProviders(): readonly { provider: string; settingsNs: string }[] }
interface ProviderSettings { describe(options: { redactSecrets: boolean }): readonly { ns: string; value?: unknown }[] }
interface LaunchEnvironment { get(name: string): { readonly value: string } | undefined }
interface OptionalEvents { on(name: string, listener: () => void): () => void }

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function widgetProviderFacts(ctx: Pick<Context, 'get'>, provider: string): { official: boolean; keyRef: string } {
  const llm = ctx.get('llm') as ProviderDirectory | undefined
  const settings = ctx.get('settings') as ProviderSettings | undefined
  const directory = llm?.listConfigurableProviders().find(item => item.provider === provider)
  const config = object(directory === undefined ? undefined : settings?.describe({ redactSecrets: true }).find(item => item.ns === directory.settingsNs)?.value)
  const environment = ctx.get('launchEnvironment') as LaunchEnvironment | undefined
  const base = config.baseURL ?? environment?.get('DEEPSEEK_BASE_URL')?.value ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
  let official = false
  try {
    const url = new URL(String(base))
    official = url.origin === 'https://api.deepseek.com' && url.username === '' && url.password === ''
  } catch {}
  return { official, keyRef: typeof config.apiKeyEnv === 'string' && config.apiKeyEnv !== '' ? config.apiKeyEnv : 'DEEPSEEK_API_KEY' }
}

export async function registerWidgetAccounting(ctx: Context, config: AmphoreusConfig): Promise<{ service: WidgetAccountingService; dispose(): Promise<void> }> {
  const domain = await ctx.storageDomain.open(widgetDomain)
  const pricing = createWidgetPriceResolver(config.widget?.prices, config.widget?.priceCurrency)
  const service = new WidgetAccountingService({
    load: async () => domain.global.get().ledger ?? undefined,
    save: ledger => domain.global.set({ ledger }),
    maxTurns: 500, maxDays: 365,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    refreshMs: (config.widget?.refreshSeconds ?? 60) * 1000,
    priceFor: (route, at) => {
      const configured = config.widget?.prices.some(price => price.provider === route.provider && price.model === route.model)
      if (!configured && !widgetProviderFacts(ctx, route.provider).official) return undefined
      return pricing(route, at)
    },
    readBalance: signal => {
      const facts = widgetProviderFacts(ctx, 'deepseek-official')
      const keyRef = config.widget?.apiKeyRef || facts.keyRef
      return createDshWidgetBalanceReader({
        getAccount: () => ctx.get('deepseekAccount') as WidgetDshAccount | undefined,
        getCredentials: () => ctx.get('credentials') as WidgetDshCredentials | undefined,
        clientMetadata: () => ({ version: APP_IDENTITY.version, locale: 'zh-CN', timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 }),
        mode: config.widget?.balanceSource ?? 'auto', apiKeyRef: keyRef,
        officialApiKeyRoute: () => {
          const current = widgetProviderFacts(ctx, 'deepseek-official')
          return current.official && (config.widget?.apiKeyRef || current.keyRef) === keyRef
        },
        timeoutMs: 15000,
      })(signal)
    },
  })
  try { await service.start() }
  catch (error) { await service.dispose(); await domain.close(); throw error }
  const events = ctx.on('session/event', (session: { id: string }, event: SessionEvent) => {
    void service.accept(session.id, event).catch(() => ctx.logger.warn('amphoreus widget usage could not be recorded'))
  })
  const optional = ctx as unknown as OptionalEvents
  const credentials = ['credentials/reference-updated', 'credentials/record-updated', 'deepseek-account/signed-out', 'deepseek-account/session-expired', 'app-boot/config-reload']
    .map(name => optional.on(name, () => { service.invalidateBalance(); void service.refresh() }))
  return {
    service,
    async dispose() {
      events()
      for (const off of credentials) off()
      try { await service.dispose() } finally { await domain.close() }
    },
  }
}
