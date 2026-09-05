/**
 * Seat sounds, browser half: a tiny player over `new Audio()` that respects the
 * autoplay policy, plus the seat-enter greeting hook. Nothing here touches the
 * DOM tree (detached media elements only), and every input is injectable so the
 * module is unit-testable under node --test without a browser.
 */
import { SEAT_SOUND_DEFAULTS, SEAT_SOUND_MASTER_DEFAULT, SEAT_SOUND_SLOTS, type AmphoreusState, type SeatSoundPrefs, type SeatSoundPrefsPatch, type SeatSoundSlot } from '../shared/api.ts'
import { GLOBAL_SEAT_HERO } from './seat-model.ts'
import type { SeatWatch } from './seat-watch.ts'
import type { AmphoreusClientModel } from './state.ts'

/** The subset of HTMLAudioElement the player uses (tests hand in a fake). */
export interface AudioLike {
  volume: number
  play(): Promise<void> | void
  pause(): void
}

/** The subset of Document the player needs to detect the first user gesture. */
export interface GestureTarget {
  addEventListener(type: string, listener: () => void, options?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, listener: () => void, options?: boolean | EventListenerOptions): void
}

export interface SeatSoundPlayer {
  /** Fire-and-forget: NotAllowedError (autoplay policy) and decode failures are swallowed. */
  play(url: string, volume: number): void
  /**
   * Greeting channel: plays now when a user gesture has armed the page; otherwise
   * stashes it (latest wins) and replays it once on the first pointerdown/keydown.
   * A newer greeting stops the previous one.
   */
  greet(url: string, volume: number): void
  readonly armed: boolean
  dispose(): void
}

export interface SeatSoundPlayerOptions {
  readonly audioFactory?: (url: string) => AudioLike
  readonly doc?: GestureTarget
  /** Start armed (tests / environments without autoplay gating). */
  readonly armed?: boolean
}

const ARM_EVENTS = ['pointerdown', 'keydown'] as const

function clampVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : SEAT_SOUND_DEFAULTS.volume
}

export function createSeatSoundPlayer(options: SeatSoundPlayerOptions = {}): SeatSoundPlayer {
  const factory = options.audioFactory ?? ((url: string): AudioLike => new Audio(url))
  const doc: GestureTarget | undefined = options.doc ?? (typeof document === 'undefined' ? undefined : document)
  let armed = options.armed ?? false
  let disposed = false
  let pending: { url: string; volume: number } | undefined
  let greeting: AudioLike | undefined

  const start = (url: string, volume: number): AudioLike | undefined => {
    if (disposed) return undefined
    let element: AudioLike
    try {
      element = factory(url)
      element.volume = clampVolume(volume)
    } catch {
      return undefined
    }
    try {
      const result = element.play()
      if (result !== undefined && typeof (result as Promise<void>).then === 'function') {
        void (result as Promise<void>).catch(() => { /* autoplay policy or decode failure: stay silent */ })
      }
    } catch { /* synchronous play() failure */ }
    return element
  }

  const onGesture = (): void => {
    if (disposed) return
    armed = true
    detach()
    const replay = pending
    pending = undefined
    if (replay !== undefined) {
      greeting?.pause()
      greeting = start(replay.url, replay.volume)
    }
  }
  const detach = (): void => {
    if (doc === undefined) return
    for (const type of ARM_EVENTS) doc.removeEventListener(type, onGesture, true)
  }
  if (!armed && doc !== undefined) {
    for (const type of ARM_EVENTS) doc.addEventListener(type, onGesture, true)
  }

  return {
    get armed() { return armed },
    play(url, volume) {
      if (!armed) return
      start(url, volume)
    },
    greet(url, volume) {
      if (disposed) return
      if (!armed) {
        pending = { url, volume }
        return
      }
      greeting?.pause()
      greeting = start(url, volume)
    },
    dispose() {
      disposed = true
      pending = undefined
      detach()
      greeting?.pause()
      greeting = undefined
    },
  }
}

/**
 * Resolve the effective (url, volume) for one seat slot, or undefined when the
 * master switch, the slot switch, or the upload itself is missing. `heroId`
 * null (global seat) never resolves.
 */
export function resolveSeatSound(
  state: Pick<AmphoreusState, 'seatSounds' | 'prefs'> | undefined,
  heroId: string | null,
  slot: SeatSoundSlot,
): { readonly url: string; readonly volume: number } | undefined {
  if (state === undefined || heroId === null) return undefined
  if ((state.prefs.seatSounds?.master ?? SEAT_SOUND_MASTER_DEFAULT) === false) return undefined
  const info = state.seatSounds?.find(item => item.heroId === heroId && item.slot === slot)
  if (info === undefined || !info.prefs.enabled) return undefined
  return { url: info.url, volume: info.prefs.volume }
}

/** Slots a seat can carry: the global seat never "enters" (seat watch yields null), so it has no greeting. */
export function slotsForHero(heroId: string): readonly SeatSoundSlot[] {
  return heroId === GLOBAL_SEAT_HERO ? SEAT_SOUND_SLOTS.filter(slot => slot !== 'greeting') : SEAT_SOUND_SLOTS
}

/** Ids present in `ids` that `seen` did not contain (one composer send == one new requestId). */
export function freshSubmissionIds(seen: ReadonlySet<string>, ids: readonly string[]): string[] {
  return ids.filter(id => !seen.has(id))
}

/** Retired ids never return; past this many remembered ids the set collapses to what is still in flight. */
export const SEND_SEEN_LIMIT = 64

export interface SendDecision {
  readonly seen: Set<string>
  /** True exactly when at least one requestId is new since the previous observation. */
  readonly play: boolean
}

/**
 * Pure step of the send-click sentinel: `seen === undefined` is the mount
 * observation (remember, never play); afterwards play once per batch that
 * carries a fresh requestId. Ids that vanish and reappear are not fresh unless
 * the set was collapsed in between — which only happens above SEND_SEEN_LIMIT,
 * and the collapse keeps every id still in flight.
 */
export function nextSendDecision(seen: ReadonlySet<string> | undefined, ids: readonly string[]): SendDecision {
  if (seen === undefined) return { seen: new Set(ids), play: false }
  const fresh = freshSubmissionIds(seen, ids)
  const next = new Set(seen)
  for (const id of ids) next.add(id)
  return { seen: next.size > SEND_SEEN_LIMIT ? new Set(ids) : next, play: fresh.length > 0 }
}

/** Deep-merge two prefs patches (later wins per leaf; a `null` seat entry replaces the whole seat). */
export function mergeSeatSoundPatch(base: SeatSoundPrefsPatch | undefined, patch: SeatSoundPrefsPatch): SeatSoundPrefsPatch {
  if (base === undefined) return patch
  const seats: Record<string, { greeting?: Partial<SeatSoundPrefs>; send?: Partial<SeatSoundPrefs> } | null> = { ...base.seats }
  for (const [heroId, entry] of Object.entries(patch.seats ?? {})) {
    const previous = seats[heroId]
    if (entry === null || previous === null || previous === undefined) {
      seats[heroId] = entry
      continue
    }
    seats[heroId] = {
      ...previous,
      ...(entry.greeting === undefined ? {} : { greeting: { ...previous.greeting, ...entry.greeting } }),
      ...(entry.send === undefined ? {} : { send: { ...previous.send, ...entry.send } }),
    }
  }
  return {
    ...(patch.master ?? base.master) === undefined ? {} : { master: patch.master ?? base.master },
    ...(Object.keys(seats).length === 0 ? {} : { seats }),
  }
}

export interface SeatSoundsOptions {
  readonly seat: Pick<SeatWatch, 'getSnapshot' | 'subscribe'>
  readonly model: Pick<AmphoreusClientModel, 'getSnapshot'>
  readonly player: Pick<SeatSoundPlayer, 'greet'>
}

/**
 * Greeting on seat enter: subscribes to the body-attribute seat mirror, ignores
 * the value present at install time and every transition to null (leaving a
 * seat / entering the global seat), and hands the seat's greeting to the player.
 * Returns a disposer.
 */
export function installSeatSounds(options: SeatSoundsOptions): () => void {
  let last = options.seat.getSnapshot()
  return options.seat.subscribe(() => {
    const next = options.seat.getSnapshot()
    if (next === last) return
    last = next
    if (next === null) return
    const sound = resolveSeatSound(options.model.getSnapshot().state, next, 'greeting')
    if (sound !== undefined) options.player.greet(sound.url, sound.volume)
  })
}
