/**
 * User-supplied per-seat sounds (入席问候 / 发送提示音), stored under
 * `<dataDir>/seat-sounds/<heroId>/<slot>.<ext>` and streamed back with Range
 * support. Nothing here is bundled: every file is a user upload. One file per
 * (seat, slot); uploading replaces it. Playback knobs live in `prefs.seatSounds`.
 *
 * Sibling of custom-wallpapers.ts on purpose (no shared refactor): sounds add a
 * byte cap, an extension fallback for browsers that hand us an empty MIME, and a
 * two-slot layout.
 */
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { once } from 'node:events'
import { finished, pipeline } from 'node:stream/promises'
import { SEAT_SOUND_MAX_BYTES, SEAT_SOUND_SLOTS, type SeatSoundSlot } from '../shared/api.ts'

export const SEAT_SOUND_DIR = 'seat-sounds'

/** Accepted upload MIME → extension. Unknown MIME without a usable `x-amphoreus-ext` hint → 415. */
export const SEAT_SOUND_TYPES: Readonly<Record<string, string>> = Object.freeze({
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
})

/** Canonical MIME per extension (first mapping wins, so `wav` → `audio/wav`). */
const MIME_BY_EXT: Readonly<Record<string, string>> = Object.freeze(
  Object.entries(SEAT_SOUND_TYPES).reduce<Record<string, string>>((acc, [mime, ext]) => {
    if (acc[ext] === undefined) acc[ext] = mime
    return acc
  }, {}),
)
export const SEAT_SOUND_EXTENSIONS: readonly string[] = Object.freeze(Object.keys(MIME_BY_EXT))
const HERO_ID = /^[a-z0-9][a-z0-9-]{0,31}$/u
const FILE_NAME = /^(greeting|send)\.(mp3|ogg|wav|webm|m4a|aac|flac)$/u
/** Bytes we keep draining past the cap before giving up on the connection. */
const DRAIN_GRACE_BYTES = 4 * 1024 * 1024

export interface SeatSoundRecord {
  readonly heroId: string
  readonly slot: SeatSoundSlot
  readonly file: string
  readonly mime: string
  readonly bytes: number
  readonly mtimeMs: number
}

/** Upload exceeded the byte cap; the route maps it to 413 (same message shape as the JSON body limit). */
export class SeatSoundTooLargeError extends Error {
  readonly limit: number
  constructor(limit: number) {
    super(`request body exceeds ${limit} bytes`)
    this.limit = limit
  }
}

export function isSeatSoundSlot(value: string): value is SeatSoundSlot {
  return (SEAT_SOUND_SLOTS as readonly string[]).includes(value)
}

function assertHeroId(heroId: string): void {
  if (!HERO_ID.test(heroId)) throw new RangeError('invalid hero id')
}

/**
 * Pick the stored extension for an upload. `mime` wins when known; otherwise the
 * `x-amphoreus-ext` hint (dot optional, any case) is accepted when it is one of
 * ours — browsers report an empty `File.type` for .ogg/.flac on Windows.
 */
export function resolveSeatSoundExt(mime: string, extHint: string | undefined): string | undefined {
  const known = SEAT_SOUND_TYPES[mime.toLowerCase().split(';')[0]!.trim()]
  if (known !== undefined) return known
  if (extHint === undefined) return undefined
  const hint = extHint.trim().toLowerCase().replace(/^\./u, '')
  return MIME_BY_EXT[hint] === undefined ? undefined : hint
}

export class SeatSoundStore {
  readonly #root: string
  readonly #maxBytes: number
  #index = new Map<string, SeatSoundRecord>()

  constructor(dataDir: string, options: { readonly maxBytes?: number } = {}) {
    this.#root = resolve(dataDir, SEAT_SOUND_DIR)
    this.#maxBytes = options.maxBytes ?? SEAT_SOUND_MAX_BYTES
  }

  get root(): string { return this.#root }
  get maxBytes(): number { return this.#maxBytes }

  /** Rescan `<root>/<heroId>/<slot>.<ext>`; unknown names are ignored, first name per slot wins. */
  async scan(): Promise<void> {
    const next = new Map<string, SeatSoundRecord>()
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
      for (const file of files) {
        const slot = file.split('.')[0]!
        if (!isSeatSoundSlot(slot) || next.has(`${heroId}/${slot}`)) continue
        try {
          const info = await stat(join(this.#root, heroId, file))
          next.set(`${heroId}/${slot}`, {
            heroId, slot, file,
            mime: MIME_BY_EXT[extname(file).slice(1)] ?? 'application/octet-stream',
            bytes: info.size, mtimeMs: info.mtimeMs,
          })
        } catch { /* vanished between readdir and stat */ }
      }
    }
    this.#index = next
  }

  list(): SeatSoundRecord[] {
    return [...this.#index.values()].sort((left, right) => left.heroId.localeCompare(right.heroId, 'en') || left.slot.localeCompare(right.slot, 'en'))
  }

  get(heroId: string, slot: SeatSoundSlot): SeatSoundRecord | undefined {
    return this.#index.get(`${heroId}/${slot}`)
  }

  /** Public URL (cache-busted by mtime) for a stored sound. */
  urlOf(record: SeatSoundRecord): string {
    return `/amphoreus/seat-sound/${encodeURIComponent(record.heroId)}/${record.file}?v=${Math.round(record.mtimeMs)}`
  }

  /**
   * Stream an upload body to a temp file (capped at `maxBytes`), then atomically
   * replace whatever the (seat, slot) had. Throws TypeError (→ 415) for unknown
   * types / empty uploads and SeatSoundTooLargeError (→ 413) past the cap; the
   * temp file is removed on every failure path.
   */
  async put(heroId: string, slot: SeatSoundSlot, mime: string, body: IncomingMessage, extHint?: string): Promise<SeatSoundRecord> {
    assertHeroId(heroId)
    if (!isSeatSoundSlot(slot)) throw new RangeError('invalid sound slot')
    const ext = resolveSeatSoundExt(mime, extHint)
    if (ext === undefined) throw new TypeError(`unsupported sound type: ${mime || '(none)'}`)
    const directory = join(this.#root, heroId)
    await mkdir(directory, { recursive: true })
    const temporary = join(directory, `.upload-${slot}-${process.pid}-${Date.now()}.tmp`)
    try {
      const size = await this.#cappedWrite(body, temporary)
      if (size === 0) throw new TypeError('empty upload')
      for (const existing of await readdir(directory)) {
        if (FILE_NAME.test(existing) && existing.startsWith(`${slot}.`)) await rm(join(directory, existing), { force: true })
      }
      const file = `${slot}.${ext}`
      await rename(temporary, join(directory, file))
      const record: SeatSoundRecord = { heroId, slot, file, mime: MIME_BY_EXT[ext]!, bytes: size, mtimeMs: Date.now() }
      this.#index.set(`${heroId}/${slot}`, record)
      return record
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
  }

  /** Write with a byte cap; past the cap we stop writing, drain a bounded remainder so the 413 can be delivered, then throw. */
  async #cappedWrite(body: IncomingMessage, path: string): Promise<number> {
    const out = createWriteStream(path, { flags: 'wx' })
    let size = 0
    let overflow = false
    try {
      for await (const chunk of body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
        size += buffer.length
        if (overflow || size > this.#maxBytes) {
          overflow = true
          if (size > this.#maxBytes + DRAIN_GRACE_BYTES) {
            body.destroy()
            break
          }
          continue
        }
        if (!out.write(buffer)) await once(out, 'drain')
      }
    } finally {
      out.end()
      await finished(out).catch(() => {})
    }
    if (overflow) throw new SeatSoundTooLargeError(this.#maxBytes)
    return size
  }

  async remove(heroId: string, slot: SeatSoundSlot): Promise<boolean> {
    assertHeroId(heroId)
    const record = this.#index.get(`${heroId}/${slot}`)
    if (record === undefined) return false
    const directory = join(this.#root, heroId)
    await rm(join(directory, record.file), { force: true })
    this.#index.delete(`${heroId}/${slot}`)
    try {
      if ((await readdir(directory)).length === 0) await rm(directory, { recursive: true, force: true })
    } catch { /* already gone */ }
    return true
  }

  /** GET/HEAD with Range (206/416); long private caching keyed by ?v; realpath-contained. */
  async serve(request: IncomingMessage, response: ServerResponse, heroId: string, file: string): Promise<boolean> {
    if (!HERO_ID.test(heroId) || !FILE_NAME.test(file)) return false
    const slot = file.split('.')[0]!
    const record = isSeatSoundSlot(slot) ? this.#index.get(`${heroId}/${slot}`) : undefined
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
      end = range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), info.size - 1) : info.size - 1
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
