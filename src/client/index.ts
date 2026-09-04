/** dsh-amphoreus browser half. Components receive injected faces, never ctx. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { HeroBrandMark, SidebarBrandMark, SidebarBrandName } from './brand.tsx'
import { installGarnish } from './garnish.ts'
import { en, NS, zh, type AmphoreusKey } from './locales.ts'
import { startSeatSession, type SeatActionDeps } from './seat-actions.ts'
import { AmphoreusSettings } from './settings.tsx'
import { AmphoreusClientModel } from './state.ts'
import { seedConversationView } from './tabmemory.ts'
import { createSeatLayer, readDswTokens, registerGlobalTheme } from './theme.ts'
import { WorkbenchView, type WorkbenchViewInjected } from './workbench.tsx'
import { createWorkspacesSource } from './workspaces-source.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-amphoreus copy. */
    amphoreus: AmphoreusKey
  }
}

export const inject = ['slots', 'locale', 'theme', 'sessions', 'uiConversation']

export function apply(ctx: ClientContext): void {
  const model = new AmphoreusClientModel()
  const themeBridge = {
    read: readDswTokens,
    isDark: () => ctx.theme.getTheme().active.colorScheme === 'dark',
    subscribe: (listener: () => void) => ctx.on('theme/change', () => listener()),
  }
  const magazineBridge = {
    mode: () => model.getSnapshot().state?.effectiveConfig.magazineMode ?? 'light',
    subscribe: (listener: () => void) => model.subscribe(listener),
  }
  const seatLayer = createSeatLayer(ctx, model)
  const setSeat = seatLayer.apply.bind(seatLayer)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'amphoreus: dictionaries')
  const workspaces = createWorkspacesSource(
    ctx.sessions.list as unknown as Parameters<typeof createWorkspacesSource>[0],
    model,
  )
  const seatDeps: SeatActionDeps = {
    nonce: () => model.getSnapshot().state?.nonce ?? window.__AMPHOREUS_BOOT__?.nonce,
    seatDirOf: skillName => model.getSnapshot().state?.seatDirs.find(directory => directory.skillName === skillName)?.dir,
    sessions: ctx.sessions as unknown as SeatActionDeps['sessions'],
  }
  const bootWorkbench = window.__AMPHOREUS_BOOT__?.workbench
  const workbenchEnabled = bootWorkbench?.enabled ?? true
  ctx.effect(() => registerGlobalTheme(ctx, model), 'amphoreus: global theme')
  ctx.effect(() => () => seatLayer.dispose(), 'amphoreus: seat theme')
  ctx.effect(async () => {
    await model.start()
    return () => model.close()
  }, 'amphoreus: state channel')
  if (workbenchEnabled) {
    ctx.effect(() => {
      const defaultViewOf = (): 'chat' | 'workbench' =>
        model.getSnapshot().state?.effectiveConfig.workbench.defaultView
          ?? bootWorkbench?.defaultView ?? 'chat'
      const list = ctx.sessions.list as unknown as {
        getSnapshot(): { current: string | undefined }
        subscribe(fn: () => void): () => void
      }
      let last = list.getSnapshot().current
      if (last !== undefined) seedConversationView(localStorage, last, defaultViewOf())
      return list.subscribe(() => {
        const current = list.getSnapshot().current
        if (current === last) return
        last = current
        if (current !== undefined) seedConversationView(localStorage, current, defaultViewOf())
      })
    }, 'amphoreus: workbench default view')
  }

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

  if (workbenchEnabled) {
    // Workbench as a second conversation view (id/order shape mirrors ui-trajectory).
    type SessionFeed = Exclude<ReturnType<WorkbenchViewInjected['sessionFace']>, undefined>
    const sessionAdapter = ctx.sessions as unknown as {
      binding(id: SessionId): { session: SessionFeed } | undefined
    }
    ctx.slots.inject('conversation.view', () => ctx.slots.register({
      name: 'conversation.view',
      id: 'amphoreus-workbench',
      order: 20,
      locale: NS,
      label: () => t('view.workbench'),
      inject: (): WorkbenchViewInjected => ({
        sessions: ctx.sessions as unknown as WorkbenchViewInjected['sessions'],
        workspaces,
        conversationFeed: (sessionId) => {
          try {
            return ctx.uiConversation.binding(sessionId as SessionId).target('chat')
          } catch {
            return undefined
          }
        },
        sessionFace: sessionId => sessionAdapter.binding(sessionId as SessionId)?.session,
        config: model,
        theme: themeBridge,
        setSeat,
        magazine: magazineBridge,
        startSeatSession: skillName => startSeatSession(seatDeps, skillName, { open: false }),
      }),
    }, WorkbenchView))
  }
}
