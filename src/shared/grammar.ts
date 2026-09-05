/**
 * Per-seat visual grammar: the seven dimensions that make a seat readable at
 * a glance beyond its palette — corner scale, glass recipe, edge signature,
 * motif placement, typographic register, mascot sticker and ambient motion.
 * Values are CSS-ready strings/numbers consumed by `grammar-layer.ts` (host
 * shell) and mirrored to the workbench iframe. Only `--dsw-*` tokens and
 * `--amph-*` variables may appear in the CSS strings; no webfonts, no bitmaps.
 */
import type { HeroId } from './heroes.ts'

export type AmbientName =
  | 'none' | 'ripple' | 'star-drift' | 'checker-sweep' | 'film-grain' | 'stone-dust'
  | 'tide' | 'bubble-rise' | 'sun-shaft' | 'orbit' | 'gold-thread' | 'ember' | 'petal-fall' | 'coin-glint'

export type DisplayRegister = 'serif' | 'sans' | 'mono'

export interface SeatGrammar {
  /** ≤4 CJK chars style name shown in settings/tooltips. */
  readonly styleName: string
  /** Surface radius (panes, composer, bubbles) in px. */
  readonly radiusPx: number
  /** Control radius (buttons, chips) in px. */
  readonly radiusSmPx: number
  readonly glass: {
    /** Glass tint colours (hex) mixed into layer-1 for light/dark schemes. */
    readonly tintLight: string
    readonly tintDark: string
    /** Fill opacity multiplier (0.55–1.0 → see color-mix in grammar.css). */
    readonly frost: number
    /** backdrop-filter blur radius in px. */
    readonly blurPx: number
    /** Rim (hairline) colour expressions for light/dark; may use color-mix over --dsw tokens. */
    readonly rimLight: string
    readonly rimDark: string
  }
  /** Signature box-shadow stack drawn on primary panes, light/dark. */
  readonly edgeLight: string
  readonly edgeDark: string
  readonly typography: {
    readonly display: DisplayRegister
    readonly letterSpacing: string
    readonly titleTransform: 'none' | 'uppercase' | 'lowercase'
  }
  readonly motif: {
    readonly sizePx: number
    readonly opacity: number
    readonly placement: 'sidebar' | 'stage' | 'both' | 'header'
  }
  readonly ambient: AmbientName
  /** How the seat's (mostly portrait, high-contrast) home wallpaper is tamed behind text. */
  readonly wallpaper: {
    /** Gaussian blur on the wallpaper layer in px (0 = crisp). */
    readonly blurPx: number
    /** CSS background-position, e.g. `right 22% center` to park the figure beside the column. */
    readonly position: string
    /** Extra dim (0–0.5) multiplied into the veil so ink stays ≥4.5:1 over busy art. */
    readonly dim: number
    /** Saturation multiplier (1 = as-is; <1 quiets neon art under light schemes). */
    readonly saturate: number
  }
  /** Sticker file (表情包/) used as the seat's mascot on the shell. */
  readonly mascotSticker: string
  /** One-line signature detail (documentation / tooltip only). */
  readonly signature: string
}

/** Neutral grammar used for the global (Cyrene) space and any unknown seat. */
export const GLOBAL_GRAMMAR: SeatGrammar = {
  styleName: '涟漪水纸',
  radiusPx: 16,
  radiusSmPx: 10,
  glass: {
    tintLight: '#fbf7fc',
    tintDark: '#2a2340',
    frost: 0.78,
    blurPx: 14,
    rimLight: 'color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent)',
    rimDark: 'color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent)',
  },
  edgeLight: 'inset 0 1px 0 rgba(255, 255, 255, .55), 0 10px 32px color-mix(in srgb, var(--dsw-alias-bg-mask-2) 34%, transparent)',
  edgeDark: 'inset 0 1px 0 rgba(255, 255, 255, .08), 0 10px 32px rgba(2, 6, 14, .42)',
  typography: { display: 'serif', letterSpacing: '.02em', titleTransform: 'none' },
  motif: { sizePx: 96, opacity: 0.1, placement: 'sidebar' },
  ambient: 'ripple',
  wallpaper: { blurPx: 0, position: 'center 42%', dim: 0, saturate: 1 },
  mascotSticker: '小昔涟-嘻嘻.png',
  signature: '三圈涟漪与书页留白',
}

/**
 * The per-seat table. Filled from the 2026-09-05 design synthesis; Cyrene is
 * the global grammar by definition (entering her seat never switches layers).
 */
export const SEAT_GRAMMARS: Readonly<Partial<Record<HeroId, SeatGrammar>>> = Object.freeze({})

export function seatGrammarOf(heroId: string | null | undefined): SeatGrammar {
  if (heroId === null || heroId === undefined) return GLOBAL_GRAMMAR
  return SEAT_GRAMMARS[heroId as HeroId] ?? GLOBAL_GRAMMAR
}

/** CSS custom properties derived from a grammar for one scheme; keys are `--amph-*`. */
export function grammarVariables(grammar: SeatGrammar, dark: boolean, accent: string, accent2: string): Record<string, string> {
  const display = grammar.typography.display === 'serif'
    ? '"Noto Serif CJK SC", "Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", ui-serif, Georgia, serif'
    : grammar.typography.display === 'mono'
      ? 'ui-monospace, "Cascadia Code", Consolas, "SFMono-Regular", monospace'
      : '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
  return {
    '--amph-radius': `${grammar.radiusPx}px`,
    '--amph-radius-sm': `${grammar.radiusSmPx}px`,
    '--amph-glass-tint': dark ? grammar.glass.tintDark : grammar.glass.tintLight,
    '--amph-glass-frost': String(grammar.glass.frost),
    '--amph-glass-blur': `${grammar.glass.blurPx}px`,
    '--amph-glass-rim': dark ? grammar.glass.rimDark : grammar.glass.rimLight,
    '--amph-edge': dark ? grammar.edgeDark : grammar.edgeLight,
    '--amph-font-display': display,
    '--amph-letter-spacing': grammar.typography.letterSpacing,
    '--amph-title-transform': grammar.typography.titleTransform,
    '--amph-motif-size': `${grammar.motif.sizePx}px`,
    '--amph-motif-opacity': String(grammar.motif.opacity),
    '--amph-accent': accent,
    '--amph-accent2': accent2,
    '--amph-wp-blur': `${grammar.wallpaper.blurPx}px`,
    '--amph-wp-position': grammar.wallpaper.position,
    '--amph-wp-dim': String(grammar.wallpaper.dim),
    '--amph-wp-saturate': String(grammar.wallpaper.saturate),
  }
}

/** Every variable name `grammarVariables` may write (for exact cleanup). */
export const GRAMMAR_VARIABLE_NAMES: readonly string[] = Object.keys(
  grammarVariables(GLOBAL_GRAMMAR, false, '#000000', '#000000'),
)
