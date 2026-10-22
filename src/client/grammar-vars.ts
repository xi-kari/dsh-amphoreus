/**
 * Pure derivation of the grammar layer's CSS variables (no DOM, no CSS
 * imports) so tests and the iframe bridge can share it with grammar-layer.ts.
 */
import type { GrammarPrefs } from '../shared/api.ts'
import { GRAMMAR_VARIABLE_NAMES, grammarVariables, type SeatGrammar } from '../shared/grammar.ts'
import { heroVisualById, stickerAssetUrl } from '../shared/heroes.ts'
import { motifDataUri } from '../shared/motifs.ts'
import { mix, parseHex, rgb, type Rgb } from '../shared/color.ts'
import { globalThemeTokens } from './theme.ts'
import { seatThemeTokens } from './seat-theme.ts'
import { deriveGlassMaterial, deriveLiquidShellMaterial } from './glass-material.ts'

export interface GrammarSnapshot {
  readonly heroId: string | null
  readonly dark: boolean
  readonly prefs: GrammarPrefs
  readonly grammar: SeatGrammar
  /** Derived asset keys (`<heroId>/sticker.webp` …) so the mascot prefers the WebP; undefined = originals only. */
  readonly derived?: readonly string[]
  /** False when no assetsRoot is configured: the mascot is then forced off. */
  readonly assetsConfigured?: boolean
  readonly wallpaperActive?: boolean
  readonly codeBackgroundActive?: boolean
  readonly surfaceAlpha?: { readonly light: number; readonly dark: number }
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

/** Minimum frost input; final surface coverage is computed from its text colours. */
export const FROST_FLOOR = 0.42

function colorChannels(value: unknown): Rgb {
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/u.exec(String(value))
  if (!match) throw new Error('Expected an RGB theme color')
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export const MATERIAL_VARIABLE_NAMES = [
  '--amph-material-base', '--amph-material-ink', '--amph-material-primary', '--amph-material-secondary',
  '--amph-material-pane-alpha', '--amph-material-content-alpha', '--amph-material-input-alpha', '--amph-material-dialog-alpha',
  '--amph-material-filter', '--amph-material-dialog-filter', '--amph-material-ground', '--amph-material-floor',
  '--amph-material-sheen-alpha',
  '--amph-liquid-base', '--amph-liquid-primary', '--amph-liquid-secondary',
  '--amph-liquid-pane-alpha', '--amph-liquid-input-alpha', '--amph-liquid-dialog-alpha',
] as const

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
  const alpha = snapshot.surfaceAlpha ?? { light: .22, dark: .4 }
  const tokens = visual === undefined || visual.heroId === 'cyrene'
    ? globalThemeTokens(alpha.light, alpha.dark) : seatThemeTokens(visual, alpha)
  const scheme = snapshot.dark ? 'dark' : 'light'
  const primary = colorChannels(tokens['--dsw-alias-label-primary']?.[scheme])
  const materialInput = {
    base: colorChannels(tokens['--dsw-alias-bg-layer-1']?.[scheme]), primary,
    secondary: colorChannels(tokens['--dsw-alias-label-secondary']?.[scheme]),
    body: mix(parseHex(snapshot.grammar.ink[scheme]), primary, .2),
    dark: snapshot.dark, frost, blur, wallpaper: snapshot.wallpaperActive === true || snapshot.codeBackgroundActive === true,
  }
  const material = deriveGlassMaterial(materialInput)
  const liquid = deriveLiquidShellMaterial(materialInput)
  Object.assign(vars, {
    '--amph-material-base': rgb(material.base), '--amph-material-ink': rgb(material.body),
    '--amph-material-primary': rgb(material.primary), '--amph-material-secondary': rgb(material.secondary),
    '--amph-material-pane-alpha': String(material.paneAlpha), '--amph-material-content-alpha': String(material.contentAlpha),
    '--amph-material-input-alpha': String(material.inputAlpha), '--amph-material-dialog-alpha': String(material.dialogAlpha),
    '--amph-material-filter': material.blur === 0 ? 'none' : `blur(${material.blur}px) saturate(1.18)`,
    '--amph-material-dialog-filter': material.dialogBlur === 0 ? 'none' : `blur(${material.dialogBlur}px) saturate(1.18)`,
    '--amph-material-ground': snapshot.wallpaperActive === true ? 'transparent' : rgb(material.base),
    '--amph-material-floor': String(material.floor),
    '--amph-material-sheen-alpha': String(material.sheenAlpha),
    '--amph-liquid-base': rgb(liquid.base), '--amph-liquid-primary': rgb(liquid.primary),
    '--amph-liquid-secondary': rgb(liquid.secondary), '--amph-liquid-pane-alpha': String(liquid.paneAlpha),
    '--amph-liquid-input-alpha': String(liquid.inputAlpha), '--amph-liquid-dialog-alpha': String(liquid.dialogAlpha),
  })
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
  ...MATERIAL_VARIABLE_NAMES,
]
