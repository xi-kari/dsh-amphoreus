import { spawn, spawnSync } from 'node:child_process'
import { readdir, readFile, realpath, rename, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  BRAND_STICKER,
  CHIMERA_STICKERS,
  GLOBAL_HOME_DIR,
  GLOBAL_WALLPAPER_DIRS,
  GLOBAL_WALLPAPERS,
  HERO_VISUALS,
  HOME_WALLPAPER_EXTENSIONS,
  HOME_WALLPAPER_ROOT,
  homeWallpaperFile,
} from '../shared/heroes.ts'
import type { DeriveKind, DeriveProgress } from '../shared/api.ts'
import { listZip, readZipEntry } from './zip.ts'

export type { DeriveKind, DeriveProgress } from '../shared/api.ts'
export { ASSETS_LARGE_BYTES, assetsInventory, checkAssets, summarizeAssetsCheck, type AssetsCheckOptions, type AssetsCheckReport, type AssetsCheckItem, type AssetsCheckHomeFolder } from './assets-check.ts'

export interface DeriveOptions {
  readonly assetsRoot: string
  readonly cacheDir: string
  readonly magick?: string
  readonly force?: boolean
  readonly only?: readonly DeriveKind[]
  readonly onProgress?: (progress: DeriveProgress) => void
}

export interface DeriveResult {
  readonly written: number
  readonly skipped: number
  readonly failed: { file: string; error: string }[]
  readonly startedAt: number
  readonly finishedAt: number
}

export interface DeriveRuntime {
  readonly probe: (magick: string) => Promise<string | undefined>
  readonly convert: (magick: string, args: readonly string[], input: Buffer) => Promise<Buffer>
  /** Pixel size of an image (via `magick identify`); undefined when unknown. Optional: legacy runtimes omit it. */
  readonly measure?: (magick: string, input: Buffer) => Promise<{ width: number; height: number } | undefined>
}

interface SourceFile {
  readonly path: string
  readonly mtimeMs: number
  readonly size: number
}

const DERIVE_KINDS: readonly DeriveKind[] = ['covers', 'chronicle', 'cards', 'stickers', 'wallpapers', 'home']
/** Upper bound of home wallpapers derived per folder (file names sorted, extras ignored). */
export const MAX_HOME_WALLPAPERS = 12
const MAX_SOURCE_BYTES = 64 * 1024 * 1024
const MAX_MAGICK_OUTPUT_BYTES = 64 * 1024 * 1024
const MAX_MAGICK_ERROR_BYTES = 1024 * 1024
const MAGICK_TIMEOUT_MS = 120_000
let temporarySequence = 0

function contained(root: string, child: string): boolean {
  const fold = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value
  const base = fold(resolve(root))
  const target = fold(resolve(child))
  const rel = relative(base, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function validateHeroId(heroId: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(heroId)) throw new Error(`invalid hero id: ${heroId}`)
}

function cachePath(cacheDir: string, ...segments: string[]): string {
  const root = resolve(cacheDir)
  const target = resolve(root, ...segments)
  if (!contained(root, target)) throw new Error('derived path escapes cache directory')
  return target
}

export function derivedPaths(cacheDir: string, heroId: string): {
  cover34: string
  cover169: string
  chronicle: string
  card: string
  sticker: string
} {
  validateHeroId(heroId)
  return {
    cover34: cachePath(cacheDir, heroId, 'cover-34.webp'),
    cover169: cachePath(cacheDir, heroId, 'cover-169.webp'),
    chronicle: cachePath(cacheDir, heroId, 'chronicle.webp'),
    card: cachePath(cacheDir, heroId, 'card.webp'),
    sticker: cachePath(cacheDir, heroId, 'sticker.webp'),
  }
}

export function derivedWallpaperPath(cacheDir: string, index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index >= GLOBAL_WALLPAPERS.length) throw new Error(`invalid wallpaper index: ${index}`)
  return cachePath(cacheDir, '_global', `wallpaper-${index}.webp`)
}

/** `<cache>/<heroId|_global>/home-NN.webp` for the n-th home wallpaper of a seat (or the all-seat space). */
export function derivedHomeWallpaperPath(cacheDir: string, owner: string, index: number): string {
  if (owner !== '_global') validateHeroId(owner)
  if (!Number.isSafeInteger(index) || index < 0 || index >= MAX_HOME_WALLPAPERS) throw new Error(`invalid home wallpaper index: ${index}`)
  return cachePath(cacheDir, owner, homeWallpaperFile(index))
}

/**
 * Sorted image files directly inside `<assetsRoot>/<HOME_WALLPAPER_ROOT>/<folder>` (no recursion,
 * by extension allow-list, capped at MAX_HOME_WALLPAPERS). A missing folder yields an empty list.
 */
export async function listHomeWallpapers(assetsRoot: string, folder: string): Promise<string[]> {
  const directory = resolve(assetsRoot, HOME_WALLPAPER_ROOT, folder)
  if (!contained(assetsRoot, directory)) throw new Error('home wallpaper folder escapes assets root')
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (isErrno(error, 'ENOENT') || isErrno(error, 'ENOTDIR')) return []
    throw error
  }
  return entries
    .filter(entry => entry.isFile() && HOME_WALLPAPER_EXTENSIONS.includes(extname(entry.name).toLowerCase()))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'))
    .slice(0, MAX_HOME_WALLPAPERS)
}

/** First GLOBAL_WALLPAPER_DIRS candidate that exists as a directory under assetsRoot, else the legacy flat folder. */
export async function resolveGlobalWallpaperDir(assetsRoot: string): Promise<readonly string[]> {
  for (const segments of GLOBAL_WALLPAPER_DIRS) {
    try {
      if ((await stat(resolve(assetsRoot, ...segments))).isDirectory()) return segments
    } catch (error) {
      if (!isErrno(error, 'ENOENT') && !isErrno(error, 'ENOTDIR')) throw error
    }
  }
  return GLOBAL_WALLPAPER_DIRS[GLOBAL_WALLPAPER_DIRS.length - 1]!
}

export function derivedGlobalStickerPath(cacheDir: string, name: 'brand' | `chimera-${string}`): string {
  if (name !== 'brand') {
    const match = /^chimera-(\d{2})$/u.exec(name)
    const index = match === null ? 0 : Number(match[1])
    if (index < 1 || index > CHIMERA_STICKERS.length) throw new Error(`invalid global sticker name: ${name}`)
  }
  return cachePath(cacheDir, '_global', `sticker-${name}.webp`)
}

export async function probeMagick(magick = 'magick'): Promise<string | undefined> {
  const result = spawnSync(magick, ['-version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: MAX_MAGICK_ERROR_BYTES,
  })
  if (result.error !== undefined || result.status !== 0) return undefined
  const firstLine = result.stdout.split(/\r?\n/u).find(line => line.trim() !== '')?.trim()
  return firstLine === '' ? undefined : firstLine
}

function runMagick(magick: string, args: readonly string[], input: Buffer): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(magick, [...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    })
    const output: Buffer[] = []
    const errors: Buffer[] = []
    let outputBytes = 0
    let errorBytes = 0
    let forcedError: Error | undefined
    let settled = false
    const finish = (error: Error | undefined, value?: Buffer): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error === undefined && value !== undefined) resolvePromise(value)
      else rejectPromise(error ?? new Error('magick produced no output'))
    }
    const stop = (error: Error): void => {
      if (forcedError !== undefined) return
      forcedError = error
      child.kill()
    }
    const timer = setTimeout(() => stop(new Error(`magick timed out after ${MAGICK_TIMEOUT_MS}ms`)), MAGICK_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      outputBytes += buffer.length
      if (outputBytes > MAX_MAGICK_OUTPUT_BYTES) {
        stop(new Error(`magick output exceeds ${MAX_MAGICK_OUTPUT_BYTES} bytes`))
        return
      }
      output.push(buffer)
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      errorBytes += buffer.length
      if (errorBytes > MAX_MAGICK_ERROR_BYTES) {
        stop(new Error(`magick stderr exceeds ${MAX_MAGICK_ERROR_BYTES} bytes`))
        return
      }
      errors.push(buffer)
    })
    child.on('error', error => finish(error))
    child.on('close', code => {
      if (forcedError !== undefined) {
        finish(forcedError)
        return
      }
      if (code !== 0) {
        finish(new Error(`magick exited ${code}: ${Buffer.concat(errors).toString('utf8').trim()}`))
        return
      }
      const value = Buffer.concat(output)
      finish(value.length === 0 ? new Error('magick produced no output') : undefined, value)
    })
    child.stdin.on('error', () => {
      // EPIPE means magick exited early; the close handler reports its status.
    })
    child.stdin.end(input)
  })
}

async function measureImage(magick: string, input: Buffer): Promise<{ width: number; height: number } | undefined> {
  try {
    const output = await runMagick(magick, ['-', '-format', '%w %h', 'info:'], input)
    const match = /^(\d+)\s+(\d+)/u.exec(output.toString('utf8').trim())
    if (match === null) return undefined
    return { width: Number(match[1]), height: Number(match[2]) }
  } catch {
    return undefined
  }
}

const DEFAULT_RUNTIME: DeriveRuntime = { probe: probeMagick, convert: runMagick, measure: measureImage }

/** Landscape threshold: width/height at or above this counts as a horizontal wallpaper. */
export const LANDSCAPE_RATIO = 1.2

/**
 * Choose the home wallpapers to derive: every landscape file (widest first) when at least one
 * exists, otherwise all portraits by name (user rule 2026-09-05: prefer horizontal art, fall back
 * to vertical only when there is nothing else). Files whose size cannot be read count as portrait.
 */
export function selectHomeWallpapers(
  files: readonly { name: string; width?: number; height?: number }[],
  pin?: string,
): string[] {
  const ratio = (file: { width?: number; height?: number }): number =>
    file.width !== undefined && file.height !== undefined && file.height > 0 ? file.width / file.height : 0
  // A user-pinned file always leads as home-00 (it exists in the folder), whatever its shape.
  const pinned = pin !== undefined && files.some(file => file.name === pin) ? [pin] : []
  const rest = files.filter(file => file.name !== pin)
  const landscapes = rest.filter(file => ratio(file) >= LANDSCAPE_RATIO)
    .sort((left, right) => ratio(right) - ratio(left) || left.name.localeCompare(right.name, 'en'))
  if (landscapes.length > 0) return [...pinned, ...landscapes.map(file => file.name)]
  if (pinned.length > 0) return pinned
  return [...rest].sort((left, right) => left.name.localeCompare(right.name, 'en')).map(file => file.name)
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === code
}

async function canonicalizeForContainment(input: string): Promise<string> {
  const absolute = resolve(input)
  const suffix: string[] = []
  let cursor = absolute

  while (true) {
    try {
      return resolve(await realpath(cursor), ...suffix.reverse())
    } catch (error) {
      if (!isErrno(error, 'ENOENT') && !isErrno(error, 'ENOTDIR')) throw error
      const parent = dirname(cursor)
      if (parent === cursor) return absolute
      suffix.push(basename(cursor))
      cursor = parent
    }
  }
}

async function sourceFile(root: string, ...segments: string[]): Promise<SourceFile> {
  const candidate = resolve(root, ...segments)
  if (!contained(root, candidate)) throw new Error('source path escapes assets root')
  const path = await realpath(candidate)
  if (!contained(root, path)) throw new Error('source path escapes assets root')
  const info = await stat(path)
  if (!info.isFile()) throw new Error(`source is not a file: ${path}`)
  if (info.size > MAX_SOURCE_BYTES) throw new Error(`source exceeds ${MAX_SOURCE_BYTES} bytes: ${path}`)
  return { path, mtimeMs: info.mtimeMs, size: info.size }
}

async function readSource(source: SourceFile): Promise<Buffer> {
  const value = await readFile(source.path)
  if (value.length !== source.size) throw new Error(`source changed while reading: ${source.path}`)
  return value
}

async function isFresh(target: string, sourceMtime: number, force: boolean): Promise<boolean> {
  if (force) return false
  try {
    const info = await stat(target)
    return info.isFile() && info.size > 0 && info.mtimeMs >= sourceMtime
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return false
    throw error
  }
}

function assertWebp(value: Buffer): void {
  if (value.length < 12 || value.toString('ascii', 0, 4) !== 'RIFF' || value.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('magick output is not a WebP image')
  }
}

async function atomicWrite(target: string, value: Buffer): Promise<void> {
  assertWebp(value)
  await mkdir(dirname(target), { recursive: true })
  temporarySequence += 1
  const temporary = `${target}.tmp-${process.pid}-${temporarySequence}`
  try {
    await writeFile(temporary, value, { flag: 'wx' })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function deriveAssets(options: DeriveOptions, runtime: DeriveRuntime = DEFAULT_RUNTIME): Promise<DeriveResult> {
  const startedAt = Date.now()
  const assetsRoot = await realpath(resolve(options.assetsRoot))
  const rootInfo = await stat(assetsRoot)
  if (!rootInfo.isDirectory()) throw new Error('assetsRoot is not a directory')
  const cacheDir = await canonicalizeForContainment(options.cacheDir)
  if (contained(assetsRoot, cacheDir) || contained(cacheDir, assetsRoot)) {
    throw new Error('cacheDir must not overlap assetsRoot')
  }
  const magick = options.magick ?? 'magick'
  if (await runtime.probe(magick) === undefined) {
    throw new Error('ImageMagick (magick) not found; install from https://imagemagick.org and make sure "magick" is on PATH')
  }
  const requested = new Set(options.only ?? DERIVE_KINDS)
  for (const kind of requested) {
    if (!DERIVE_KINDS.includes(kind)) throw new Error(`invalid derive kind: ${kind}`)
  }
  const force = options.force === true
  const failed: { file: string; error: string }[] = []
  let written = 0
  let skipped = 0

  const recordFailure = (file: string, error: unknown): string => {
    const message = errorText(error)
    failed.push({ file, error: message })
    return message
  }
  const emit = (kind: DeriveKind, done: number, total: number, current: string, error?: string): void => {
    options.onProgress?.({ kind, done, total, current, ...(error === undefined ? {} : { error }) })
  }
  const writeDerived = async (source: SourceFile, target: string, args: readonly string[]): Promise<void> => {
    if (await isFresh(target, source.mtimeMs, force)) {
      skipped += 1
      return
    }
    const input = await readSource(source)
    const output = await runtime.convert(magick, args, input)
    await atomicWrite(target, output)
    written += 1
  }

  if (requested.has('covers')) {
    let done = 0
    for (const hero of HERO_VISUALS) {
      const paths = derivedPaths(cacheDir, hero.heroId)
      const targets = [paths.cover34, paths.cover169]
      let stale = [true, true]
      let progressError: string | undefined
      try {
        const source = await sourceFile(assetsRoot, '黄金裔杂志_13册分册压缩包', hero.assets.magazineZip)
        stale = await Promise.all(targets.map(target => isFresh(target, source.mtimeMs, force).then(fresh => !fresh)))
        skipped += stale.filter(value => !value).length
        if (stale.some(Boolean)) {
          const zip = await readSource(source)
          const covers = listZip(zip).filter(entry => {
            const name = entry.name.replaceAll('\\', '/')
            return !name.includes('/') && name.startsWith('00_')
          })
          if (covers.length !== 1) throw new Error(`expected exactly one root 00_ cover, found ${covers.length}`)
          const input = readZipEntry(zip, covers[0]!)
          const variants = [
            {
              target: paths.cover34,
              stale: stale[0]!,
              args: ['-', '-auto-orient', '-gravity', 'North', '-crop', '3:4', '+repage', '-resize', '1200x1600>', '-quality', '82', '-define', 'webp:method=6', 'webp:-'],
            },
            {
              target: paths.cover169,
              stale: stale[1]!,
              args: ['-', '-auto-orient', '-gravity', 'Center', '-crop', '16:9', '+repage', '-resize', '1920x1080>', '-quality', '82', '-define', 'webp:method=6', 'webp:-'],
            },
          ] as const
          for (const variant of variants) {
            if (!variant.stale) continue
            try {
              const output = await runtime.convert(magick, variant.args, input)
              await atomicWrite(variant.target, output)
              written += 1
            } catch (error) {
              progressError = recordFailure(variant.target, error)
            }
          }
        }
      } catch (error) {
        for (let index = 0; index < targets.length; index += 1) {
          if (stale[index]) progressError = recordFailure(targets[index]!, error)
        }
      }
      done += 1
      emit('covers', done, HERO_VISUALS.length, `${hero.heroId} cover-34.webp`, progressError)
    }
  }

  const ordinary = async (
    kind: DeriveKind,
    jobs: readonly { source: readonly string[]; target: string; current: string; args: readonly string[] }[],
  ): Promise<void> => {
    let done = 0
    for (const job of jobs) {
      let progressError: string | undefined
      try {
        const source = await sourceFile(assetsRoot, ...job.source)
        await writeDerived(source, job.target, job.args)
      } catch (error) {
        progressError = recordFailure(job.target, error)
      }
      done += 1
      emit(kind, done, jobs.length, job.current, progressError)
    }
  }

  if (requested.has('chronicle')) {
    await ordinary('chronicle', HERO_VISUALS.map(hero => ({
      source: ['翁法罗斯英雄纪', hero.assets.chronicle],
      target: derivedPaths(cacheDir, hero.heroId).chronicle,
      current: `${hero.heroId} chronicle.webp`,
      args: ['-', '-auto-orient', '-resize', '1600x1600>', '-quality', '84', 'webp:-'],
    })))
  }
  if (requested.has('cards')) {
    await ordinary('cards', HERO_VISUALS.map(hero => ({
      source: ['翁法罗斯如我所书卡牌', hero.assets.card],
      target: derivedPaths(cacheDir, hero.heroId).card,
      current: `${hero.heroId} card.webp`,
      args: ['-', '-auto-orient', '-resize', '1600x1600>', '-quality', '84', 'webp:-'],
    })))
  }
  if (requested.has('stickers')) {
    const stickerArgs = ['-', '-resize', '512x512>', '-quality', '86', '-define', 'webp:alpha-quality=90', 'webp:-']
    const seatJobs = HERO_VISUALS.map(hero => ({
      source: ['表情包', hero.assets.sticker],
      target: derivedPaths(cacheDir, hero.heroId).sticker,
      current: `${hero.heroId} sticker.webp`,
      args: stickerArgs,
    }))
    const globalJobs = [
      {
        source: ['表情包', BRAND_STICKER],
        target: derivedGlobalStickerPath(cacheDir, 'brand'),
        current: '_global sticker-brand.webp',
        args: stickerArgs,
      },
      ...CHIMERA_STICKERS.map((file, index) => {
        const name = `chimera-${String(index + 1).padStart(2, '0')}` as `chimera-${string}`
        return {
          source: ['表情包', file],
          target: derivedGlobalStickerPath(cacheDir, name),
          current: `_global sticker-${name}.webp`,
          args: stickerArgs,
        }
      }),
    ]
    await ordinary('stickers', [...seatJobs, ...globalJobs])
  }
  const wallpaperArgs = ['-', '-auto-orient', '-resize', '2560x2560>', '-quality', '80', 'webp:-']
  if (requested.has('wallpapers')) {
    const globalDir = await resolveGlobalWallpaperDir(assetsRoot)
    await ordinary('wallpapers', GLOBAL_WALLPAPERS.map((file, index) => ({
      source: [...globalDir, file],
      target: derivedWallpaperPath(cacheDir, index),
      current: `_global wallpaper-${index}.webp`,
      args: wallpaperArgs,
    })))
  }
  if (requested.has('home')) {
    // Home-space wallpapers: one folder per seat plus the all-seat group shots. Folder
    // contents are scanned (any file names), so users drop images in without renaming.
    const owners: { owner: string; folder: string; pin?: string }[] = [
      ...HERO_VISUALS.map(hero => ({
        owner: hero.heroId,
        folder: hero.assets.homeWallpaperDir,
        ...(hero.assets.homeWallpaperPin === undefined ? {} : { pin: hero.assets.homeWallpaperPin }),
      })),
      { owner: '_global', folder: GLOBAL_HOME_DIR },
    ]
    const jobs: { source: readonly string[]; target: string; current: string; args: readonly string[] }[] = []
    for (const { owner, folder, pin } of owners) {
      const names = await listHomeWallpapers(assetsRoot, folder)
      // Landscape first: the shell picks index 0 unless a session seed says otherwise, so the
      // widest image becomes home-00 and portraits only appear when no landscape exists.
      const measured = await Promise.all(names.map(async name => {
        try {
          const source = await sourceFile(assetsRoot, HOME_WALLPAPER_ROOT, folder, name)
          const size = runtime.measure === undefined ? undefined : await runtime.measure(magick, await readSource(source))
          return { name, ...(size ?? {}) }
        } catch {
          return { name }
        }
      }))
      const files = selectHomeWallpapers(measured, pin)
      files.forEach((file, index) => jobs.push({
        source: [HOME_WALLPAPER_ROOT, folder, file],
        target: derivedHomeWallpaperPath(cacheDir, owner, index),
        current: `${owner} ${homeWallpaperFile(index)}`,
        args: wallpaperArgs,
      }))
      // Drop stale extras when a folder shrank so the served set mirrors the folder.
      for (let index = files.length; index < MAX_HOME_WALLPAPERS; index += 1) {
        await rm(derivedHomeWallpaperPath(cacheDir, owner, index), { force: true }).catch(() => {})
      }
    }
    if (jobs.length > 0) await ordinary('home', jobs)
  }

  return { written, skipped, failed, startedAt, finishedAt: Date.now() }
}
