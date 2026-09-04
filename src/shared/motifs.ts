import type { HeroMotif } from './heroes.ts'

export interface MotifOptions {
  /** Six-digit CSS hex color. */
  readonly color: string
  /** Opacity applied to the complete motif; defaults to 0.12. */
  readonly opacity?: number
  /** Square tile size in CSS pixels; defaults to 64. */
  readonly size?: number
}

interface NormalizedMotifOptions {
  readonly color: string
  readonly opacity: number
  readonly size: number
}

const HEX_COLOR = /^#[0-9a-f]{6}$/iu
const DEFAULT_OPACITY = 0.12
const DEFAULT_SIZE = 64
const MAX_SIZE = 4096

function normalizeOptions(options: MotifOptions): NormalizedMotifOptions {
  if (!HEX_COLOR.test(options.color)) {
    throw new TypeError('motif color must be a six-digit hex color')
  }

  const opacity = options.opacity ?? DEFAULT_OPACITY
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new RangeError('motif opacity must be a finite number between 0 and 1')
  }

  const size = options.size ?? DEFAULT_SIZE
  if (!Number.isFinite(size) || size <= 0 || size > MAX_SIZE) {
    throw new RangeError(`motif size must be a finite number between 0 and ${MAX_SIZE}`)
  }

  return { color: options.color, opacity, size }
}

function group(options: MotifOptions, primitives: string): string {
  const { color, opacity } = normalizeOptions(options)
  return `<g stroke="${color}" fill="${color}" opacity="${opacity}">${primitives}</g>`
}

function goldThread(options: MotifOptions): string {
  return group(options,
    '<path d="M0 64L64 0" fill="none" stroke-width=".8"/>'
    + '<path d="M-16 48L16 80" fill="none" stroke-width=".8"/>'
    + '<path d="M32 29l3 3-3 3-3-3z" stroke="none"/>',
  )
}

function stars(options: MotifOptions): string {
  return group(options,
    '<path d="M32 18l3 11 11 3-11 3-3 11-3-11-11-3 11-3z" stroke="none"/>'
    + '<circle cx="8" cy="8" r="1.2" stroke="none"/>'
    + '<circle cx="56" cy="52" r="1.2" stroke="none"/>',
  )
}

function lion(options: MotifOptions): string {
  return group(options,
    '<path d="M32 32m-18 0a18 18 0 0 1 36 0" fill="none" stroke-width="1.2"/>'
    + '<path d="M32 12v6 M20 17l3 5 M44 17l-3 5" fill="none" stroke-width="1.2" stroke-linecap="round"/>',
  )
}

function butterfly(options: MotifOptions): string {
  return group(options,
    '<path d="M32 32c-8-14-22-12-18 0s10 14 18 0z" stroke="none"/>'
    + '<path d="M32 32c8-14 22-12 18 0s-10 14-18 0z" stroke="none"/>'
    + '<path d="M32 22v20" fill="none" stroke-width=".8"/>',
  )
}

function astrolabe(options: MotifOptions): string {
  const ticks = Array.from({ length: 12 }, (_, index) =>
    `<path d="M32 10v4" fill="none" transform="rotate(${index * 30} 32 32)"/>`,
  ).join('')
  return group(options,
    '<circle cx="32" cy="32" r="22" fill="none" stroke-width="1"/>'
    + '<circle cx="32" cy="32" r="14" fill="none" stroke-width="1"/>'
    + ticks
    + '<circle cx="32" cy="32" r="1.5" stroke="none"/>',
  )
}

function clouds(options: MotifOptions): string {
  return group(options,
    '<circle cx="24" cy="36" r="8" stroke="none"/>'
    + '<circle cx="34" cy="30" r="11" stroke="none"/>'
    + '<circle cx="44" cy="37" r="7" stroke="none"/>'
    + '<path d="M16 40h36" fill="none" stroke-width="1" stroke-linecap="round"/>',
  )
}

function coins(options: MotifOptions): string {
  return group(options,
    '<circle cx="32" cy="32" r="13" fill="none" stroke-width="1.4"/>'
    + '<rect x="27" y="27" width="10" height="10" fill="none" stroke-width="1"/>'
    + '<circle cx="8" cy="8" r="1" stroke="none"/>'
    + '<circle cx="56" cy="8" r="1" stroke="none"/>'
    + '<circle cx="8" cy="56" r="1" stroke="none"/>'
    + '<circle cx="56" cy="56" r="1" stroke="none"/>',
  )
}

function arches(options: MotifOptions): string {
  return group(options,
    '<path d="M12 56V32a20 20 0 0 1 40 0V56" fill="none" stroke-width="1.4"/>'
    + '<path d="M12 56v4 M52 56v4" fill="none" stroke-width="1.4"/>'
    + '<path d="M30 12h4v4h-4z" stroke="none"/>',
  )
}

function waves(options: MotifOptions): string {
  return group(options,
    '<path d="M0 28c8-8 16-8 24 0s16 8 24 0 16-8 24 0" fill="none" stroke-width="1.2"/>'
    + '<path d="M0 44c8-8 16-8 24 0s16 8 24 0 16-8 24 0" fill="none" stroke-width="1.2"/>',
  )
}

function checker(options: MotifOptions): string {
  return group(options,
    '<rect x="0" y="0" width="32" height="32" stroke="none"/>'
    + '<rect x="32" y="32" width="32" height="32" stroke="none"/>',
  )
}

function film(options: MotifOptions): string {
  const perforations = [8, 53].flatMap(y =>
    [12, 24, 36, 48].map(x =>
      `<rect x="${x}" y="${y}" width="5" height="3" rx=".8" stroke="none"/>`,
    ),
  ).join('')
  return group(options,
    '<rect x="8" y="14" width="48" height="36" rx="2" fill="none" stroke-width="1.2"/>'
    + perforations,
  )
}

function scales(options: MotifOptions): string {
  return group(options,
    '<path d="M0 24a16 16 0 0 1 32 0 M32 24a16 16 0 0 1 32 0" fill="none" stroke-width="1.1"/>'
    + '<path d="M-16 40a16 16 0 0 1 32 0 M16 40a16 16 0 0 1 32 0 M48 40a16 16 0 0 1 32 0" fill="none" stroke-width="1.1"/>'
    + '<path d="M0 56a16 16 0 0 1 32 0 M32 56a16 16 0 0 1 32 0" fill="none" stroke-width="1.1"/>',
  )
}

function ripples(options: MotifOptions): string {
  return group(options,
    '<circle cx="40" cy="28" r="6" fill="none" stroke-width="1"/>'
    + '<circle cx="40" cy="28" r="13" fill="none" stroke-width="1"/>'
    + '<circle cx="40" cy="28" r="20" fill="none" stroke-width="1"/>'
    + '<circle cx="14" cy="50" r="4" fill="none" stroke-width="1"/>',
  )
}

export const MOTIFS: Readonly<Record<HeroMotif, (options: MotifOptions) => string>> = Object.freeze({
  'gold-thread': goldThread,
  stars,
  lion,
  butterfly,
  astrolabe,
  clouds,
  coins,
  arches,
  waves,
  checker,
  film,
  scales,
  ripples,
})

export function motifSvg(motif: HeroMotif, options: MotifOptions): string {
  if (!Object.hasOwn(MOTIFS, motif)) throw new TypeError(`unknown motif: ${motif}`)
  const { size } = normalizeOptions(options)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" shape-rendering="geometricPrecision">${MOTIFS[motif](options)}</svg>`
}

export function motifDataUri(motif: HeroMotif, options: MotifOptions): string {
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(motifSvg(motif, options))}")`
}
