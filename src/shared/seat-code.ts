/**
 * Per-seat syntax-highlight (`--shiki-token-*`) and user-bubble palettes.
 * DSH's CodeBlock renders through shiki's css-variables theme, so the seat
 * token layer can recolour code the way zhijun-dai/Catppuccin-dsh-theme does
 * for its four flavours — here one palette per Chrysos Heir, derived from the
 * seat accents and audited to ≥4.5:1 on the seat's own code-block ground.
 */
import { BLACK, WHITE, composite, ensureContrast, mix, parseHex, rgb, type Rgb } from './color.ts'
import type { HeroPalette } from './heroes.ts'

export const SHIKI_TOKEN_NAMES = [
  '--shiki-token-constant',
  '--shiki-token-string',
  '--shiki-token-comment',
  '--shiki-token-keyword',
  '--shiki-token-parameter',
  '--shiki-token-function',
  '--shiki-token-string-expression',
  '--shiki-token-punctuation',
  '--shiki-token-link',
] as const

export type ShikiTokenName = (typeof SHIKI_TOKEN_NAMES)[number]

/** Rotate an sRGB colour's hue by `degrees` (HSL round-trip; fine for palette seeds). */
export function rotateHue(value: Rgb, degrees: number): Rgb {
  const [r, g, b] = value.map(channel => channel / 255) as [number, number, number]
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  h = (h + degrees + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let rr = 0, gg = 0, bb = 0
  if (h < 60) [rr, gg, bb] = [c, x, 0]
  else if (h < 120) [rr, gg, bb] = [x, c, 0]
  else if (h < 180) [rr, gg, bb] = [0, c, x]
  else if (h < 240) [rr, gg, bb] = [0, x, c]
  else if (h < 300) [rr, gg, bb] = [x, 0, c]
  else [rr, gg, bb] = [c, 0, x]
  return [Math.round((rr + m) * 255), Math.round((gg + m) * 255), Math.round((bb + m) * 255)]
}

/**
 * Code palette for one seat/scheme. The code-block ground is the seat surface
 * mixed toward black/white like seat-theme's markdown-code-block token; every
 * token colour is pushed until it clears 4.5:1 on that ground, comments 3.5:1.
 */
export function seatCodePalette(palette: HeroPalette, dark: boolean): Record<ShikiTokenName, string> {
  const base = parseHex(dark ? palette.darkBase : palette.lightBase)
  const accent = parseHex(palette.accent)
  const accent2 = parseHex(palette.accent2)
  const accent3 = palette.accent3 === undefined ? rotateHue(accent, 40) : parseHex(palette.accent3)
  const ground = composite(mix(base, dark ? BLACK : WHITE, dark ? 0.25 : 0.7), 0.7, base)
  const toward = dark ? WHITE : BLACK
  const seeds: Record<ShikiTokenName, { colour: Rgb; min: number }> = {
    '--shiki-token-keyword': { colour: accent, min: 4.5 },
    '--shiki-token-function': { colour: accent2, min: 4.5 },
    '--shiki-token-constant': { colour: rotateHue(accent, -70), min: 4.5 },
    '--shiki-token-string': { colour: rotateHue(accent2, 110), min: 4.5 },
    '--shiki-token-string-expression': { colour: rotateHue(accent2, 90), min: 4.5 },
    '--shiki-token-parameter': { colour: accent3, min: 4.5 },
    '--shiki-token-link': { colour: rotateHue(accent, 160), min: 4.5 },
    '--shiki-token-punctuation': { colour: mix(toward, base, 0.45), min: 4.5 },
    '--shiki-token-comment': { colour: mix(toward, base, 0.55), min: 3.5 },
  }
  const out = {} as Record<ShikiTokenName, string>
  for (const name of SHIKI_TOKEN_NAMES) {
    const seed = seeds[name]
    // Lift dark-scheme seeds toward white first so saturated seat accents stay readable.
    const start = dark ? mix(seed.colour, WHITE, 0.3) : mix(seed.colour, BLACK, 0.08)
    out[name] = rgb(ensureContrast(start, ground, seed.min, toward))
  }
  return out
}

/**
 * User (开拓者) bubble tint: the seat's second accent as a pale wash so the
 * user's turns read as "the visitor" against the seat's own paper.
 */
export function seatUserBubble(palette: HeroPalette, dark: boolean): { readonly fill: string; readonly highlight: string } {
  const base = parseHex(dark ? palette.darkBase : palette.lightBase)
  const accent2 = parseHex(palette.accent2)
  const fill = mix(base, accent2, dark ? 0.28 : 0.16)
  const highlight = mix(base, accent2, dark ? 0.4 : 0.26)
  return { fill: rgb(fill), highlight: rgb(highlight) }
}
