/**
 * Host-side self-check of an assets root: which known files exist, which are
 * missing or suspiciously large, and how many home wallpapers each folder holds.
 * Port of scripts/check-assets.mjs so the runtime (setup wizard, settings panel)
 * and the CLI share one inventory. Reports carry statuses only — never file contents.
 */
import { readdir, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { AssetsCheckHomeFolder, AssetsCheckItem, AssetsCheckReport } from '../shared/api.ts'
import {
  BRAND_STICKER,
  CHIMERA_STICKERS,
  GLOBAL_HOME_DIR,
  GLOBAL_WALLPAPER_DIRS,
  GLOBAL_WALLPAPERS,
  HERO_VISUALS,
  HOME_WALLPAPER_EXTENSIONS,
  HOME_WALLPAPER_ROOT,
  TRAILBLAZER_ASSETS,
} from '../shared/heroes.ts'

export type { AssetsCheckHomeFolder, AssetsCheckItem, AssetsCheckReport } from '../shared/api.ts'

export interface AssetsCheckOptions {
  /** Derived-cache directory; a root inside it (or containing it) is refused like deriveAssets does. */
  readonly cacheDir?: string
  /** Required files above this size are reported as 'large' (default 8 MiB). */
  readonly largeBytes?: number
}

export const ASSETS_LARGE_BYTES = 8 * 1024 * 1024

interface InventoryEntry {
  readonly key: string
  readonly segments: readonly string[]
}

export interface AssetsInventory {
  readonly required: readonly InventoryEntry[]
  readonly optional: readonly InventoryEntry[]
  readonly home: readonly { readonly owner: string; readonly segments: readonly string[] }[]
}

const LEGACY_WALLPAPER_DIR = GLOBAL_WALLPAPER_DIRS[GLOBAL_WALLPAPER_DIRS.length - 1]!

function displayPath(segments: readonly string[]): string {
  return segments.join('/')
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === code
}

function contained(root: string, child: string): boolean {
  const fold = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value
  const base = fold(resolve(root))
  const target = fold(resolve(child))
  const rel = relative(base, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (isErrno(error, 'ENOENT') || isErrno(error, 'ENOTDIR')) return false
    throw error
  }
}

async function globalWallpaperDir(root: string): Promise<readonly string[]> {
  for (const candidate of GLOBAL_WALLPAPER_DIRS) {
    if (await isDirectory(resolve(root, ...candidate))) return candidate
  }
  return LEGACY_WALLPAPER_DIR
}

/** Static inventory; only the location of the six global wallpapers varies per root. */
export function assetsInventory(wallpaperDir: readonly string[] = LEGACY_WALLPAPER_DIR): AssetsInventory {
  const required: InventoryEntry[] = []
  const optional: InventoryEntry[] = []
  GLOBAL_WALLPAPERS.forEach((fileName, index) => {
    required.push({ key: `wallpaper:${index}`, segments: [...wallpaperDir, fileName] })
  })
  for (const hero of HERO_VISUALS) {
    required.push({ key: `chronicle:${hero.heroId}`, segments: ['翁法罗斯英雄纪', hero.assets.chronicle] })
    required.push({ key: `card:${hero.heroId}`, segments: ['翁法罗斯如我所书卡牌', hero.assets.card] })
    required.push({ key: `calendar:${hero.heroId}`, segments: ['翁法罗斯日历', hero.assets.calendar] })
    required.push({ key: `sticker:${hero.heroId}`, segments: ['表情包', hero.assets.sticker] })
    optional.push({ key: `magazine:${hero.heroId}`, segments: ['黄金裔杂志_13册分册压缩包', hero.assets.magazineZip] })
  }
  optional.push({ key: 'sticker:brand', segments: ['表情包', BRAND_STICKER] })
  CHIMERA_STICKERS.forEach((fileName, index) => {
    optional.push({ key: `sticker:chimera-${String(index + 1).padStart(2, '0')}`, segments: ['表情包', fileName] })
  })
  for (const [id, trailblazer] of Object.entries(TRAILBLAZER_ASSETS)) {
    optional.push({ key: `gold-card:${id}`, segments: ['翁法罗斯金卡（游戏截图）', trailblazer.goldCard] })
    trailblazer.stickers.forEach((fileName, index) => {
      optional.push({ key: `sticker:${id}-${index}`, segments: ['表情包', fileName] })
    })
  }
  const home = [
    ...HERO_VISUALS.map(hero => ({ owner: hero.heroId, segments: [HOME_WALLPAPER_ROOT, hero.assets.homeWallpaperDir] as readonly string[] })),
    { owner: '_global', segments: [HOME_WALLPAPER_ROOT, GLOBAL_HOME_DIR] as readonly string[] },
  ]
  return { required, optional, home }
}

async function inspect(root: string, entry: InventoryEntry, required: boolean, largeBytes: number): Promise<AssetsCheckItem> {
  const absent: AssetsCheckItem['status'] = required ? 'missing' : 'optional-missing'
  const item = { key: entry.key, path: displayPath(entry.segments) }
  const candidate = resolve(root, ...entry.segments)
  if (!contained(root, candidate)) return { ...item, status: absent }
  try {
    const info = await stat(candidate)
    if (!info.isFile()) return { ...item, status: absent }
    return { ...item, status: required && info.size > largeBytes ? 'large' : 'ok' }
  } catch (error) {
    if (isErrno(error, 'ENOENT') || isErrno(error, 'ENOTDIR')) return { ...item, status: absent }
    throw error
  }
}

async function countHome(root: string, owner: string, segments: readonly string[]): Promise<AssetsCheckHomeFolder> {
  const directory = resolve(root, ...segments)
  const path = displayPath(segments)
  if (!contained(root, directory)) return { owner, path, count: -1 }
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const count = entries.filter(entry => entry.isFile() && HOME_WALLPAPER_EXTENSIONS.includes(extname(entry.name).toLowerCase())).length
    return { owner, path, count }
  } catch (error) {
    if (isErrno(error, 'ENOENT') || isErrno(error, 'ENOTDIR')) return { owner, path, count: -1 }
    throw error
  }
}

function emptyReport(root: string, error: string): AssetsCheckReport {
  const inventory = assetsInventory()
  return {
    root,
    ok: false,
    error,
    required: inventory.required.map(entry => ({ key: entry.key, path: displayPath(entry.segments), status: 'missing' as const })),
    optional: inventory.optional.map(entry => ({ key: entry.key, path: displayPath(entry.segments), status: 'optional-missing' as const })),
    home: inventory.home.map(entry => ({ owner: entry.owner, path: displayPath(entry.segments), count: -1 })),
    summary: {
      requiredOk: 0,
      requiredTotal: inventory.required.length,
      optionalOk: 0,
      optionalTotal: inventory.optional.length,
      large: 0,
      homePopulated: 0,
      homeTotal: inventory.home.length,
    },
    checkedAt: Date.now(),
  }
}

/**
 * Inspect `root` (an assets folder) and report the inventory status. Never throws for
 * an unusable root: the report carries `ok: false` + `error` instead. Filesystem errors
 * other than absence propagate.
 */
export async function checkAssets(root: string, options: AssetsCheckOptions = {}): Promise<AssetsCheckReport> {
  const trimmed = root.trim()
  if (trimmed === '') return emptyReport(root, 'assetsRoot is empty')
  let canonical: string
  try {
    canonical = await realpath(resolve(trimmed))
  } catch (error) {
    if (isErrno(error, 'ENOENT') || isErrno(error, 'ENOTDIR')) return emptyReport(root, 'assetsRoot does not exist')
    throw error
  }
  if (!(await stat(canonical)).isDirectory()) return emptyReport(root, 'assetsRoot is not a directory')
  if (options.cacheDir !== undefined) {
    const cache = resolve(options.cacheDir)
    if (contained(canonical, cache) || contained(cache, canonical)) {
      return { ...emptyReport(root, 'assetsRoot must not overlap the derived cache'), canonical }
    }
  }
  const largeBytes = options.largeBytes ?? ASSETS_LARGE_BYTES
  const inventory = assetsInventory(await globalWallpaperDir(canonical))
  const required = await Promise.all(inventory.required.map(entry => inspect(canonical, entry, true, largeBytes)))
  const optional = await Promise.all(inventory.optional.map(entry => inspect(canonical, entry, false, largeBytes)))
  const home = await Promise.all(inventory.home.map(entry => countHome(canonical, entry.owner, entry.segments)))
  const requiredOk = required.filter(item => item.status === 'ok' || item.status === 'large').length
  const large = required.filter(item => item.status === 'large').length
  return {
    root,
    canonical,
    ok: requiredOk === required.length,
    required,
    optional,
    home,
    summary: {
      requiredOk,
      requiredTotal: required.length,
      optionalOk: optional.filter(item => item.status === 'ok').length,
      optionalTotal: optional.length,
      large,
      homePopulated: home.filter(entry => entry.count > 0).length,
      homeTotal: home.length,
    },
    checkedAt: Date.now(),
  }
}

/** Compact one-line summary used by the CLI and logs. */
export function summarizeAssetsCheck(report: AssetsCheckReport): string {
  const s = report.summary
  if (report.error !== undefined) return `assets: ${report.error}`
  return `assets: required ${s.requiredOk}/${s.requiredTotal} ok, optional ${s.optionalOk}/${s.optionalTotal} ok, large ${s.large}, home folders ${s.homePopulated}/${s.homeTotal} populated`
}
