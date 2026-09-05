/**
 * User-supplied seat wallpapers (任意格式／尺寸／大小，静态或视频), stored under
 * `<dataDir>/custom-wallpapers/<heroId>/` and streamed back with Range support
 * so `<video>` can seek and loop. One file per seat: uploading replaces it.
 * Metadata (fit / position / playback) lives in `prefs.customWallpapers`.
 */
import { createReadStream } from 'node:fs'
import { mkdir, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'

export const CUSTOM_WALLPAPER_DIR = 'custom-wallpapers'

/** Accepted upload MIME → extension. Anything else is rejected with 415. */
export const CUSTOM_WALLPAPER_TYPES: Readonly<Record<string, string>> = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/apng': 'apng',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
})

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm'])
const MIME_BY_EXT: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(CUSTOM_WALLPAPER_TYPES).map(([mime, ext]) => [ext, mime])),
)
const HERO_ID = /^[a-z0-9][a-z0-9-]{0,31}$/u
const FILE_NAME = /^wallpaper\.(png|jpg|webp|gif|avif|apng|mp4|webm)$/u

export interface CustomWallpaperRecord {
  readonly heroId: string
  readonly file: string
  readonly kind: 'image' | 'video'
  readonly mime: string
  readonly bytes: number
  readonly mtimeMs: number
}

function assertHeroId(heroId: string): void {
  if (!HERO_ID.test(heroId)) throw new RangeError('invalid hero id')
}

export function customWallpaperKind(file: string): 'image' | 'video' {
  return VIDEO_EXTENSIONS.has(extname(file).slice(1).toLowerCase()) ? 'video' : 'image'
}

export class CustomWallpaperStore {
  readonly #root: string
  #index = new Map<string, CustomWallpaperRecord>()

  constructor(dataDir: string) {
    this.#root = resolve(dataDir, CUSTOM_WALLPAPER_DIR)
  }

  get root(): string { return this.#root }

  /** Rescan `<root>/<heroId>/wallpaper.<ext>`; unknown names are ignored. */
  async scan(): Promise<void> {
    const next = new Map<string, CustomWallpaperRecord>()
    let heroes: string[] = []
    try {
      heroes = (await readdir(this.#root, { withFileTypes: true })).filter(entry => entry.isDirectory() && HERO_ID.test(entry.name)).map(entry => entry.name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    for (const heroId of heroes) {
      let files: string[] = []
      try {
        files = (await readdir(join(this.#root, heroId), { withFileTypes: true })).filter(entry => entry.isFile() && FILE_NAME.test(entry.name)).map(entry => entry.name).sort()
      } catch { continue }
      const file = files[0]
      if (file === undefined) continue
      try {
        const info = await stat(join(this.#root, heroId, file))
        next.set(heroId, {
          heroId, file, kind: customWallpaperKind(file),
          mime: MIME_BY_EXT[extname(file).slice(1)] ?? 'application/octet-stream',
          bytes: info.size, mtimeMs: info.mtimeMs,
        })
      } catch { /* vanished between readdir and stat */ }
    }
    this.#index = next
  }

  list(): CustomWallpaperRecord[] {
    return [...this.#index.values()].sort((left, right) => left.heroId.localeCompare(right.heroId, 'en'))
  }

  get(heroId: string): CustomWallpaperRecord | undefined {
    return this.#index.get(heroId)
  }

  /** Public URL (cache-busted by mtime) for a stored wallpaper. */
  urlOf(record: CustomWallpaperRecord): string {
    return `/amphoreus/custom-wallpaper/${encodeURIComponent(record.heroId)}/${record.file}?v=${Math.round(record.mtimeMs)}`
  }

  /**
   * Stream an upload body to disk (no size cap — the user chose the file), then
   * atomically replace whatever the seat had. Returns the new record.
   */
  async put(heroId: string, mime: string, body: IncomingMessage): Promise<CustomWallpaperRecord> {
    assertHeroId(heroId)
    const ext = CUSTOM_WALLPAPER_TYPES[mime.toLowerCase().split(';')[0]!.trim()]
    if (ext === undefined) throw new TypeError(`unsupported wallpaper type: ${mime}`)
    const directory = join(this.#root, heroId)
    await mkdir(directory, { recursive: true })
    const temporary = join(directory, `.upload-${process.pid}-${Date.now()}.tmp`)
    try {
      await pipeline(body, createWriteStream(temporary, { flags: 'wx' }))
      const info = await stat(temporary)
      if (info.size === 0) throw new TypeError('empty upload')
      for (const existing of await readdir(directory)) {
        if (FILE_NAME.test(existing)) await rm(join(directory, existing), { force: true })
      }
      const file = `wallpaper.${ext}`
      await rename(temporary, join(directory, file))
      await writeFile(join(directory, '.origin.json'), JSON.stringify({ mime, bytes: info.size, at: Date.now() }))
      const record: CustomWallpaperRecord = { heroId, file, kind: customWallpaperKind(file), mime, bytes: info.size, mtimeMs: Date.now() }
      this.#index.set(heroId, record)
      return record
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
  }

  async remove(heroId: string): Promise<boolean> {
    assertHeroId(heroId)
    const record = this.#index.get(heroId)
    if (record === undefined) return false
    await rm(join(this.#root, heroId), { recursive: true, force: true })
    this.#index.delete(heroId)
    return true
  }

  /** GET/HEAD with Range (206) so videos seek; images get long private caching keyed by ?v. */
  async serve(request: IncomingMessage, response: ServerResponse, heroId: string, file: string): Promise<boolean> {
    if (!HERO_ID.test(heroId) || !FILE_NAME.test(file)) return false
    const record = this.#index.get(heroId)
    if (record === undefined || record.file !== file) return false
    const path = join(this.#root, heroId, file)
    const real = await realpath(path).catch(() => undefined)
    if (real === undefined || !real.toLowerCase().startsWith(resolve(this.#root).toLowerCase())) return false
    const info = await stat(real)
    const headers: Record<string, string> = {
      'content-type': record.mime,
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    }
    const range = /^bytes=(\d*)-(\d*)$/u.exec(request.headers.range ?? '')
    let start = 0
    let end = info.size - 1
    let status = 200
    if (range !== null && (range[1] !== '' || range[2] !== '')) {
      start = range[1] === '' ? Math.max(0, info.size - Number(range[2])) : Number(range[1])
      end = range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), info.size - 1) : range[1] === '' ? info.size - 1 : info.size - 1
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= info.size) {
        response.writeHead(416, { 'content-range': `bytes */${info.size}` })
        response.end()
        return true
      }
      status = 206
      headers['content-range'] = `bytes ${start}-${end}/${info.size}`
    }
    headers['content-length'] = String(end - start + 1)
    response.writeHead(status, headers)
    if (request.method === 'HEAD') {
      response.end()
      return true
    }
    await pipeline(createReadStream(real, { start, end }), response).catch(() => { /* client went away */ })
    return true
  }
}
