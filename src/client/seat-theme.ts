import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'
import { heroVisualById, type HeroPalette, type HeroVisual } from '../shared/heroes.ts'
import { seatCodePalette, seatUserBubble } from '../shared/seat-code.ts'
import {
  BLACK,
  WHITE,
  composite,
  contrast,
  ensureContrast,
  mix,
  parseHex,
  rgb,
  rgba,
  type Rgb,
} from '../shared/color.ts'

export interface SeatSchemeInput {
  readonly base: Rgb
  readonly oppositeBase: Rgb
  readonly accent: Rgb
  readonly accent2: Rgb
  readonly dark: boolean
  readonly synthesized: boolean
  readonly surfaceAlpha: number
}

export interface SeatScheme {
  readonly [token: string]: string
}

export interface ContrastRow {
  readonly pair:
    | 'label-primary/layer-1'
    | 'label-secondary/layer-1'
    | 'foreground/button-primary-fill'
    | 'brand-primary/layer-1'
  readonly ratio: number
  readonly min: 4.5 | 3.0
  readonly ok: boolean
}

interface DerivedSeatScheme {
  readonly tokens: SeatScheme
  readonly layer1Opaque: Rgb
  readonly ink: Rgb
  readonly ink2: Rgb
  readonly brand: Rgb
  readonly btnFill: Rgb
  readonly buttonForeground: Rgb
}

const DEFAULT_REPORT_ALPHA = { light: 0.22, dark: 0.4 } as const

function schemeInput(
  palette: HeroPalette,
  dark: boolean,
  surfaceAlpha: number,
): SeatSchemeInput {
  return {
    base: parseHex(dark ? palette.darkBase : palette.lightBase),
    oppositeBase: parseHex(dark ? palette.lightBase : palette.darkBase),
    accent: parseHex(palette.accent),
    accent2: parseHex(palette.accent2),
    dark,
    synthesized: dark ? palette.mode !== 'dark' : palette.mode !== 'light',
    surfaceAlpha,
  }
}

function deriveSeatScheme(input: SeatSchemeInput): DerivedSeatScheme {
  const { base, oppositeBase, accent, accent2, dark, synthesized, surfaceAlpha } = input
  const tint = synthesized ? (dark ? 0.08 : 0.04) : 0.02
  const surf = mix(base, accent, tint)
  const layer1Color = mix(surf, WHITE, dark ? 0.06 : 0.6)
  const layer1Alpha = dark ? 0.78 : 0.76
  const layer1Opaque = composite(layer1Color, layer1Alpha, composite(surf, surfaceAlpha, base))
  const inkSeed = dark ? mix(oppositeBase, WHITE, 0.4) : mix(oppositeBase, BLACK, 0.2)
  const toward = dark ? WHITE : BLACK
  const ink = ensureContrast(inkSeed, layer1Opaque, 4.5, toward)
  const ink2 = ensureContrast(mix(ink, surf, 0.25), layer1Opaque, 4.5, toward)
  const brandSeed = dark && synthesized ? mix(accent, WHITE, 0.22) : accent
  const brand = ensureContrast(brandSeed, layer1Opaque, 3, toward)
  const buttonForeground = dark ? base : WHITE
  const btnFill = ensureContrast(brand, buttonForeground, 4.5, dark ? WHITE : BLACK)
  const border = dark ? mix(accent, WHITE, 0.3) : accent

  const tokens: SeatScheme = {
    '--dsw-alias-bg-base': rgba(surf, surfaceAlpha),
    '--dsw-specific-sidebar-fill': rgba(surf, Math.max(0, surfaceAlpha - 0.12)),
    '--dsw-alias-bg-layer-1': rgba(layer1Color, layer1Alpha),
    '--dsw-alias-bg-layer-2': rgba(mix(surf, WHITE, dark ? 0.1 : 0.3), 0.86),
    '--dsw-alias-bg-layer-3': rgba(mix(surf, WHITE, dark ? 0.14 : 0.85), 0.94),
    '--dsw-alias-bg-overlay': rgb(mix(surf, WHITE, dark ? 0.12 : 0.5)),
    '--dsw-alias-border-l1': rgba(border, dark ? 0.14 : 0.12),
    '--dsw-alias-border-l2': rgba(border, dark ? 0.25 : 0.24),
    '--dsw-alias-border-l3': rgba(border, dark ? 0.38 : 0.4),
    '--dsw-alias-border-l4': rgba(border, dark ? 0.5 : 0.52),
    '--dsw-alias-brand-primary': rgb(brand),
    '--dsw-alias-brand-primary-invert': rgb(dark ? base : mix(surf, WHITE, 0.85)),
    '--dsw-alias-brand-text': rgb(ink),
    '--dsw-alias-label-primary': rgb(ink),
    '--dsw-alias-label-secondary': rgb(ink2),
    '--dsw-alias-label-tertiary': rgb(mix(ink, surf, 0.45)),
    '--dsw-alias-label-caption': rgb(mix(ink, surf, 0.55)),
    '--dsw-alias-label-primary-foreground': rgb(buttonForeground),
    '--dsw-alias-button-primary-fill': rgb(btnFill),
    '--dsw-alias-button-primary-hover': rgb(mix(btnFill, dark ? WHITE : BLACK, 0.12)),
    '--dsw-alias-button-primary-dimmed': rgba(ink, 0.16),
    '--dsw-alias-button-elevated-fill': rgba(mix(surf, WHITE, dark ? 0.1 : 0.85), dark ? 0.88 : 0.86),
    '--dsw-alias-button-floating-fill': rgba(mix(surf, WHITE, dark ? 0.08 : 0.9), 0.9),
    '--dsw-alias-button-floating-hover': rgba(dark ? mix(surf, WHITE, 0.16) : surf, 0.94),
    '--dsw-alias-interactive-bg-hover': rgba(ink, dark ? 0.09 : 0.07),
    '--dsw-alias-interactive-bg-active': rgba(accent, dark ? 0.15 : 0.13),
    '--dsw-alias-interactive-bg-hover-accent': rgba(accent, dark ? 0.2 : 0.17),
    '--dsw-alias-markdown-inline-code': rgba(ink, dark ? 0.14 : 0.08),
    '--dsw-alias-markdown-code-block': rgba(mix(surf, dark ? BLACK : WHITE, dark ? 0.25 : 0.7), 0.7),
    '--dsw-specific-sidebar-nav-item-active': rgba(accent, dark ? 0.15 : 0.13),
    '--dsw-specific-sidebar-nav-item-active-accent': rgba(accent, 0.22),
    '--dsw-specific-sidebar-nav-item-hover': rgba(ink, dark ? 0.09 : 0.07),
    '--dsw-specific-input-major': rgba(mix(surf, WHITE, dark ? 0.1 : 0.85), dark ? 0.86 : 0.84),
    '--dsw-specific-bubble': rgba(dark ? mix(surf, WHITE, 0.12) : surf, dark ? 0.84 : 0.8),
    '--dsw-specific-bubble-highlight': rgba(mix(surf, accent, dark ? 0.25 : 0.12), 0.9),
    '--dsw-specific-menu': rgba(mix(surf, WHITE, dark ? 0.14 : 0.9), dark ? 0.96 : 0.95),
    '--dsw-specific-selector': rgba(mix(surf, accent2, dark ? 0.18 : 0.08), dark ? 0.92 : 0.9),
    '--dsw-specific-tip': rgba(mix(surf, WHITE, dark ? 0.12 : 0.8), dark ? 0.94 : 0.92),
  }

  return { tokens, layer1Opaque, ink, ink2, brand, btnFill, buttonForeground }
}

export function seatScheme(input: SeatSchemeInput): Record<string, string> {
  return deriveSeatScheme(input).tokens
}

export function seatThemeTokens(
  hero: HeroVisual,
  alpha: { readonly light: number; readonly dark: number },
): ThemeTokenOverrides {
  const light = seatScheme(schemeInput(hero.palette, false, alpha.light))
  const dark = seatScheme(schemeInput(hero.palette, true, alpha.dark))
  const tokens: ThemeTokenOverrides = {}
  for (const name of Object.keys(light)) {
    const lightValue = light[name]
    const darkValue = dark[name]
    if (lightValue === undefined || darkValue === undefined) throw new Error(`seat token scheme mismatch: ${name}`)
    tokens[name] = { light: lightValue, dark: darkValue }
  }
  return tokens
}

/**
 * Second seat layer: syntax-highlight palette (`--shiki-token-*`) and the 开拓者
 * (user) bubble tint, both derived from the seat accents and audited for contrast.
 * Kept separate from `seatThemeTokens` so the 38-token audit stays intact.
 */
export function seatCodeTokens(hero: HeroVisual): ThemeTokenOverrides {
  const light = seatCodePalette(hero.palette, false)
  const dark = seatCodePalette(hero.palette, true)
  const bubbleLight = seatUserBubble(hero.palette, false)
  const bubbleDark = seatUserBubble(hero.palette, true)
  const tokens: ThemeTokenOverrides = {
    '--dsw-specific-bubble': { light: bubbleLight.fill, dark: bubbleDark.fill },
    '--dsw-specific-bubble-highlight': { light: bubbleLight.highlight, dark: bubbleDark.highlight },
  }
  for (const name of Object.keys(light) as (keyof typeof light)[]) tokens[name] = { light: light[name], dark: dark[name] }
  return tokens
}

function contrastRows(scheme: DerivedSeatScheme): ContrastRow[] {
  const specs = [
    ['label-primary/layer-1', scheme.ink, scheme.layer1Opaque, 4.5],
    ['label-secondary/layer-1', scheme.ink2, scheme.layer1Opaque, 4.5],
    ['foreground/button-primary-fill', scheme.buttonForeground, scheme.btnFill, 4.5],
    ['brand-primary/layer-1', scheme.brand, scheme.layer1Opaque, 3.0],
  ] as const
  return specs.map(([pair, foreground, background, min]) => {
    const ratio = contrast(foreground, background)
    return { pair, ratio, min, ok: ratio >= min }
  })
}

/** Contrast audit at the default configured surface alphas; runtime synthesis uses live alphas. */
export function seatContrastReport(hero: HeroVisual): { light: ContrastRow[]; dark: ContrastRow[] } {
  const light = deriveSeatScheme(schemeInput(hero.palette, false, DEFAULT_REPORT_ALPHA.light))
  const dark = deriveSeatScheme(schemeInput(hero.palette, true, DEFAULT_REPORT_ALPHA.dark))
  return { light: contrastRows(light), dark: contrastRows(dark) }
}

export function shouldApplySeatLayer(heroId: string | null, seatStyle: boolean): boolean {
  return seatStyle && heroId !== null && heroId !== 'cyrene' && heroVisualById(heroId) !== undefined
}
