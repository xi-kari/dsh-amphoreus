import { seatWallpaperUrl, type HeroVisual, type VolumeMode } from '../shared/heroes.ts'

export interface SeatWallpaperAssets {
  readonly derived: readonly string[]
  readonly assetsConfigured: boolean
  readonly derivedVersion?: number
}

const MASK_FACTORS: Readonly<Record<VolumeMode, number>> = {
  light: 1.3,
  mid: 1,
  dark: 0.8,
}

export function seatMaskFactor(mode: VolumeMode): number {
  return MASK_FACTORS[mode]
}

export function clampMask(value: number): number {
  return Math.min(0.9, Math.max(0, value))
}

export function cssUrl(url: string): string {
  return `url("${url.replaceAll('"', '%22')}")`
}

/** Prefer a derived 16:9 cover, then retain the original calendar as a decode fallback. */
export function seatWallpaperCandidates(
  hero: HeroVisual,
  assets: SeatWallpaperAssets,
): readonly string[] {
  const key = `${hero.heroId}/cover-169.webp`
  const derived = assets.derived.includes(key)
    ? `/amphoreus/derived/${encodeURIComponent(hero.heroId)}/cover-169.webp${
      assets.derivedVersion === undefined ? '' : `?v=${encodeURIComponent(String(assets.derivedVersion))}`
    }`
    : undefined
  return [
    ...(derived === undefined ? [] : [derived]),
    ...(assets.assetsConfigured ? [seatWallpaperUrl(hero)] : []),
  ]
}
