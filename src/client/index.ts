/** dsh-amphoreus browser half. Components receive injected faces, never ctx. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { HeroBrandMark, SidebarBrandMark, SidebarBrandName } from './brand.tsx'
import { BRAND_ICON_DATA_URL, BRAND_MANIFEST_DATA_URL } from './brand-icon.ts'
import { installShellBrand } from './brand-shell.ts'
import { installGarnish } from './garnish.ts'
import { createEnterSeatQueue } from './enter-seat-queue.ts'
import type { HandoffDeps } from './handoff.ts'
import { HandoffDock } from './handoff-dock.tsx'
import { en, NS, zh, type AmphoreusKey } from './locales.ts'
import { SeatNameplate } from './nameplate.tsx'
import { PipelineRail } from './pipeline-rail.tsx'
import { PortalFooterAction, PortalOverlay, type PortalFooterInjected, type PortalOverlayInjected } from './portal.tsx'
import { createPortalStore } from './portal-store.ts'
import { createSeatWatch } from './seat-watch.ts'
import { createGrammarLayer, grammarVariablesFor } from './grammar-layer.ts'
import { createDirectChatRequests, openDirectSeatChat, startSeatSession } from './seat-actions.ts'
import { assertSessionUnarchived, createSessionArchiveAction } from './session-archive.ts'
import { SeatBrowser, type SeatBrowserInjected } from './seat-browser.tsx'
import { seatViewsFrom } from './seat-model.ts'
import { AmphoreusSettings } from './settings.tsx'
import { AmphoreusClientModel } from './state.ts'
import { readRememberedTab, seedConversationView, WORKBENCH_VIEW_ID } from './tabmemory.ts'
import { createSeatLayer, readDswTokens, registerGlobalTheme, registerSeatTheme } from './theme.ts'
import { WorkbenchView, type SessionsFace, type WorkbenchViewInjected } from './workbench.tsx'
import { createWorkspacesSource } from './workspaces-source.ts'
import { currentOrdinaryWorkspace, orphanSeatWorkspacePath, syncWorkspaceSession, waitForReadySnapshot } from './workspace-routing.ts'
import { heroVisualById } from '../shared/heroes.ts'
// @anchor client-imports
import { createSuiteNoticeStore, safeSessionStorage } from './suite-notice-store.ts'
import { SuiteNoticeBanner, type SuiteNoticeInjected } from './suite-notice.tsx'
import { createSeatCommandSource } from './seat-command.ts'
import { installSeatHotkeys } from './seat-hotkeys.ts'
import type { SeatView } from './seat-model.ts'
import { createSeatStartGuard } from './seat-start-guard.ts'
import { orderedHotkeySeats } from './seat-switch.ts'
import { createSeatPresetApplier, parseDefaultModelUser } from './seat-preset-apply.ts'
import { createSeatSoundPlayer, installSeatSounds } from './seat-sounds.ts'
import { SendSound } from './send-sound.tsx'
import { bindSetupStore, createSetupStore, watchSetupAutoOpen } from './setup-store.ts'
import { registerSetupOverlay, type SetupWizardInjected } from './setup-wizard.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-amphoreus copy. */
    amphoreus: AmphoreusKey
  }
}

export const inject = ['slots', 'locale', 'theme', 'sessions', 'uiConversation', 'workspaces', 'uiWorkspace', 'remote', 'remote.session']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'amphoreus: dictionaries')
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
  const t = ctx.locale.bind(NS)
  ctx.effect(() => registerGlobalTheme(ctx, model), 'amphoreus: global theme')
  const seatLayer = createSeatLayer(ctx, model)
  ctx.effect(() => () => seatLayer.dispose(), 'amphoreus: seat theme')
  const seatTheme = registerSeatTheme(
    ctx,
    model,
    ctx.sessions as unknown as Parameters<typeof registerSeatTheme>[2],
    seatLayer,
  )
  ctx.effect(() => () => seatTheme.dispose(), 'amphoreus: seat wallpaper')
  const seatWatch = createSeatWatch()
  ctx.effect(() => () => seatWatch.dispose(), 'amphoreus: seat watch')
  // Seat visual grammar: --amph-* variables + data-amph-* hooks; fully retractable.
  const grammarLayer = createGrammarLayer({
    seat: seatWatch,
    isDark: themeBridge.isDark,
    subscribeTheme: themeBridge.subscribe,
    prefs: () => model.getSnapshot().state?.effectiveConfig.grammar,
    subscribePrefs: listener => model.subscribe(listener),
    assets: () => {
      const state = model.getSnapshot().state
      return state === undefined ? undefined : { derived: state.assets.derived, assetsConfigured: state.effectiveConfig.assetsConfigured }
    },
  })
  ctx.effect(() => () => grammarLayer.dispose(), 'amphoreus: grammar layer')
  const grammarBridge = {
    read: () => {
      const snapshot = grammarLayer.getSnapshot()
      return {
        enabled: snapshot.prefs.enabled,
        heroId: snapshot.heroId,
        display: snapshot.grammar.typography.display,
        ambient: snapshot.prefs.ambient ? snapshot.grammar.ambient : 'none',
        variables: snapshot.prefs.enabled ? grammarVariablesFor(snapshot) : {},
      }
    },
    subscribe: (listener: () => void) => grammarLayer.subscribe(listener),
  }
  const portal = createPortalStore()
  const openPortal = portal.open
  const enterSeatQueue = createEnterSeatQueue()
  const directChatRequests = createDirectChatRequests()
  const workspaces = createWorkspacesSource(
    ctx.sessions.list as unknown as Parameters<typeof createWorkspacesSource>[0],
    model,
    ctx.workspaces.list,
  )
  const sessionsFace = ctx.sessions as unknown as SessionsFace
  const archiveSession = createSessionArchiveAction({
    archive: sessionId => ctx.workspaces.archiveSession(sessionId as SessionId),
    current: () => sessionsFace.list.getSnapshot().current,
    clear: () => (ctx.sessions as unknown as { clear(): void }).clear(),
  })
  const sessionList = ctx.sessions.list as unknown as {
    getSnapshot(): { phase: 'pending' | 'ready' }
    subscribe(listener: () => void): () => void
  }
  const ensureWorkspaceAt = async (path: string): Promise<string> => (
    await ctx.workspaces.create({ path })
  ).workspaceId
  const ensureSeatWorkspace = async (skillName: string): Promise<string | undefined> => {
    await Promise.all([
      waitForReadySnapshot(model, '席位'),
      waitForReadySnapshot(sessionList, '会话'),
      waitForReadySnapshot(ctx.workspaces.list, '工作区'),
    ])
    const dir = model.getSnapshot().state?.seatDirs.find(item => item.skillName === skillName)?.dir
    if (dir === undefined) throw new Error('席位目录尚未就绪，请重新部署此席位')
    const snapshot = ctx.workspaces.list.getSnapshot()
    const seatDirectories = (model.getSnapshot().state?.seatDirs ?? []).map(item => item.dir)
    const current = sessionsFace.list.getSnapshot().current
    const currentWorkspace = currentOrdinaryWorkspace(snapshot.items, seatDirectories, current)
    return currentWorkspace?.workspaceId ?? ensureWorkspaceAt(dir)
  }
  const createWorkspaceSession: HandoffDeps['sessions']['create'] = async options => {
    const sessionId = await sessionsFace.create(options)
    if (options.workspaceId !== undefined) await syncWorkspaceSession(ctx.workspaces, options.workspaceId, sessionId)
    return sessionId
  }
  const seatDeps: HandoffDeps = {
    nonce: () => model.getSnapshot().state?.nonce ?? window.__AMPHOREUS_BOOT__?.nonce,
    seatDirOf: skillName => model.getSnapshot().state?.seatDirs.find(directory => directory.skillName === skillName)?.dir,
    ensureSeatWorkspace,
    ensureSessionWorkspace: (sessionId, workspaceId) => syncWorkspaceSession(ctx.workspaces, workspaceId, sessionId),
    sessions: {
      create: options => sessionsFace.create(options),
      open: sessionId => sessionsFace.open(sessionId),
      fork: options => sessionsFace.fork(options),
      binding: sessionId => sessionsFace.binding(sessionId),
    },
  }
  // Seat presets: three independent tiers landed on a fresh blank seat session
  // (agent preset / model / permission-on-host). Optional remote faces attach
  // through inject scopes so a deployment without them degrades to "default".
  const seatPresetApplier = createSeatPresetApplier({
    presetOf: skillName => model.getSnapshot().state?.seats.find(seat => seat.skillName === skillName)?.preset,
    selectModel: request => ctx.remote.session.selectModel({
      sessionId: request.sessionId as SessionId,
      provider: request.provider,
      model: request.model,
      ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
    }),
    modelCatalog: () => ctx.remote.session.modelCatalog(),
  })
  seatDeps.applySeatPreset = (sessionId, skillName) => seatPresetApplier.apply(sessionId, skillName)
  model.presetDirectory = seatPresetApplier
  ctx.inject(['remote.agentPresets'], scope => {
    scope.effect(() => seatPresetApplier.attach({
      selectAgentPreset: (sessionId, agentPreset) => scope.remote.agentPresets.select(sessionId as SessionId, agentPreset),
      listAgentPresets: () => scope.remote.agentPresets.list(),
    }), 'amphoreus: seat preset roster')
  })
  ctx.inject(['remote.settings'], scope => {
    scope.effect(() => seatPresetApplier.attach({
      // selectModel also rewrites this namespace (core/agent-default-model saveSelection → settings.replace).
      // Read the raw user layer + revision around the select and write the prior section back revision-checked.
      describeDefaultModel: async () => {
        const described = await scope.remote.settings.describe()
        if (!described.ok) return described
        const view = described.value.namespaces.find(namespace => namespace.ns === 'agent-default-model')
        return { ok: true, value: view === undefined ? undefined : { user: parseDefaultModelUser(view.user), revision: view.revision } }
      },
      restoreDefaultModel: (section, expectedRevision) => scope.remote.settings.replace('agent-default-model', {
        ...(section === undefined ? {} : {
          provider: section.provider,
          model: section.model,
          ...(section.reasoningEffort === undefined ? {} : { reasoningEffort: section.reasoningEffort }),
        }),
      }, expectedRevision),
    }), 'amphoreus: seat preset default-model restore')
  })
  type SessionFeed = Exclude<ReturnType<WorkbenchViewInjected['sessionFace']>, undefined>
  const sessionAdapter = ctx.sessions as unknown as {
    binding(id: SessionId): { session: SessionFeed } | undefined
  }
  const conversationFeed: NonNullable<WorkbenchViewInjected['conversationFeed']> = sessionId => {
    try {
      return ctx.uiConversation.binding(sessionId as SessionId).target('chat')
    } catch {
      return undefined
    }
  }
  const sessionFace: NonNullable<WorkbenchViewInjected['sessionFace']> = sessionId => (
    sessionAdapter.binding(sessionId as SessionId)?.session
  )
  const followSession: NonNullable<WorkbenchViewInjected['followSession']> = (sessionId, signal) => (
    ctx.remote.session.follow({ address: { kind: 'session', sessionId: sessionId as SessionId }, maxMessages: 50 }, signal)
  )
  const openBoundSeatSession = async (sessionId: string, skillName?: string, open = true): Promise<void> => {
    assertSessionUnarchived(sessionId, ctx.workspaces.list.getSnapshot().archivedSessionIds)
    if (skillName === undefined) {
      if (open) sessionsFace.open(sessionId)
      return
    }
    await Promise.all([
      waitForReadySnapshot(model, '席位'),
      waitForReadySnapshot(sessionList, '会话'),
      waitForReadySnapshot(ctx.workspaces.list, '工作区'),
    ])
    const summary = sessionsFace.list.getSnapshot().byId[sessionId]
    const seatDir = orphanSeatWorkspacePath(
      ctx.workspaces.list.getSnapshot().items, sessionId, summary?.cwd, seatDeps.seatDirOf(skillName),
    )
    if (seatDir !== undefined) {
      const workspaceId = await ensureWorkspaceAt(seatDir)
      const adopted = await createWorkspaceSession({ sessionId, workspaceId })
      if (adopted !== sessionId) throw new Error(`宿主返回了不同的会话 id（${adopted}）`)
    }
    assertSessionUnarchived(sessionId, ctx.workspaces.list.getSnapshot().archivedSessionIds)
    if (open) sessionsFace.open(sessionId)
  }
  const openDirectSession = (sessionId: string): void => openDirectSeatChat({
    store: localStorage,
    closePortal: portal.close,
    activateChat: id => ctx.uiConversation.binding(id as SessionId).activate('chat'),
    requests: directChatRequests,
    open: id => sessionsFace.open(id),
  }, sessionId)
  const startPortalSeatSession = (skillName: string): Promise<string> => startSeatSession(seatDeps, skillName)
  const openSeat = async (
    heroId: string | null,
    extra?: { readonly dispatchText?: string },
  ): Promise<boolean> => {
    if (heroId === null) {
      const dispatchText = extra?.dispatchText?.trim()
      const request = {
        workspaceId: 'all' as const,
        ...(dispatchText ? { dispatchText } : {}),
      }
      const current = sessionsFace.list.getSnapshot().current
      const currentSummary = current === undefined ? undefined : sessionsFace.list.getSnapshot().byId[current]
      if (current !== undefined && currentSummary?.blank === false
        && readRememberedTab(localStorage) === WORKBENCH_VIEW_ID) {
        portal.close()
        enterSeatQueue.set(request)
        return true
      }
      // alpha.4 intentionally hides every View for a blank Session. Keep the
      // already-mounted portal iframe as the total-space canvas host instead.
      return false
    }
    portal.close()
    const state = model.getSnapshot().state
    if (state === undefined) return true
    const skill = heroVisualById(heroId)?.skill ?? state.seats.find(seat => seat.heroId === heroId)?.skillName
    if (skill === undefined) return true
    const view = seatViewsFrom(
      model.getSnapshot(),
      sessionsFace.list.getSnapshot() as unknown as Parameters<typeof seatViewsFrom>[1],
      ctx.workspaces.list.getSnapshot(),
    ).find(candidate => candidate.skillName === skill)
    if (view !== undefined && view.sessionIds.length > 0) await openBoundSeatSession(view.sessionIds[0]!, skill)
    else await startPortalSeatSession(skill)
    return true
  }
  // @anchor client-services
  // Suite-change notices derive from the single model channel (no second EventSource).
  const suiteNotice = createSuiteNoticeStore({
    model,
    boot: window.__AMPHOREUS_BOOT__,
    storage: safeSessionStorage(),
    archivedSessionIds: () => ctx.workspaces.list.getSnapshot().archivedSessionIds,
  })
  ctx.effect(() => () => suiteNotice.dispose(), 'amphoreus: suite notice')
  // seat-switch: begin
  // Seat switching (Alt+digit hotkeys + `/seat <name>`): same landing as the sidebar — chat view of the latest bound session, or a fresh seat session.
  const currentSeatViews = (): SeatView[] => seatViewsFrom(
    model.getSnapshot(),
    sessionsFace.list.getSnapshot() as unknown as Parameters<typeof seatViewsFrom>[1],
    ctx.workspaces.list.getSnapshot(),
  )
  // Stays busy until the snapshot shows the new session, so hotkey / `/seat` presses cannot double-start a seat.
  const seatStartGuard = createSeatStartGuard({
    hasSession: skillName => currentSeatViews().some(view => view.skillName === skillName && view.sessionIds.length > 0),
  })
  const enterSeatView = async (view: SeatView): Promise<void> => {
    const latest = view.sessionIds[0]
    if (latest !== undefined) {
      await openBoundSeatSession(latest, view.skillName, false)
      openDirectSession(latest)
      return
    }
    await seatStartGuard.run(view.skillName, async () => {
      const created = await startSeatSession(seatDeps, view.skillName, { open: false })
      openDirectSession(created)
    })
  }
  ctx.effect(() => installSeatHotkeys({
    target: window,
    seats: () => orderedHotkeySeats(currentSeatViews()),
    enter: enterSeatView,
    togglePortal: portal.toggle,
    isBusy: seatStartGuard.isBusy,
    // The setup wizard is aria-modal: Alt+digit / Alt+0 must not switch seats or open the portal underneath it.
    isSuspended: () => setup.getSnapshot().open,
    onError: error => { console.warn('[dsh-amphoreus] seat hotkey:', error) },
  }), 'amphoreus: seat hotkeys')
  // Degrade, don't gate: a profile without the slash pipeline still boots the plugin, only `/seat` is absent.
  ctx.inject(['inputTriggers'], scope => {
    scope.effect(() => scope.inputTriggers.registerSource(createSeatCommandSource({
      seats: currentSeatViews,
      cards: () => model.getSnapshot().state?.suite?.cards ?? [],
      enter: enterSeatView,
      openPortal: portal.open,
      t,
    })), 'amphoreus: /seat')
  })
  // seat-switch: end
  const bootWorkbench = window.__AMPHOREUS_BOOT__?.workbench
  const workbenchEnabled = bootWorkbench?.enabled ?? true
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
    ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -10, inject: () => ({ assetsConfigured, seat: seatWatch }) }, HeroBrandMark))

  // DOM garnish: seat-aware time-of-day greeting headline + chimera folder stickers.
  ctx.effect(() => installGarnish({ assetsConfigured, seat: seatWatch }), 'amphoreus: garnish')
  // Tab chrome: product title, favicon and web-app manifest become δ-me13 (no vendor residue).
  ctx.effect(() => installShellBrand({
    name: t('brand.name'),
    iconHref: BRAND_ICON_DATA_URL,
    manifestHref: BRAND_MANIFEST_DATA_URL,
  }), 'amphoreus: shell brand')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'amphoreus',
    order: 30,
    label: () => t('settings.nav'),
    locale: NS,
    inject: () => ({
      model,
      // @anchor settings-inject
      previewSound: (url: string, volume: number) => soundPlayer.play(url, volume),
    }),
  }, AmphoreusSettings))
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
    name: 'sidebar.workspaces',
    priority: -10,
    locale: NS,
    inject: (): SeatBrowserInjected => ({
      model,
      archiveSession,
      openSession: async (sessionId, skillName) => {
        await openBoundSeatSession(sessionId, skillName, skillName === undefined)
        if (skillName !== undefined) openDirectSession(sessionId)
      },
      startSeatSession: async skillName => {
        // Shares seatStartGuard with the hotkey / `/seat` paths: a start already in flight from
        // either side (or not yet visible in the snapshot) is not repeated from the sidebar.
        let sessionId: string | undefined
        await seatStartGuard.run(skillName, async () => {
          sessionId = await startSeatSession(seatDeps, skillName, { open: false })
          openDirectSession(sessionId)
        })
        return sessionId
      },
      startDirectorySession: workspaceId => ctx.uiWorkspace.startSession(workspaceId as WorkspaceId),
      removeDirectoryWorkspace: async workspaceId => {
        const result = await (ctx.workspaces as unknown as {
          delete(id: WorkspaceId): Promise<{ ok: boolean; error?: { message?: string } }>
        }).delete(workspaceId as WorkspaceId)
        if (!result.ok) throw new Error(result.error?.message ?? '移除目录工作区失败')
      },
      createDirectoryWorkspace: async fallbackPrompt => {
        let path: string | null
        try {
          path = await ctx.uiWorkspace.pickDirectory()
        } catch {
          path = fallbackPrompt()
        }
        if (path === null || path.trim() === '') return
        const workspace = await ctx.workspaces.create({ path: path.trim() })
        ctx.uiWorkspace.startSession(workspace.workspaceId)
      },
    }),
  }, SeatBrowser))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'amphoreus-nameplate',
    order: -20,
    locale: NS,
    inject: () => ({ model }),
  }, SeatNameplate))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'amphoreus-rail',
    order: 10,
    locale: NS,
    inject: (sessionId: string) => ({
      model,
      seatDeps,
      sessionId,
      cwdOf: (id: string) => (ctx.sessions.list as unknown as {
        getSnapshot(): { byId: Record<string, { cwd?: string } | undefined> }
      }).getSnapshot().byId[id]?.cwd,
    }),
  }, PipelineRail))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'amphoreus-portal',
    order: 0,
    locale: NS,
    inject: (): PortalFooterInjected => ({ portal, assetsConfigured }),
  }, PortalFooterAction))
  // shell.overlay is declared once; every overlay entry registers inside this single callback (assembly test pins the call list).
  ctx.slots.inject('shell.overlay', () => [ctx.slots.register({
    name: 'shell.overlay',
    id: 'amphoreus-portal',
    order: 0,
    locale: NS,
    inject: (): PortalOverlayInjected => ({
      portal,
      model,
      sessions: sessionsFace,
      workspaces,
      conversationFeed,
      sessionFace,
      followSession,
      startSeatSession: startPortalSeatSession,
      seatDeps,
      setSeat: seatTheme.hint,
      theme: themeBridge,
      magazine: magazineBridge,
      grammar: grammarBridge,
      openSeat,
    }),
  }, PortalOverlay),
  // @anchor shell-overlay-entries
  ctx.slots.register({
    name: 'shell.overlay',
    id: 'amphoreus-suite-notice',
    order: 10,
    locale: NS,
    inject: (): SuiteNoticeInjected => ({
      store: suiteNotice,
      model,
      portalOpen: () => portal.getSnapshot().open,
      subscribePortal: portal.subscribe,
      // `setup` is declared below (inject factories run at render, never during apply).
      setupOpen: () => setup.getSnapshot().open,
      subscribeSetup: listener => setup.subscribe(listener),
    }),
  }, SuiteNoticeBanner),
  registerSetupOverlay(ctx.slots, (): SetupWizardInjected => ({
    setup,
    model,
    pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
    listDirectory: path => ctx.uiWorkspace.listDirectory(path),
  })),
  ])

  if (workbenchEnabled) {
    // Workbench as a second conversation view (id/order shape mirrors ui-trajectory).
    ctx.slots.inject('conversation.view', () => ctx.slots.register({
      name: 'conversation.view',
      id: 'amphoreus-workbench',
      order: 20,
      locale: NS,
      label: () => t('view.workbench'),
      inject: (): WorkbenchViewInjected => ({
        sessions: ctx.sessions as unknown as WorkbenchViewInjected['sessions'],
        workspaces,
        conversationFeed,
        sessionFace,
        followSession,
        directChatRequests,
        model,
        theme: themeBridge,
        setSeat: seatTheme.hint,
        magazine: magazineBridge,
        grammar: grammarBridge,
        startSeatSession: skillName => startSeatSession(seatDeps, skillName, { open: false }),
        seatDeps,
        enterSeatQueue,
        openPortal,
      }),
    }, WorkbenchView))
  }
  // @anchor client-slots
  // Seat sounds: user uploads only; greeting on seat enter (deferred until the first gesture), send click via the input dock sentinel below.
  // (Lives here, not at client-services: tests/client-portal.test.ts vm-evaluates the openSeat…bootWorkbench slice.)
  const soundPlayer = createSeatSoundPlayer()
  ctx.effect(() => () => soundPlayer.dispose(), 'amphoreus: seat sound player')
  ctx.effect(() => installSeatSounds({ seat: seatWatch, model, player: soundPlayer }), 'amphoreus: seat sounds')
  // conversation.input.dock is declared once; every dock entry registers inside this single callback (assembly test pins the call list).
  // Setup wizard store: declared after the overlay/settings registrations that close over it (inject factories run at render, never during apply).
  const setup = createSetupStore()
  bindSetupStore(model, setup)
  ctx.effect(() => watchSetupAutoOpen(model, setup), 'amphoreus: setup wizard auto-open')
  ctx.slots.inject('conversation.input.dock', () => [ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'amphoreus-handoff',
    order: 30,
    locale: NS,
    inject: () => ({ model, seatDeps }),
  }, HandoffDock), ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'amphoreus-send-sound',
    order: 31,
    inject: () => ({ player: soundPlayer, model, seat: seatWatch }),
  }, SendSound)])
  // @anchor client-tail
}
