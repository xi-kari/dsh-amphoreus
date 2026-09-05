import { HOME_WALLPAPER_PARKED, homeWallpaperIndex, seatWallpaperUrl, type HeroVisual, type VolumeMode } from '../shared/heroes.ts'

export interface SeatWallpaperAssets {
  readonly derived: readonly string[]
  readonly assetsConfigured: boolean
  readonly derivedVersion?: number
  /** Seed (session id) selecting one of the seat's home wallpapers; undefined → the first. */
  readonly homeSeed?: string
  /** User-uploaded wallpaper URL for this seat (image only here; videos are handled by the layer). */
  readonly customUrl?: string
}

/** Derived home wallpapers (`<owner>/home-NN.webp`) present for an owner, in index order. */
export function homeWallpaperKeys(derived: readonly string[], owner: string): string[] {
  const prefix = `${owner}/`
  return derived
    .filter(key => key.startsWith(prefix) && /^home-\d{2}\.webp$/u.test(key.slice(prefix.length)))
    .sort((left, right) => left.localeCompare(right, 'en'))
}

function derivedUrlOf(key: string, version: number | undefined): string {
  const [owner, file] = key.split('/') as [string, string]
  return `/amphoreus/derived/${encodeURIComponent(owner)}/${file}${version === undefined ? '' : `?v=${encodeURIComponent(String(version))}`}`
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

/**
 * Prefer a derived home-space wallpaper (13黄金裔壁纸/<席>壁纸, one picked per session seed),
 * then the derived 16:9 magazine cover, then the original calendar as a decode fallback.
 */
export function seatWallpaperCandidates(
  hero: HeroVisual,
  assets: SeatWallpaperAssets,
): readonly string[] {
  const homes = HOME_WALLPAPER_PARKED.includes(hero.heroId) ? [] : homeWallpaperKeys(assets.derived, hero.heroId)
  // derive.ts only emits landscapes when the folder has any (portraits otherwise), so rotating by
  // session seed over the whole derived set already honours "horizontal first".
  const home = homes.length === 0
    ? undefined
    : derivedUrlOf(homes[homeWallpaperIndex(assets.homeSeed, homes.length)]!, assets.derivedVersion)
  const coverKey = `${hero.heroId}/cover-169.webp`
  const cover = assets.derived.includes(coverKey) ? derivedUrlOf(coverKey, assets.derivedVersion) : undefined
  return [
    ...(assets.customUrl === undefined ? [] : [assets.customUrl]),
    ...(home === undefined ? [] : [home]),
    ...(cover === undefined ? [] : [cover]),
    ...(assets.assetsConfigured ? [seatWallpaperUrl(hero)] : []),
  ]
}
