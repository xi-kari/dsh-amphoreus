import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SelectedSessionList } from './session-adapter.ts'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'
import { CUSTOM_WALLPAPER_PLACEMENT_DEFAULTS, type AmphoreusState, type CustomWallpaperInfo } from '../shared/api.ts'
import { heroVisualById, heroVisualOf, type HeroVisual } from '../shared/heroes.ts'
import { DSW_BRIDGED_TOKENS } from '../shared/tokens.ts'
import { bindingIndex, currentSeatOf, GLOBAL_SEAT_HERO } from './seat-model.ts'
import { seatCodeTokens, seatThemeTokens, shouldApplySeatLayer } from './seat-theme.ts'
import { clampMask, cssUrl, seatMaskFactor, seatWallpaperCandidates } from './seat-wallpaper.ts'
import type { AmphoreusClientModel } from './state.ts'

const LIGHT_BASE = [244, 242, 248] as const
const DARK_BASE = [26, 22, 49] as const

export type BridgedTokens = Record<string, string>

/** Read the 87 bridged tokens from body computed styles, omitting empty values. */
export function readDswTokens(read: (name: string) => string = defaultRead): BridgedTokens {
  const out: BridgedTokens = {}
  for (const name of DSW_BRIDGED_TOKENS) {
    const value = read(name).trim()
    if (value !== '') out[name] = value
  }
  return out
}

function defaultRead(name: string): string {
  return getComputedStyle(document.body).getPropertyValue(name)
}

export function globalThemeTokens(lightAlpha = 0.22, darkAlpha = 0.4): ThemeTokenOverrides {
  const surface = { light: rgba(LIGHT_BASE, lightAlpha), dark: rgba(DARK_BASE, darkAlpha) }
  return {
    '--dsw-alias-bg-base': surface,
    '--dsw-specific-sidebar-fill': { light: rgba(LIGHT_BASE, lightAlpha - 0.12), dark: rgba(DARK_BASE, darkAlpha - 0.12) },
    '--dsw-alias-bg-layer-1': { light: 'rgba(250, 249, 252, 0.76)', dark: 'rgba(35, 30, 63, 0.78)' },
    '--dsw-alias-bg-layer-2': { light: 'rgba(247, 245, 250, 0.86)', dark: 'rgba(43, 37, 74, 0.86)' },
    '--dsw-alias-bg-layer-3': { light: 'rgba(253, 252, 254, 0.94)', dark: 'rgba(51, 44, 84, 0.94)' },
    '--dsw-alias-border-l1': { light: 'rgba(138, 104, 28, 0.12)', dark: 'rgba(208, 177, 102, 0.14)' },
    '--dsw-alias-border-l2': { light: 'rgba(138, 104, 28, 0.24)', dark: 'rgba(208, 177, 102, 0.25)' },
    '--dsw-alias-border-l3': { light: 'rgba(138, 104, 28, 0.4)', dark: 'rgba(208, 177, 102, 0.38)' },
    '--dsw-alias-brand-primary': { light: 'rgb(138, 104, 28)', dark: 'rgb(208, 177, 102)' },
    '--dsw-alias-brand-primary-invert': { light: 'rgb(250, 248, 242)', dark: 'rgb(26, 22, 49)' },
    '--dsw-alias-brand-text': { light: 'rgb(55, 48, 94)', dark: 'rgb(244, 242, 248)' },
    '--dsw-alias-label-primary': { light: 'rgb(55, 48, 94)', dark: 'rgb(244, 242, 248)' },
    '--dsw-alias-label-secondary': { light: 'rgb(83, 75, 119)', dark: 'rgb(213, 207, 226)' },
    '--dsw-alias-label-tertiary': { light: 'rgb(111, 103, 143)', dark: 'rgb(178, 169, 201)' },
    '--dsw-alias-label-caption': { light: 'rgb(126, 117, 154)', dark: 'rgb(154, 145, 179)' },
    '--dsw-alias-button-primary-fill': { light: 'rgb(55, 48, 94)', dark: 'rgb(104, 91, 154)' },
    '--dsw-alias-button-primary-hover': { light: 'rgb(43, 37, 77)', dark: 'rgb(122, 107, 177)' },
    '--dsw-alias-button-primary-dimmed': { light: 'rgba(55, 48, 94, 0.16)', dark: 'rgba(244, 242, 248, 0.16)' },
    '--dsw-alias-button-elevated-fill': { light: 'rgba(253, 252, 254, 0.86)', dark: 'rgba(48, 41, 79, 0.88)' },
    '--dsw-alias-button-floating-fill': { light: 'rgba(253, 252, 254, 0.9)', dark: 'rgba(43, 37, 73, 0.9)' },
    '--dsw-alias-button-floating-hover': { light: 'rgba(244, 242, 248, 0.94)', dark: 'rgba(61, 52, 96, 0.94)' },
    '--dsw-alias-interactive-bg-hover': { light: 'rgba(55, 48, 94, 0.07)', dark: 'rgba(244, 242, 248, 0.09)' },
    '--dsw-alias-interactive-bg-active': { light: 'rgba(138, 104, 28, 0.13)', dark: 'rgba(208, 177, 102, 0.15)' },
    '--dsw-alias-interactive-bg-hover-accent': { light: 'rgba(138, 104, 28, 0.17)', dark: 'rgba(208, 177, 102, 0.2)' },
    '--dsw-specific-sidebar-nav-item-active': { light: 'rgba(138, 104, 28, 0.13)', dark: 'rgba(208, 177, 102, 0.15)' },
    '--dsw-specific-sidebar-nav-item-active-accent': { light: 'rgba(138, 104, 28, 0.22)', dark: 'rgba(208, 177, 102, 0.22)' },
    '--dsw-specific-sidebar-nav-item-hover': { light: 'rgba(55, 48, 94, 0.07)', dark: 'rgba(244, 242, 248, 0.09)' },
    '--dsw-specific-input-major': { light: 'rgba(253, 252, 254, 0.84)', dark: 'rgba(43, 37, 73, 0.86)' },
    '--dsw-specific-bubble': { light: 'rgba(244, 242, 248, 0.8)', dark: 'rgba(48, 41, 79, 0.84)' },
    '--dsw-specific-bubble-highlight': { light: 'rgba(235, 229, 241, 0.9)', dark: 'rgba(65, 55, 101, 0.9)' },
    '--dsw-specific-menu': { light: 'rgba(253, 252, 254, 0.95)', dark: 'rgba(51, 44, 84, 0.96)' },
    '--dsw-specific-selector': { light: 'rgba(239, 235, 244, 0.9)', dark: 'rgba(58, 49, 92, 0.92)' },
    '--dsw-specific-tip': { light: 'rgba(246, 243, 249, 0.92)', dark: 'rgba(50, 43, 82, 0.94)' },
  }
}

export function registerGlobalTheme(ctx: ClientContext, model: AmphoreusClientModel): () => void {
  let currentAlpha = ''
  let disposeLayer = () => {}
  const apply = (): void => {
    const wallpaper = model.getSnapshot().state?.effectiveConfig.wallpaper
    const light = wallpaper?.surfaceAlpha.light ?? 0.22
    const dark = wallpaper?.surfaceAlpha.dark ?? 0.4
    const key = `${light}/${dark}`
    if (key !== currentAlpha) {
      currentAlpha = key
      disposeLayer()
      disposeLayer = ctx.theme.overrideTokens('dsh-amphoreus/global', globalThemeTokens(light, dark))
    }
    const state = model.getSnapshot().state
    const layer = document.getElementById('amphoreus-wallpaper')
    if (layer instanceof HTMLElement && state !== undefined) {
      layer.hidden = !state.effectiveConfig.wallpaper.enabled
      layer.dataset.revision = String(state.revision)
    }
    if (state !== undefined) document.body.dataset.amphoreusWallpaper = state.effectiveConfig.wallpaper.enabled ? 'on' : 'off'
    if (state?.suite !== undefined) document.body.dataset.amphoreusSuite = state.suite.level
  }
  apply()
  const unsubscribe = model.subscribe(apply)
  return () => {
    unsubscribe()
    disposeLayer()
    delete document.body.dataset.amphoreusSuite
    delete document.body.dataset.amphoreusWallpaper
  }
}

export interface SeatLayer {
  apply(heroId: string | null): void
  current(): string | null
  dispose(): void
}

export function createSeatLayer(ctx: ClientContext, model: AmphoreusClientModel): SeatLayer {
  let selectedHeroId: string | null = null
  let ownsSelection = false
  let appliedKey = ''
  let disposeLayer = () => {}
  let disposed = false

  const clearLayer = (clearSeatIntent = ownsSelection): void => {
    disposeLayer()
    disposeLayer = () => {}
    appliedKey = ''
    if (clearSeatIntent) delete document.body.dataset.amphoreusSeat
  }

  const reconcile = (): void => {
    if (disposed) return
    const config = model.getSnapshot().state?.effectiveConfig
    const heroId = selectedHeroId
    if (config === undefined || heroId === null || !shouldApplySeatLayer(heroId, config.seatStyle)) {
      clearLayer()
      return
    }
    const visual = heroVisualById(heroId)
    if (visual === undefined) {
      clearLayer()
      return
    }
    const { light, dark } = config.wallpaper.surfaceAlpha
    const key = `${heroId}/${light}/${dark}`
    if (key === appliedKey) {
      document.body.dataset.amphoreusSeat = heroId
      return
    }
    const disposeTokens = ctx.theme.overrideTokens(
      'dsh-amphoreus/seat',
      seatThemeTokens(visual, { light, dark }),
    )
    const disposeCode = ctx.theme.overrideTokens('dsh-amphoreus/seat-code', seatCodeTokens(visual))
    const nextDispose = (): void => {
      disposeCode()
      disposeTokens()
    }
    const previousDispose = disposeLayer
    disposeLayer = nextDispose
    appliedKey = key
    previousDispose()
    document.body.dataset.amphoreusSeat = heroId
  }

  const configKey = (): string => {
    const config = model.getSnapshot().state?.effectiveConfig
    if (config === undefined) return 'loading'
    return `${config.seatStyle}/${config.wallpaper.surfaceAlpha.light}/${config.wallpaper.surfaceAlpha.dark}`
  }
  let lastConfigKey = configKey()
  const unsubscribe = model.subscribe(() => {
    const nextConfigKey = configKey()
    if (nextConfigKey === lastConfigKey) return
    lastConfigKey = nextConfigKey
    reconcile()
  })

  const apply = (heroId: string | null): void => {
    if (disposed) return
    ownsSelection = true
    selectedHeroId = heroId
    reconcile()
  }
  const current = (): string | null => selectedHeroId
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    unsubscribe()
    ownsSelection = true
    selectedHeroId = null
    clearLayer(true)
  }
  return { apply, current, dispose }
}

export interface SeatThemeController {
  hint(heroId: string | null): void
  dispose(): void
}

interface SeatHint {
  readonly sessionId: string | undefined
  readonly heroId: string | null
}

interface SeatVisualPlan {
  readonly key: string
  readonly hero: HeroVisual | null
  readonly candidates: readonly string[]
  readonly darkMask: number
  readonly lightMask: number
  /** User-supplied wallpaper for this seat, if any (drives video + placement). */
  readonly custom?: CustomWallpaperInfo
}

const PLACEMENT_VARS = ['--amph-wp-fit', '--amph-wp-x', '--amph-wp-y', '--amph-wp-scale'] as const

function applyPlacement(custom: CustomWallpaperInfo | undefined): void {
  const style = document.body.style
  if (custom === undefined) {
    for (const name of PLACEMENT_VARS) style.removeProperty(name)
    return
  }
  const p = { ...CUSTOM_WALLPAPER_PLACEMENT_DEFAULTS, ...custom.placement }
  style.setProperty('--amph-wp-fit', p.fit === 'fill' ? '100% 100%' : p.fit)
  style.setProperty('--amph-wp-x', `${p.x}%`)
  style.setProperty('--amph-wp-y', `${p.y}%`)
  style.setProperty('--amph-wp-scale', String(p.scale))
}

const videoPauseIntent = new WeakMap<HTMLVideoElement, boolean>()

function releaseVideo(video: HTMLVideoElement): void {
  videoPauseIntent.delete(video)
  video.pause()
  video.removeAttribute('src')
  video.load()
  video.remove()
}

function createWallpaperVideo(): HTMLVideoElement {
  const video = document.createElement('video')
  video.className = 'amph-seat-video'
  video.setAttribute('aria-hidden', 'true')
  video.playsInline = true
  video.disablePictureInPicture = true
  video.preload = 'auto'
  video.muted = true
  video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;object-fit:var(--amph-wp-fit-video, cover);object-position:var(--amph-wp-x, 50%) var(--amph-wp-y, 40%);transform:scale(var(--amph-wp-scale, 1));transition:opacity 240ms ease;'
  return video
}

function configureVideo(video: HTMLVideoElement, custom: CustomWallpaperInfo): void {
  const p = { ...CUSTOM_WALLPAPER_PLACEMENT_DEFAULTS, ...custom.placement }
  if (video.getAttribute('src') !== custom.url) {
    video.setAttribute('src', custom.url)
    video.load()
  }
  video.muted = p.muted
  video.loop = p.loop
  video.playbackRate = p.playbackRate
  video.style.setProperty('--amph-wp-fit-video', p.fit)
  video.style.setProperty('--amph-wp-x', `${p.x}%`)
  video.style.setProperty('--amph-wp-y', `${p.y}%`)
  video.style.setProperty('--amph-wp-scale', String(p.scale))
  videoPauseIntent.set(video, p.paused)
  if (p.paused || document.visibilityState === 'hidden') video.pause()
  else void video.play().catch(() => { /* autoplay policy: stays on first frame */ })
}

/** Mount or update the seat video element inside the wallpaper layer; returns whether one is showing. */
function syncVideo(layer: HTMLElement | null, custom: CustomWallpaperInfo | undefined): boolean {
  if (layer === null) return false
  let video = layer.querySelector<HTMLVideoElement>('video.amph-seat-video')
  if (custom === undefined || custom.kind !== 'video') {
    if (video !== null) releaseVideo(video)
    return false
  }
  if (video === null) {
    video = createWallpaperVideo()
    layer.appendChild(video)
  }
  configureVideo(video, custom)
  return true
}

interface TransitionResult {
  readonly incoming: HTMLElement
  readonly outgoing: HTMLElement
  readonly nextSlot: 0 | 1
}

const NOOP = (): void => {}
const CANCELED = Symbol('seat-wallpaper-canceled')

export function registerSeatTheme(
  _ctx: ClientContext,
  model: AmphoreusClientModel,
  sessions: { readonly list: ObservableSnapshot<SelectedSessionList> },
  seatLayer: SeatLayer,
): SeatThemeController {
  let disposed = false
  let generation = 0
  let appliedKey: string | null = null
  let pendingKey: string | null = null
  let activeSlot: 0 | 1 = 0
  let disposeCurrent = NOOP
  let appliedIntent: string | null | undefined
  const initialSessionId: string | undefined = sessions.list.getSnapshot().current
  let lastSessionId = initialSessionId
  const firstFrameHeroId = document.body.dataset.amphoreusSeat
  let bootstrapHeroId = initialSessionId === undefined
    && firstFrameHeroId !== undefined
    && firstFrameHeroId !== GLOBAL_SEAT_HERO
    && heroVisualById(firstFrameHeroId) !== undefined
    ? firstFrameHeroId
    : undefined
  let hinted: SeatHint | undefined

  const stale = (ownGeneration: number): boolean => disposed || ownGeneration !== generation

  const wallpaperLayer = (): HTMLElement | null => {
    const layer = document.getElementById('amphoreus-wallpaper')
    return layer instanceof HTMLElement ? layer : null
  }

  const syncVideoVisibility = (): void => {
    if (disposed) return
    const videos = [...wallpaperLayer()?.querySelectorAll<HTMLVideoElement>('video.amph-seat-video') ?? []]
    const active = videos.at(-1)
    for (const video of videos) {
      if (document.visibilityState === 'hidden' || video !== active || videoPauseIntent.get(video) !== false) video.pause()
      else void video.play().catch(() => {})
    }
  }
  document.addEventListener?.('visibilitychange', syncVideoVisibility)

  const clearTransition = (): void => {
    const dispose = disposeCurrent
    disposeCurrent = NOOP
    dispose()
  }

  const resetSeatSurface = (preserveVideo = false): void => {
    const layer = wallpaperLayer()
    if (!preserveVideo) syncVideo(layer, undefined)
    applyPlacement(undefined)
    if (layer !== null) {
      for (const slot of [0, 1] as const) {
        const seat = layer.querySelector<HTMLElement>(`.amphoreus-seat-layer[data-slot="${slot}"]`)
        if (seat === null) continue
        delete seat.dataset.active
        delete seat.dataset.incoming
        seat.style.backgroundImage = ''
      }
    }
    activeSlot = 0
  }

  const resetWallpaperSurface = (plan: SeatVisualPlan): void => {
    resetSeatSurface()
    const layer = wallpaperLayer()
    const state = model.getSnapshot().state
    const boot = state?.visualBoot ?? window.__AMPHOREUS_BOOT__
    const globalUrl = state?.effectiveConfig.wallpaper.enabled === false || state?.effectiveConfig.wallpaper.mode === 'none'
      ? undefined : boot?.wallpaper.url
    if (layer !== null) layer.style.setProperty('--amphoreus-wallpaper-url', globalUrl === undefined ? 'none' : cssUrl(globalUrl))
    document.body.style.setProperty('--amphoreus-dark-mask', String(plan.darkMask))
    document.body.style.setProperty('--amphoreus-light-mask', String(plan.lightMask))
  }

  const forgetSeat = (): void => {
    try {
      localStorage.removeItem('dsh-amphoreus:last-seat')
    } catch {}
  }

  const leaveSeat = (plan: SeatVisualPlan): void => {
    resetWallpaperSurface(plan)
    forgetSeat()
  }

  const rememberSeat = (heroId: string): void => {
    try {
      localStorage.setItem('dsh-amphoreus:last-seat', heroId)
    } catch {}
  }

  const planFor = (state: AmphoreusState, hero: HeroVisual | null, ownerHeroId: string | undefined, homeSeed: string | undefined): SeatVisualPlan => {
    const wallpaper = state.effectiveConfig.wallpaper
    const mode = wallpaper.mode ?? 'none'
    const derivedVersion = state.assets.lastDerive?.at
    const custom = mode !== 'custom' || !wallpaper.enabled ? undefined
      : (ownerHeroId === undefined ? undefined : (state.customWallpapers ?? []).find(item => item.heroId === ownerHeroId))
        ?? (state.customWallpapers ?? []).find(item => item.heroId === 'global')
    const customUrl = custom?.kind === 'image' ? custom.url : state.visualBoot?.wallpaper.url
    const candidates = wallpaper.enabled && mode !== 'none' && custom?.kind !== 'video'
      ? mode === 'custom' ? customUrl === undefined ? [] : [customUrl]
        : hero !== null && wallpaper.perSeat ? seatWallpaperCandidates(hero, {
        derived: state.assets.derived,
        assetsConfigured: state.effectiveConfig.assetsConfigured,
        ...(derivedVersion === undefined ? {} : { derivedVersion }),
        ...(homeSeed === undefined ? {} : { homeSeed }),
        }) : []
      : []
    return {
      key: JSON.stringify([
        hero?.heroId ?? null,
        ownerHeroId ?? null,
        mode,
        wallpaper.enabled,
        wallpaper.perSeat,
        wallpaper.darkMask,
        wallpaper.lightMask,
        candidates,
        custom === undefined ? null : [custom.url, custom.kind, custom.placement],
      ]),
      hero,
      candidates,
      darkMask: wallpaper.darkMask,
      lightMask: wallpaper.lightMask,
      ...(custom === undefined ? {} : { custom }),
    }
  }

  const decodeCandidate = async (url: string, ownGeneration: number): Promise<string | typeof CANCELED> => {
    const image = new Image()
    image.src = url
    let canceled = false
    let cancel!: () => void
    const canceledPromise = new Promise<typeof CANCELED>(resolve => {
      cancel = () => {
        if (canceled) return
        canceled = true
        image.src = ''
        resolve(CANCELED)
      }
    })
    disposeCurrent = cancel
    try {
      const result = await Promise.race([image.decode().then(() => url), canceledPromise])
      if (disposeCurrent === cancel) disposeCurrent = NOOP
      return stale(ownGeneration) ? CANCELED : result
    } catch (error) {
      if (disposeCurrent === cancel) disposeCurrent = NOOP
      if (stale(ownGeneration)) return CANCELED
      throw error
    }
  }

  const loadWallpaper = async (plan: SeatVisualPlan, ownGeneration: number): Promise<string | undefined> => {
    let lastError: unknown
    for (const candidate of plan.candidates) {
      try {
        const decoded = await decodeCandidate(candidate, ownGeneration)
        if (decoded === CANCELED) return undefined
        return decoded
      } catch (error) {
        lastError = error
      }
    }
    throw lastError ?? new Error('席位壁纸没有可用候选')
  }

  const loadVideo = async (custom: CustomWallpaperInfo, ownGeneration: number): Promise<HTMLVideoElement | typeof CANCELED> => {
    const video = createWallpaperVideo()
    let cancel = NOOP
    try {
      return await new Promise<HTMLVideoElement | typeof CANCELED>((resolve, reject) => {
        let settled = false
        let timer: number | undefined
        const finish = (error?: Error, canceled = false): void => {
          if (settled) return
          settled = true
          if (timer !== undefined) window.clearTimeout(timer)
          video.removeEventListener('loadeddata', ready)
          video.removeEventListener('error', failed)
          if (error !== undefined || canceled || stale(ownGeneration)) releaseVideo(video)
          if (canceled || stale(ownGeneration)) resolve(CANCELED)
          else if (error !== undefined) reject(error)
          else resolve(video)
        }
        const ready = (): void => {
          if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) finish()
        }
        const failed = (): void => finish(new Error('视频首帧无法加载；保留此前壁纸'))
        cancel = () => finish(undefined, true)
        disposeCurrent = cancel
        video.addEventListener('loadeddata', ready)
        video.addEventListener('error', failed)
        timer = window.setTimeout(() => finish(new Error('视频首帧加载超时；保留此前壁纸')), 15_000)
        video.setAttribute('src', custom.url)
        video.load()
      })
    } finally {
      if (disposeCurrent === cancel) disposeCurrent = NOOP
    }
  }

  const fadeVideo = async (layer: HTMLElement, incoming: HTMLVideoElement, custom: CustomWallpaperInfo, ownGeneration: number): Promise<boolean> => {
    const outgoing = layer.querySelector<HTMLVideoElement>('video.amph-seat-video')
    const resumeOutgoing = outgoing !== null && !outgoing.paused
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const isStatic = (): boolean => reducedMotion?.matches === true || document.visibilityState === 'hidden'
    incoming.style.opacity = isStatic() ? '1' : '0'
    if (isStatic()) incoming.style.transition = 'none'
    layer.appendChild(incoming)
    outgoing?.pause()
    configureVideo(incoming, custom)
    if (!isStatic()) void incoming.offsetWidth
    incoming.style.opacity = '1'
    let cancel = NOOP
    try {
      return await new Promise<boolean>(resolve => {
        let settled = false
        let timer: number | undefined
        const finish = (completed: boolean): void => {
          if (settled) return
          settled = true
          if (timer !== undefined) window.clearTimeout(timer)
          document.removeEventListener?.('visibilitychange', completeIfStatic)
          reducedMotion?.removeEventListener?.('change', completeIfStatic)
          if (completed && !stale(ownGeneration)) {
            if (isStatic()) incoming.style.transition = 'none'
            incoming.style.opacity = '1'
            if (outgoing !== null) releaseVideo(outgoing)
          } else {
            releaseVideo(incoming)
            if (!disposed && resumeOutgoing && document.visibilityState !== 'hidden') void outgoing?.play().catch(() => {})
          }
          resolve(completed && !stale(ownGeneration))
        }
        const completeIfStatic = (): void => { if (isStatic()) finish(true) }
        cancel = () => finish(false)
        disposeCurrent = cancel
        if (isStatic()) { finish(true); return }
        timer = window.setTimeout(() => finish(true), 240)
        document.addEventListener?.('visibilitychange', completeIfStatic)
        reducedMotion?.addEventListener?.('change', completeIfStatic)
      })
    } finally {
      if (disposeCurrent === cancel) disposeCurrent = NOOP
    }
  }

  const fadeWallpaper = async (
    layer: HTMLElement,
    url: string,
    ownGeneration: number,
  ): Promise<TransitionResult | undefined> => {
    const nextSlot = (activeSlot ^ 1) as 0 | 1
    const incoming = layer.querySelector<HTMLElement>(`.amphoreus-seat-layer[data-slot="${nextSlot}"]`)
    const outgoing = layer.querySelector<HTMLElement>(`.amphoreus-seat-layer[data-slot="${activeSlot}"]`)
    if (incoming === null || outgoing === null) throw new Error('席位壁纸层结构不完整')

    incoming.style.backgroundImage = cssUrl(url)
    incoming.dataset.incoming = ''
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const isStatic = (): boolean => reducedMotion?.matches === true || document.visibilityState === 'hidden'
    if (isStatic()) {
      incoming.dataset.active = ''
      return { incoming, outgoing, nextSlot }
    }
    void incoming.offsetWidth
    incoming.dataset.active = ''

    let settled = false
    let timer: number | undefined
    let release!: (completed: boolean) => void
    const wait = new Promise<boolean>(resolve => { release = resolve })
    const finish = (completed: boolean): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener?.('visibilitychange', completeIfStatic)
      reducedMotion?.removeEventListener?.('change', completeIfStatic)
      release(completed)
    }
    const completeIfStatic = (): void => { if (isStatic()) finish(true) }
    timer = window.setTimeout(() => finish(true), 260)
    document.addEventListener?.('visibilitychange', completeIfStatic)
    reducedMotion?.addEventListener?.('change', completeIfStatic)
    const cancel = (): void => {
      if (settled) return
      delete incoming.dataset.active
      delete incoming.dataset.incoming
      incoming.style.backgroundImage = ''
      finish(false)
    }
    disposeCurrent = cancel
    const completed = await wait
    if (disposeCurrent === cancel) disposeCurrent = NOOP
    if (!completed || stale(ownGeneration)) return undefined
    return { incoming, outgoing, nextSlot }
  }

  const applyHero = async (plan: SeatVisualPlan, ownGeneration: number): Promise<void> => {
    const hero = plan.hero
    try {
      const layer = wallpaperLayer()
      if (plan.custom?.kind === 'video' && layer !== null) {
        if (stale(ownGeneration)) return
        const active = layer.querySelector<HTMLVideoElement>('video.amph-seat-video')
        if (active?.getAttribute('src') !== plan.custom.url) {
          const video = await loadVideo(plan.custom, ownGeneration)
          if (video === CANCELED) return
          if (stale(ownGeneration)) { releaseVideo(video); return }
          if (!await fadeVideo(layer, video, plan.custom, ownGeneration)) return
        } else syncVideo(layer, plan.custom)
        if (stale(ownGeneration)) return
        resetSeatSurface(true)
        applyPlacement(plan.custom)
        layer.style.setProperty('--amphoreus-wallpaper-url', 'none')
        document.body.style.setProperty('--amphoreus-dark-mask', String(plan.darkMask))
        document.body.style.setProperty('--amphoreus-light-mask', String(plan.lightMask))
        appliedKey = plan.key
        return
      }
      if (plan.candidates.length === 0 || layer === null) {
        if (stale(ownGeneration)) return
        resetWallpaperSurface(plan)
        applyPlacement(plan.custom)
        syncVideo(layer, plan.custom)
        if (stale(ownGeneration)) return
        appliedKey = plan.key
        return
      }

      const url = await loadWallpaper(plan, ownGeneration)
      if (url === undefined || stale(ownGeneration)) return
      const transition = await fadeWallpaper(layer, url, ownGeneration)
      if (transition === undefined || stale(ownGeneration)) return

      delete transition.outgoing.dataset.active
      transition.outgoing.style.backgroundImage = ''
      delete transition.incoming.dataset.incoming
      activeSlot = transition.nextSlot
      layer.style.removeProperty('--amphoreus-wallpaper-url')
      // Custom wallpaper: placement variables for images; a <video> for clips (poster stays the still below).
      applyPlacement(plan.custom)
      syncVideo(layer, plan.custom)
      const factor = hero === null ? 1 : seatMaskFactor(hero.palette.mode)
      document.body.style.setProperty('--amphoreus-dark-mask', String(clampMask(plan.darkMask * factor)))
      document.body.style.setProperty('--amphoreus-light-mask', String(clampMask(plan.lightMask * factor)))
      appliedKey = plan.key
    } catch (error) {
      if (stale(ownGeneration)) return
      console.warn('[dsh-amphoreus] seat theme fallback:', error)
      if (plan.custom === undefined || appliedKey === null) resetWallpaperSurface(plan)
      appliedKey = plan.key
    }
  }

  const sync = (): void => {
    if (disposed) return
    const list = sessions.list.getSnapshot()
    if (list.current !== lastSessionId) {
      lastSessionId = list.current
      hinted = undefined
      bootstrapHeroId = undefined
    }
    const state = model.getSnapshot().state
    if (state === undefined) return
    const binding = currentSeatOf(bindingIndex(state.bindings), list.current)
    let hero: HeroVisual | undefined
    if (binding !== undefined) {
      hinted = undefined
      bootstrapHeroId = undefined
      hero = heroVisualOf(binding.skillName)
    } else if (hinted !== undefined && hinted.sessionId === list.current) {
      bootstrapHeroId = undefined
      if (hinted.heroId !== null) hero = heroVisualById(hinted.heroId)
    } else if (list.current === undefined && bootstrapHeroId !== undefined) {
      hero = heroVisualById(bootstrapHeroId)
    }
    const target = hero === undefined || hero.heroId === GLOBAL_SEAT_HERO ? null : hero
    const plan = planFor(state, target, hero?.heroId, list.current)
    const intent = target?.heroId ?? null
    if (appliedIntent !== intent) {
      seatLayer.apply(intent)
      appliedIntent = intent
    }
    if (target !== null) rememberSeat(target.heroId)
    else forgetSeat()

    if (pendingKey === plan.key) return
    if (pendingKey !== null) {
      generation += 1
      clearTransition()
      pendingKey = null
    }
    if (appliedKey === plan.key) return

    const ownGeneration = ++generation
    pendingKey = plan.key
    if (target === null && plan.custom === undefined && plan.candidates.length === 0) {
      leaveSeat(plan)
      appliedKey = plan.key
      pendingKey = null
      return
    }
    void applyHero(plan, ownGeneration).finally(() => {
      if (ownGeneration === generation && pendingKey === plan.key) pendingKey = null
    })
  }

  const unsubscribeModel = model.subscribe(sync)
  const unsubscribeSessions = sessions.list.subscribe(sync)
  sync()

  const hint = (heroId: string | null): void => {
    if (disposed) return
    const sessionId = sessions.list.getSnapshot().current
    lastSessionId = sessionId
    bootstrapHeroId = undefined
    hinted = { sessionId, heroId }
    sync()
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    generation += 1
    document.removeEventListener?.('visibilitychange', syncVideoVisibility)
    clearTransition()
    unsubscribeModel()
    unsubscribeSessions()
    hinted = undefined
    bootstrapHeroId = undefined
    pendingKey = null
    appliedKey = null
    resetSeatSurface()
    seatLayer.apply(null)
  }

  return { hint, dispose }
}

function rgba(rgb: readonly [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, alpha))})`
}
