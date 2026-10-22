import type { WidgetPriceQuote, WidgetPriceResolver, WidgetTokenPrices } from './widget-accounting-types.ts'

export interface WidgetConfiguredPrice {
  provider: string
  model: string
  currency: string
  input: string
  cacheRead: string
  cacheWrite?: string
  output: string
  asOf?: string
}

export const WIDGET_PRICE_AS_OF = '2026-10-22'
const OFFICIAL_PROVIDERS = new Set(['deepseek-official', 'deepseek-account'])
const FLASH_MODELS = new Set(['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'])
const PRICES = {
  CNY: { flash: ['1', '0.02', '4', '2', '0.04', '8'], pro: ['4.5', '0.15', '13.5', '9', '0.30', '27'] },
  USD: { flash: ['0.15', '0.003', '0.6', '0.30', '0.006', '1.2'], pro: ['0.66', '0.022', '1.98', '1.32', '0.044', '3.96'] },
} as const

/** Peak/off-peak bounds avoid assuming a Chinese holiday calendar or a later tariff. */
export function createWidgetPriceResolver(configured: readonly WidgetConfiguredPrice[] = [], currency: 'CNY' | 'USD' = 'CNY'): WidgetPriceResolver {
  return (route, eventTime) => {
    const custom = configured.find(item => item.provider === route.provider && item.model === route.model)
    if (custom !== undefined) {
      const prices: WidgetTokenPrices = { input: custom.input, cacheRead: custom.cacheRead, output: custom.output,
        ...(custom.cacheWrite === undefined ? {} : { cacheWrite: custom.cacheWrite }) }
      return { id: JSON.stringify([route, custom]), currency: custom.currency, source: 'user-configured', asOf: custom.asOf || 'user-configured', low: prices, high: prices }
    }
    if (!OFFICIAL_PROVIDERS.has(route.provider) || !Number.isFinite(eventTime) || eventTime < Date.parse(`${WIDGET_PRICE_AS_OF}T00:00:00Z`)) return undefined
    const family = FLASH_MODELS.has(route.model) ? 'flash' : route.model === 'deepseek-v4-pro' ? 'pro' : undefined
    if (family === undefined) return undefined
    const [inputLow, cacheLow, outputLow, inputHigh, cacheHigh, outputHigh] = PRICES[currency][family]
    const result: WidgetPriceQuote = {
      id: `deepseek-${family}-${currency}-${WIDGET_PRICE_AS_OF}`,
      currency,
      source: `https://api-docs.deepseek.com/${currency === 'CNY' ? 'zh-cn/' : ''}quick_start/pricing/`,
      asOf: WIDGET_PRICE_AS_OF,
      low: { input: inputLow, cacheRead: cacheLow, output: outputLow },
      high: { input: inputHigh, cacheRead: cacheHigh, output: outputHigh },
    }
    return result
  }
}
