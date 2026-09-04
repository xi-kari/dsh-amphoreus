/** dsh-amphoreus browser half. Components receive injected faces, never ctx. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { HeroBrandMark, SidebarBrandMark, SidebarBrandName } from './brand.tsx'
import { installGarnish } from './garnish.ts'
import { en, NS, zh, type AmphoreusKey } from './locales.ts'
import { AmphoreusSettings } from './settings.tsx'
import { AmphoreusClientModel } from './state.ts'
import { registerGlobalTheme } from './theme.ts'
import { WorkbenchView, type WorkbenchViewInjected } from './workbench.tsx'
import { HERO_VISUALS } from '../shared/heroes.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-amphoreus copy. */
    amphoreus: AmphoreusKey
  }
}

// A 章阶段不注入 uiConversation；B TB4 起注入它仅为 binding().target('chat') 读正文——其 binding().activate() 只激活装配目标、不切 Tab（见任务书 A.0 决策 A-2 与总纲裁决 J-2）。
export const inject = ['slots', 'locale', 'theme', 'sessions']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'amphoreus: dictionaries')
  const model = new AmphoreusClientModel()
  ctx.effect(() => registerGlobalTheme(ctx, model), 'amphoreus: global theme')
  ctx.effect(async () => {
    await model.start()
    return () => model.close()
  }, 'amphoreus: state channel')

  const assetsConfigured = (): boolean =>
    model.getSnapshot().state?.effectiveConfig.assetsConfigured
      ?? window.__AMPHOREUS_BOOT__?.wallpaper.url !== undefined

  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.register({ name: 'sidebar.brand.mark', priority: -10, inject: () => ({ assetsConfigured }) }, SidebarBrandMark))
  ctx.slots.inject('sidebar.brand.name', () =>
    ctx.slots.register({ name: 'sidebar.brand.name', priority: -10, locale: NS }, SidebarBrandName))
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -10, inject: () => ({ assetsConfigured }) }, HeroBrandMark))

  // DOM garnish: time-of-day greeting headline + chimera folder stickers.
  ctx.effect(() => installGarnish({ assetsConfigured }), 'amphoreus: garnish')

  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'amphoreus',
    order: 30,
    label: () => t('settings.nav'),
    locale: NS,
    inject: () => ({ model }),
  }, AmphoreusSettings))

  // Workbench as a second conversation view (id/order shape mirrors ui-trajectory).
  const skillByHero = new Map<string, string>(HERO_VISUALS.map(hero => [hero.heroId, hero.skill]))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'amphoreus-workbench',
    order: 20,
    locale: NS,
    label: () => t('view.workbench'),
    inject: (): WorkbenchViewInjected => ({
      sessions: ctx.sessions as unknown as WorkbenchViewInjected['sessions'],
      seatSkillOf: heroId => skillByHero.get(heroId),
      bindSeat: async (sessionId, skillName) => {
        const nonce = model.getSnapshot().state?.nonce ?? window.__AMPHOREUS_BOOT__?.nonce
        if (nonce === undefined) throw new Error('nonce 未就绪')
        const response = await fetch(`/amphoreus/api/bindings/${encodeURIComponent(sessionId)}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': nonce },
          body: JSON.stringify({ skill: skillName, boundBy: 'seat-new' }),
        })
        if (!response.ok) throw new Error(`席位绑定失败（HTTP ${response.status}）`)
      },
    }),
  }, WorkbenchView))
}
