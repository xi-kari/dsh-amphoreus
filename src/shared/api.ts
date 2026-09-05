import type { AmphoreusGlobal, BindingRecord, CanvasRecord, MemoryRecord, ObservationRecord, SeatRecord, SuiteEventRecord } from '../host/store.ts'
import type { DiagnosticCode, FeatureSwitches, SuiteLevel } from '../host/suite/types.ts'

export interface PublicCard {
  readonly name: string
  readonly displayName: string
  readonly aliases: readonly string[]
  readonly faces: readonly string[]
  readonly description: string
  readonly ordinal?: number
  readonly duties: readonly string[]
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly hasPersona: boolean
  readonly status: 'ok' | 'name-mismatch'
}

export interface PublicSuite {
  readonly parserVersion: string
  readonly parsedAt: number
  readonly generation: number
  readonly level: SuiteLevel
  readonly features: FeatureSwitches
  readonly root?: { readonly configured: string; readonly canonical: string }
  readonly roots: readonly { readonly index: number; readonly configured: string; readonly canonical: string }[]
  readonly fingerprint?: { readonly manifestSha256: string; readonly label: string; readonly fileCount: number; readonly computedAt: number }
  readonly cards: readonly PublicCard[]
  readonly dispatch: readonly { readonly needs: readonly string[]; readonly roleText: string; readonly skill: string; readonly face?: string }[]
  readonly pipelines: readonly {
    readonly name: string
    readonly source: 'common' | 'router'
    readonly stations: readonly { readonly text: string; readonly skill?: string; readonly face?: string }[]
  }[]
  readonly contracts?: {
    readonly receipt?: { readonly source: string; readonly tiers: readonly string[] }
    readonly absence: { readonly template: string; readonly source?: string; readonly fromFile: boolean }
    readonly handoff: { readonly template: string; readonly verb: string; readonly source?: string; readonly fromFile: boolean }
    readonly firewallWords: readonly string[]
  }
  readonly diagnostics: readonly { readonly code: DiagnosticCode; readonly severity: 'info' | 'warn' | 'error'; readonly detail: string; readonly line?: number; readonly skill?: string }[]
}

export interface WorkbenchPublicConfig {
  readonly enabled: boolean
  readonly host: 'iframe' | 'native'
  readonly defaultView: 'chat' | 'workbench'
  readonly cardTextLimit: number
  readonly autoProjection: boolean
}

export type WorkbenchStatus =
  | { readonly kind: 'ready' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'unavailable'; readonly reason: string }

export interface UnprojectableRecord {
  readonly sessionId: string
  readonly heroId: string | null
  readonly title: string | null
  readonly reason: string
  readonly at: number
}

/** iframe 壳 <script> 注入的全局，形状比宿主页 __AMPHOREUS_BOOT__ 小。 */
export interface WorkbenchBoot {
  readonly nonce: string
  readonly revision: number
  readonly workbench: WorkbenchPublicConfig
}

export interface ThemeTokensMessage {
  readonly source: 'dsh-amphoreus'
  readonly type: 'amphoreus:theme-tokens'
  readonly tokens: Readonly<Record<string, string>>
  readonly dark: boolean
}

export interface SeatChangedMessage {
  readonly source: 'dsh-amphoreus'
  readonly type: 'amphoreus:seat-changed'
  readonly heroId: string | null
}

/** Host → iframe: the resolved seat grammar variables (already scaled by user prefs). */
export interface GrammarMessage {
  readonly source: 'dsh-amphoreus'
  readonly type: 'amphoreus:grammar'
  readonly enabled: boolean
  readonly heroId: string | null
  readonly display: string
  readonly ambient: string
  readonly variables: Readonly<Record<string, string>>
}

export interface MagazineModeMessage {
  readonly source: 'dsh-amphoreus'
  readonly type: 'amphoreus:magazine-mode'
  readonly mode: 'light' | 'full'
}

export type DeriveKind = 'covers' | 'chronicle' | 'cards' | 'stickers' | 'wallpapers' | 'home'

/**
 * User-tunable knobs of the per-seat visual grammar (glass, motif, mascot, ambient).
 * Persisted in the plugin's storage domain (`prefs.grammar`), so they survive port churn.
 */
export interface GrammarPrefs {
  /** Master switch for the seat visual grammar layer (off = today's token-only look). */
  readonly enabled: boolean
  /** Glass blur multiplier applied to every seat's own blur radius. */
  readonly blurScale: number
  /** Glass fill-opacity multiplier applied to every seat's own frost. */
  readonly frostScale: number
  /** Extra wallpaper scrim added on top of the seat scrim (0–0.4). */
  readonly scrimBoost: number
  /** Motif opacity multiplier (0 hides the tiled pattern). */
  readonly motifScale: number
  /** Mascot sticker behaviour on the shell. */
  readonly mascot: 'reactive' | 'static' | 'off'
  /** Per-seat ambient CSS animation. */
  readonly ambient: boolean
}

export const GRAMMAR_DEFAULTS: GrammarPrefs = Object.freeze({
  enabled: true,
  blurScale: 1,
  frostScale: 1,
  scrimBoost: 0,
  motifScale: 1,
  mascot: 'reactive',
  ambient: true,
})

export const GRAMMAR_LIMITS = Object.freeze({
  blurScale: { min: 0, max: 2, step: 0.1 },
  frostScale: { min: 0.6, max: 1.4, step: 0.05 },
  scrimBoost: { min: 0, max: 0.4, step: 0.02 },
  motifScale: { min: 0, max: 1, step: 0.05 },
} as const)

export interface DeriveProgress {
  readonly kind: DeriveKind
  readonly done: number
  readonly total: number
  readonly current: string
  readonly error?: string
}

export interface AmphoreusBoot {
  readonly revision: number
  readonly nonce: string
  readonly level: SuiteLevel | 'loading'
  readonly workbench: WorkbenchPublicConfig
  readonly wallpaper: {
    readonly enabled: boolean
    readonly url?: string
    readonly sidebarUrl?: string
    readonly darkMask: number
    readonly lightMask: number
  }
}

/** How a user-supplied seat wallpaper is placed and played (persisted in prefs). */
export interface CustomWallpaperPlacement {
  readonly fit: 'cover' | 'contain' | 'fill'
  /** CSS background-position / object-position percentages. */
  readonly x: number
  readonly y: number
  /** Extra zoom multiplier (1 = none). */
  readonly scale: number
  /** Video only. */
  readonly playbackRate: number
  readonly muted: boolean
  readonly loop: boolean
  readonly paused: boolean
}

export const CUSTOM_WALLPAPER_PLACEMENT_DEFAULTS: CustomWallpaperPlacement = Object.freeze({
  fit: 'cover', x: 50, y: 40, scale: 1, playbackRate: 1, muted: true, loop: true, paused: false,
})

/** One stored custom wallpaper as the client sees it. */
export interface CustomWallpaperInfo {
  readonly heroId: string
  readonly url: string
  readonly kind: 'image' | 'video'
  readonly mime: string
  readonly bytes: number
  readonly placement: CustomWallpaperPlacement
}

export interface AmphoreusAssetsStatus {
  readonly root: string
  readonly cacheDir: string
  readonly derivedCount: number
  readonly derived: readonly string[]
  readonly magick: string | null
  readonly running: boolean
  readonly lastDerive: {
    readonly at: number
    readonly written: number
    readonly failed: number
    readonly error?: string
  } | null
}

export interface AmphoreusState {
  readonly revision: number
  readonly nonce: string
  readonly suite: PublicSuite | undefined
  readonly seats: readonly SeatRecord[]
  readonly seatDirs: readonly { readonly heroId: string; readonly skillName: string; readonly dir: string }[]
  readonly bindings: readonly BindingRecord[]
  readonly memory: readonly MemoryRecord[]
  readonly observations: readonly ObservationRecord[]
  readonly prefs: AmphoreusGlobal['prefs']
  readonly suiteEvents: readonly SuiteEventRecord[]
  readonly canvas: readonly { readonly sessionId: string; readonly value: CanvasRecord }[]
  readonly assets: AmphoreusAssetsStatus
  /** User-uploaded per-seat wallpapers (override derived home wallpapers). */
  readonly customWallpapers: readonly CustomWallpaperInfo[]
  // @anchor state-type-fields
  /** User-uploaded per-seat sounds (greeting on seat enter / click on send); never bundled. */
  readonly seatSounds: readonly SeatSoundInfo[]
  readonly workbench: {
    readonly status: WorkbenchStatus
    readonly unprojectable: readonly UnprojectableRecord[]
  }
  readonly effectiveConfig: {
    readonly wallpaper: { readonly enabled: boolean; readonly global: 'rotate' | 'fixed'; readonly globalIndex: number; readonly sidebarIndex: number; readonly perSeat: boolean; readonly darkMask: number; readonly lightMask: number; readonly surfaceAlpha: { readonly light: number; readonly dark: number } }
    readonly magazineMode: 'light' | 'full'
    readonly magazineModeSource: 'config' | 'prefs'
    /** Effective grammar knobs (defaults merged under stored prefs). */
    readonly grammar: GrammarPrefs
    readonly seatStyle: boolean
    readonly assetsConfigured: boolean
    readonly heroWorkspaceMode: 'seats' | 'off'
    readonly workbench: WorkbenchPublicConfig
    readonly handoffEnabled: boolean
    readonly receiptParsing: boolean
    readonly dispatchHints: boolean
    readonly pipelinesEnabled: boolean
    // @anchor effective-config-type-fields
    /** Seat memory pipeline knobs as configured (per-seat overrides live in MemoryRecord.settings). */
    readonly memory: MemoryPublicConfig
  }
}

// @anchor shared-types

/** Which moment a user-supplied seat sound plays at. */
export type SeatSoundSlot = 'greeting' | 'send'
export const SEAT_SOUND_SLOTS: readonly SeatSoundSlot[] = Object.freeze(['greeting', 'send'])

/** Per-slot playback knobs (persisted in `prefs.seatSounds.seats[heroId][slot]`). */
export interface SeatSoundPrefs {
  readonly enabled: boolean
  /** 0..1 linear gain applied to the media element. */
  readonly volume: number
}

export const SEAT_SOUND_DEFAULTS: SeatSoundPrefs = Object.freeze({ enabled: true, volume: 0.6 })
/** Master switch default (`prefs.seatSounds.master`). */
export const SEAT_SOUND_MASTER_DEFAULT = true
/** Upload cap for one sound file (bytes). */
export const SEAT_SOUND_MAX_BYTES = 20 * 1024 * 1024

/** One stored seat sound as the client sees it (prefs already merged with defaults). */
export interface SeatSoundInfo {
  readonly heroId: string
  readonly slot: SeatSoundSlot
  readonly url: string
  readonly mime: string
  readonly bytes: number
  readonly prefs: SeatSoundPrefs
}

/** Body of `PUT /amphoreus/api/prefs` `{ seatSounds }`: partial patch; a `null` seat entry deletes it. */
export interface SeatSoundPrefsPatch {
  readonly master?: boolean
  readonly seats?: Readonly<Record<string, {
    readonly greeting?: Partial<SeatSoundPrefs>
    readonly send?: Partial<SeatSoundPrefs>
  } | null>>
}

/** Seat memory: hard cap of one note (code points), applied to user and seat notes alike. */
export const SEAT_NOTE_MAX_CHARS = 200
/** Plugin-owned line prefix a seat uses to leave a note at turn end (`留言：<text>`, ASCII colon also accepted). */
export const SEAT_NOTE_MARKER = '留言：'
/** Default number of notes injected into the seat prompt when neither config nor the seat record says otherwise. */
export const SEAT_NOTE_INJECT_LIMIT_DEFAULT = 8

/** Effective per-seat memory switches (config defaults merged under the seat record's overrides). */
export interface MemorySettings {
  /** Inject stored notes into the seat's system prompt. */
  readonly inject: boolean
  /** Ask the seat to leave a `留言：` line at turn end and capture it. */
  readonly autoNote: boolean
  /** Newest-last cap of notes injected (0 disables injection without clearing notes). */
  readonly injectLimit: number
}

/** `config.memory` as published to the client. */
export interface MemoryPublicConfig extends MemorySettings {
  /** Slash command name (without the slash) that appends a user note to the bound seat. */
  readonly command: string
}

declare global {
  interface Window {
    __AMPHOREUS_BOOT__?: AmphoreusBoot
  }
}
