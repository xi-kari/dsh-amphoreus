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
import { randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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

/** Store options; `tempToken` is a test seam for the temp file name (default: pid + time + random). */
export interface SeatSoundStoreOptions {
  readonly maxBytes?: number
  readonly tempToken?: () => string
}

function defaultTempToken(): string {
  return `${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`
}

/** A declared `content-length` already past the cap → the route rejects before touching the body. */
export function declaredTooLarge(headers: IncomingMessage['headers'], maxBytes: number): boolean {
  const declared = Number(headers['content-length'])
  return Number.isFinite(declared) && declared > maxBytes
}

export function isSeatSoundSlot(value: string): value is SeatSoundSlot {
  return (SEAT_SOUND_SLOTS as readonly string[]).includes(value)
}

function assertHeroId(heroId: string): void {
  if (!HERO_ID.test(heroId)) throw new RangeError('invalid hero id')
}

/**
 * Pick the stored extension for an upload. A known audio `mime` wins. The
 * `x-amphoreus-ext` hint (dot optional, any case) is consulted only when the
 * declared type is empty or `application/octet-stream` — browsers report an
 * empty `File.type` for .ogg/.flac on Windows. Any other declared type → 415.
 */
export function resolveSeatSoundExt(mime: string, extHint: string | undefined): string | undefined {
  const declared = mime.toLowerCase().split(';')[0]!.trim()
  const known = SEAT_SOUND_TYPES[declared]
  if (known !== undefined) return known
  if (extHint === undefined || (declared !== '' && declared !== 'application/octet-stream')) return undefined
  const hint = extHint.trim().toLowerCase().replace(/^\./u, '')
  return MIME_BY_EXT[hint] === undefined ? undefined : hint
}

/** `child` is `root` or below it (both already canonical); case-folded on Windows like the other host helpers. */
function contained(root: string, child: string): boolean {
  const fold = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value
  const rel = relative(fold(resolve(root)), fold(resolve(child)))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/** Read a body to its end and discard it (keeps the connection orderly for the error response). */
async function drain(body: IncomingMessage): Promise<void> {
  for await (const _chunk of body.iterator({ destroyOnReturn: false })) { /* discard */ }
}

export class SeatSoundStore {
  readonly #root: string
  /** `realpath(#root)` (lazily resolved, falls back to #root): serve() compares realpath'd files against THIS, so a junction/symlink dataDir still contains its own files. */
  #realRoot: string | undefined
  readonly #maxBytes: number
  readonly #tempToken: () => string
  #index = new Map<string, SeatSoundRecord>()
  /** Per-hero mutation queue: put/remove on one seat run one at a time (rename-over and directory pruning must not interleave). */
  readonly #queues = new Map<string, Promise<unknown>>()

  constructor(dataDir: string, options: SeatSoundStoreOptions = {}) {
    this.#root = resolve(dataDir, SEAT_SOUND_DIR)
    this.#maxBytes = options.maxBytes ?? SEAT_SOUND_MAX_BYTES
    this.#tempToken = options.tempToken ?? defaultTempToken
  }

  get root(): string { return this.#root }
  get maxBytes(): number { return this.#maxBytes }

  /** Canonical root for containment checks; a missing root (nothing uploaded yet) keeps the configured path. */
  async #canonicalRoot(): Promise<string> {
    if (this.#realRoot === undefined) {
      this.#realRoot = await realpath(this.#root).catch(() => undefined)
      if (this.#realRoot === undefined) return this.#root
    }
    return this.#realRoot
  }

  /** Rescan `<root>/<heroId>/<slot>.<ext>`; unknown names are ignored, first name per slot wins. */
  async scan(): Promise<void> {
    this.#realRoot = undefined
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
   * temp file is removed on every failure path and an empty hero directory is
   * pruned. The body is never destroyed and is always read to its end, so the
   * route can answer on the same connection (a reset would discard the 413).
   * A declared `content-length` past the cap is rejected before any disk work.
   */
  async put(heroId: string, slot: SeatSoundSlot, mime: string, body: IncomingMessage, extHint?: string): Promise<SeatSoundRecord> {
    assertHeroId(heroId)
    if (!isSeatSoundSlot(slot)) throw new RangeError('invalid sound slot')
    const ext = resolveSeatSoundExt(mime, extHint)
    if (ext === undefined) throw new TypeError(`unsupported sound type: ${mime || '(none)'}`)
    if (declaredTooLarge(body.headers ?? {}, this.#maxBytes)) {
      await drain(body)
      throw new SeatSoundTooLargeError(this.#maxBytes)
    }
    return this.#serialized(heroId, () => this.#putUnlocked(heroId, slot, ext, body))
  }

  /** Run `task` after every earlier put/remove for the same hero has settled. */
  #serialized<T>(heroId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(heroId) ?? Promise.resolve()
    const run = previous.then(task, task)
    const settled = run.then(() => undefined, () => undefined)
    this.#queues.set(heroId, settled)
    void settled.then(() => { if (this.#queues.get(heroId) === settled) this.#queues.delete(heroId) })
    return run
  }

  async #putUnlocked(heroId: string, slot: SeatSoundSlot, ext: string, body: IncomingMessage): Promise<SeatSoundRecord> {
    const directory = join(this.#root, heroId)
    await mkdir(directory, { recursive: true })
    const temporary = join(directory, `.upload-${slot}-${this.#tempToken()}.tmp`)
    const opened = { value: false }
    let done = false
    try {
      const size = await this.#cappedWrite(body, temporary, opened)
      if (size === 0) throw new TypeError('empty upload')
      for (const existing of await readdir(directory)) {
        if (FILE_NAME.test(existing) && existing.startsWith(`${slot}.`)) await rm(join(directory, existing), { force: true })
      }
      const file = `${slot}.${ext}`
      await rename(temporary, join(directory, file))
      const record: SeatSoundRecord = { heroId, slot, file, mime: MIME_BY_EXT[ext]!, bytes: size, mtimeMs: Date.now() }
      this.#index.set(`${heroId}/${slot}`, record)
      done = true
      return record
    } finally {
      // Only remove what we created: an EEXIST collision must not delete a sibling upload's temp file.
      if (opened.value) await rm(temporary, { force: true }).catch(() => {})
      if (!done) await this.#pruneEmpty(directory)
    }
  }

  /**
   * Write with a byte cap. The WriteStream's 'error' is consumed from the start
   * (open failures such as EEXIST/ENOENT/EACCES/ENOSPC surface as a rejection,
   * never as an uncaught 'error' event). Past the cap nothing more is written;
   * the remainder is read and discarded so the 413 travels back on an orderly
   * connection instead of a reset (which would drop it on the client side).
   */
  async #cappedWrite(body: IncomingMessage, path: string, opened: { value: boolean }): Promise<number> {
    const out = createWriteStream(path, { flags: 'wx' })
    let failure: Error | undefined
    const failed = new Promise<never>((_, reject) => {
      out.on('error', (error: Error) => {
        failure ??= error
        reject(error)
      })
    })
    failed.catch(() => { /* observed through `failure` */ })
    let size = 0
    let overflow = false
    try {
      await Promise.race([once(out, 'open'), failed])
      opened.value = true
      for await (const chunk of body.iterator({ destroyOnReturn: false })) {
        if (failure !== undefined) throw failure
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
        size += buffer.length
        if (overflow || size > this.#maxBytes) {
          overflow = true
          continue
        }
        if (!out.write(buffer)) await Promise.race([once(out, 'drain'), failed])
      }
    } finally {
      out.end()
      await finished(out).catch(() => {})
    }
    if (failure !== undefined) throw failure
    if (overflow) throw new SeatSoundTooLargeError(this.#maxBytes)
    return size
  }

  async #pruneEmpty(directory: string): Promise<void> {
    try {
      if ((await readdir(directory)).length === 0) await rm(directory, { recursive: true, force: true })
    } catch { /* already gone */ }
  }

  async remove(heroId: string, slot: SeatSoundSlot): Promise<boolean> {
    assertHeroId(heroId)
    return this.#serialized(heroId, () => this.#removeUnlocked(heroId, slot))
  }

  async #removeUnlocked(heroId: string, slot: SeatSoundSlot): Promise<boolean> {
    const record = this.#index.get(`${heroId}/${slot}`)
    if (record === undefined) return false
    const directory = join(this.#root, heroId)
    await rm(join(directory, record.file), { force: true })
    this.#index.delete(`${heroId}/${slot}`)
    await this.#pruneEmpty(directory)
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
    if (real === undefined || !contained(await this.#canonicalRoot(), real)) return false
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
