import { BLACK, WHITE, composite, contrast, ensureContrast, type Rgb } from '../shared/color.ts'

export interface GlassMaterialInput {
  readonly base: Rgb
  readonly primary: Rgb
  readonly secondary: Rgb
  readonly body: Rgb
  readonly dark: boolean
  readonly frost: number
  readonly blur: number
  readonly wallpaper: boolean
}

export interface GlassMaterial {
  readonly base: Rgb
  readonly primary: Rgb
  readonly secondary: Rgb
  readonly body: Rgb
  readonly floor: number
  readonly paneAlpha: number
  readonly contentAlpha: number
  readonly inputAlpha: number
  readonly dialogAlpha: number
  readonly blur: number
  readonly dialogBlur: number
  readonly sheenAlpha: number
}

const TARGET = 4.6

function bounded(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value)) : fallback
}

function color(value: unknown, fallback: Rgb): Rgb {
  if (!Array.isArray(value) || value.length !== 3) return fallback
  const channel = (index: 0 | 1 | 2): number => Math.round(bounded(value[index], fallback[index], 0, 255))
  return [channel(0), channel(1), channel(2)]
}

/** Derive opaque colours and coverage that remains readable over any RGB backdrop. */
export function deriveGlassMaterial(input: GlassMaterialInput): GlassMaterial {
  const source: Partial<GlassMaterialInput> = input !== null && typeof input === 'object' ? input : {}
  const dark = source.dark === true
  const wallpaper = source.wallpaper === true
  let base = color(source.base, dark ? [26, 22, 49] : [244, 242, 248])
  let toward = contrast(BLACK, base) >= contrast(WHITE, base) ? BLACK : WHITE
  if (contrast(toward, base) < TARGET) {
    toward = dark ? WHITE : BLACK
    base = ensureContrast(base, toward, TARGET, dark ? BLACK : WHITE, 1 / 255, 255)
  }
  const ink = (value: unknown): Rgb => ensureContrast(color(value, toward), base, TARGET, toward, 1 / 255, 255)
  const primary = ink(source.primary)
  const secondary = ink(source.secondary)
  const body = ink(source.body)
  const foregrounds = [primary, secondary, body]
  const passes = (alpha: number): boolean => [BLACK, WHITE].every(backdrop => {
    const surface = composite(base, alpha, backdrop)
    return foregrounds.every(foreground => contrast(foreground, surface) >= TARGET)
  })
  let low = 0
  let high = 1
  for (let index = 0; index < 24; index += 1) {
    const middle = (low + high) / 2
    if (passes(middle)) high = middle
    else low = middle
  }
  const minimum = Math.max(dark ? 0.64 : 0.56, wallpaper ? 0 : 0.92)
  const floor = Math.min(1, Math.ceil(Math.max(minimum, high) * 1000) / 1000)
  const frost = bounded(source.frost, 0.78, 0.42, 1)
  const glaze = 0.06 + 0.24 * (frost - 0.42) / 0.58
  const cover = (minimum: number): number => {
    const alpha = Math.max(floor, minimum)
    return Math.min(1, alpha + (1 - alpha) * glaze)
  }
  const paneAlpha = cover(0)
  const contentAlpha = wallpaper ? Math.max(paneAlpha, dark ? 0.88 : 0.84) : cover(0.96)
  const inputAlpha = wallpaper ? Math.max(contentAlpha, 0.9) : cover(0.97)
  const dialogAlpha = wallpaper ? Math.max(paneAlpha, dark ? 0.92 : 0.88) : cover(0.97)
  const blur = bounded(source.blur, 14, 0, 36)
  const sheenSurfaces = [paneAlpha, contentAlpha, inputAlpha, dialogAlpha, 1]
    .flatMap(alpha => [BLACK, WHITE].map(backdrop => composite(base, alpha, backdrop)))
  const sheenPasses = (alpha: number): boolean => sheenSurfaces.every(surface =>
    foregrounds.every(foreground => contrast(foreground, composite(WHITE, alpha, surface)) >= TARGET))
  let sheenLow = 0
  let sheenHigh = dark ? 0.055 : 0.12
  for (let index = 0; index < 24; index++) {
    const middle = (sheenLow + sheenHigh) / 2
    if (sheenPasses(middle)) sheenLow = middle
    else sheenHigh = middle
  }
  const sheenAlpha = Math.floor(sheenLow * 1000) / 1000
  return {
    base, primary, secondary, body, floor, paneAlpha, contentAlpha, inputAlpha, dialogAlpha,
    blur, dialogBlur: blur === 0 ? 0 : Math.min(36, blur + 4), sheenAlpha,
  }
}

export interface LiquidShellMaterial {
  readonly base: Rgb
  readonly primary: Rgb
  readonly secondary: Rgb
  readonly floor: number
  readonly paneAlpha: number
  readonly inputAlpha: number
  readonly dialogAlpha: number
  readonly sheenAlpha: number
}

/** Keep shell text readable independently of the conversation's reading surface. */
export function deriveLiquidShellMaterial(input: GlassMaterialInput): LiquidShellMaterial {
  const source: Partial<GlassMaterialInput> = input !== null && typeof input === 'object' ? input : {}
  const material = deriveGlassMaterial(input)
  const dark = source.dark === true
  const toward = contrast(BLACK, material.base) >= contrast(WHITE, material.base) ? BLACK : WHITE
  const away = toward === BLACK ? WHITE : BLACK
  const base = ensureContrast(material.base, toward, 10.5, away, 1 / 255, 255)
  const available = contrast(toward, base)
  const primary = ensureContrast(material.primary, base, Math.min(available, dark ? 14 : 10), toward, 1 / 255, 255)
  const secondary = ensureContrast(material.secondary, base, Math.min(available, dark ? 13 : 10), toward, 1 / 255, 255)
  const sheenAlpha = dark ? .025 : .04
  const passes = (alpha: number): boolean => [BLACK, WHITE].every(backdrop =>
    [0, sheenAlpha].every(sheen => {
      const surface = composite(WHITE, sheen, composite(base, alpha, backdrop))
      return [primary, secondary].every(ink => contrast(ink, surface) >= TARGET)
    }))
  let low = 0
  let high = 1
  for (let index = 0; index < 24; index++) {
    const middle = (low + high) / 2
    if (passes(middle)) high = middle
    else low = middle
  }
  const floor = source.wallpaper === true ? Math.min(1, Math.ceil(high * 1000) / 1000) : 1
  const frost = bounded(source.frost, .78, .42, 1)
  const glaze = .02 + .05 * (frost - .42) / .58
  const cover = (extra: number): number => Math.min(1, floor + (1 - floor) * (glaze + extra))
  return { base, primary, secondary, floor, paneAlpha: cover(0), inputAlpha: cover(.02), dialogAlpha: cover(.04), sheenAlpha }
}
