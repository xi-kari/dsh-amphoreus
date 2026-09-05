/**
 * Pure derivation of the grammar layer's CSS variables (no DOM, no CSS
 * imports) so tests and the iframe bridge can share it with grammar-layer.ts.
 */
import type { GrammarPrefs } from '../shared/api.ts'
import { GRAMMAR_VARIABLE_NAMES, grammarVariables, type SeatGrammar } from '../shared/grammar.ts'
import { heroVisualById, stickerAssetUrl } from '../shared/heroes.ts'
import { motifDataUri } from '../shared/motifs.ts'

export interface GrammarSnapshot {
  readonly heroId: string | null
  readonly dark: boolean
  readonly prefs: GrammarPrefs
  readonly grammar: SeatGrammar
  /** Derived asset keys (`<heroId>/sticker.webp` …) so the mascot prefers the WebP; undefined = originals only. */
  readonly derived?: readonly string[]
  /** False when no assetsRoot is configured: the mascot is then forced off. */
  readonly assetsConfigured?: boolean
}

/** Mascot sticker URL for a seat (derived WebP first, then the original 表情包 file); null when unavailable. */
export function mascotUrlFor(snapshot: GrammarSnapshot): string | null {
  if (snapshot.prefs.mascot === 'off' || snapshot.assetsConfigured === false) return null
  const visual = snapshot.heroId === null ? undefined : heroVisualById(snapshot.heroId)
  if (visual === undefined) return null
  const key = `${visual.heroId}/sticker.webp`
  if (snapshot.derived?.includes(key)) return `/amphoreus/derived/${encodeURIComponent(visual.heroId)}/sticker.webp`
  return stickerAssetUrl(visual.assets.sticker)
}

/** Lowest pane fill the user knobs may reach: below this ink over busy art stops being readable. */
export const FROST_FLOOR = 0.42

/** The variable map the layer writes for a snapshot, with user prefs applied. */
export function grammarVariablesFor(snapshot: GrammarSnapshot): Record<string, string> {
  const visual = snapshot.heroId === null ? undefined : heroVisualById(snapshot.heroId)
  const accent = visual?.palette.accent ?? '#8a681c'
  const accent2 = visual?.palette.accent2 ?? '#37305e'
  const vars = grammarVariables(snapshot.grammar, snapshot.dark, accent, accent2)
  const prefs = snapshot.prefs
  const blur = snapshot.grammar.glass.blurPx * prefs.blurScale
  const frost = Math.min(1, Math.max(FROST_FLOOR, snapshot.grammar.glass.frost * prefs.frostScale))
  vars['--amph-glass-blur'] = `${Math.round(blur * 10) / 10}px`
  vars['--amph-glass-frost'] = String(Math.round(frost * 100) / 100)
  const motifOpacity = Math.round(snapshot.grammar.motif.opacity * prefs.motifScale * 1000) / 1000
  vars['--amph-motif-opacity'] = String(motifOpacity)
  vars['--amph-scrim-boost'] = String(prefs.scrimBoost)
  const motif = visual?.motif ?? 'ripples'
  // The SVG carries its own opacity: backgrounds cannot be faded independently of the pane fill.
  vars['--amph-motif-url'] = motifOpacity <= 0 ? 'none' : motifDataUri(motif, {
    color: snapshot.dark ? accent2 : accent,
    opacity: Math.min(1, motifOpacity),
    size: snapshot.grammar.motif.sizePx,
  })
  const mascot = mascotUrlFor(snapshot)
  vars['--amph-mascot-url'] = mascot === null ? 'none' : `url("${mascot.replaceAll('"', '%22')}")`
  return vars
}

/** Every variable the layer may write (for exact cleanup on disable/dispose). */
export const GRAMMAR_WRITTEN_VARIABLES: readonly string[] = [
  ...GRAMMAR_VARIABLE_NAMES,
  '--amph-scrim-boost',
  '--amph-motif-url',
  '--amph-mascot-url',
]
