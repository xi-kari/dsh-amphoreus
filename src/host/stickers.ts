import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'

const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:webp|gif|png)$/u

export type StickerExtension = 'webp' | 'gif' | 'png'
export interface StickerFormat {
  readonly ext: StickerExtension
  readonly mime: string
}

/** Served formats; the manifest extension decides which magic bytes the file must carry. */
export const STICKER_FORMATS: Readonly<Record<StickerExtension, StickerFormat & { readonly sniff: (body: Buffer) => boolean }>> = {
  webp: { ext: 'webp', mime: 'image/webp', sniff: isWebP },
  gif: { ext: 'gif', mime: 'image/gif', sniff: isGif },
  png: { ext: 'png', mime: 'image/png', sniff: isPng },
}

/** Format declared by a manifest file name; undefined for anything outside the served extensions. */
export function stickerFormatOf(file: string): StickerFormat | undefined {
  if (!FILE.test(file)) return undefined
  const ext = file.slice(file.lastIndexOf('.') + 1) as StickerExtension
  const format = STICKER_FORMATS[ext]
  return format === undefined ? undefined : { ext: format.ext, mime: format.mime }
}

const CatalogSchema = z.object({
  version: z.literal(1),
  speakers: z.array(z.object({
    key: z.string().max(96).regex(KEY),
    name: z.string().min(1).max(120),
    aliases: z.array(z.string().min(1).max(120)),
    default: z.string().max(96).regex(KEY),
  })),
  items: z.array(z.object({
    key: z.string().max(96).regex(KEY),
    speaker: z.string().max(96).regex(KEY),
    label: z.string().max(120).optional(),
    file: z.string().max(101).regex(FILE),
  })),
})

type ManifestCatalog = z.infer<typeof CatalogSchema>
export type StickerItem = ManifestCatalog['items'][number] & { readonly ext: StickerExtension }
export type StickerCatalog = Omit<ManifestCatalog, 'items'> & { readonly items: StickerItem[] }

export interface StickerAsset {
  readonly body: Buffer
  readonly mime: string
  readonly ext: StickerExtension
}

/** Fresh external metadata, limited to registered images whose bytes match their declared extension. */
export async function loadStickerCatalog(root: string): Promise<StickerCatalog | undefined> {
  const loaded = await readCatalog(root)
  if (loaded === undefined) return undefined
  const items: StickerItem[] = []
  for (const item of loaded.catalog.items) {
    const format = stickerFormatOf(item.file)
    if (format === undefined) continue
    const header = await readContainedFile(loaded.root, loaded.directory, item.file, 12)
    if (header !== undefined && STICKER_FORMATS[format.ext].sniff(header)) items.push({ ...item, ext: format.ext })
  }
  return { ...loaded.catalog, items }
}

/** Reads a manifest key; caller-controlled filesystem paths are never accepted. */
export async function readSticker(root: string, key: string): Promise<StickerAsset | undefined> {
  if (!KEY.test(key) || key.length > 96) return undefined
  const loaded = await readCatalog(root)
  const item = loaded?.catalog.items.find(candidate => candidate.key === key)
  if (loaded === undefined || item === undefined) return undefined
  const format = stickerFormatOf(item.file)
  if (format === undefined) return undefined
  const body = await readContainedFile(loaded.root, loaded.directory, item.file)
  return body !== undefined && STICKER_FORMATS[format.ext].sniff(body) ? { body, mime: format.mime, ext: format.ext } : undefined
}

async function readCatalog(root: string): Promise<{ root: string; directory: string; catalog: ManifestCatalog } | undefined> {
  try {
    const canonical = await realpath(root)
    const directory = join(canonical, 'amphoreus', 'assets', 'stickers')
    const body = await readContainedFile(canonical, directory, 'manifest.json')
    if (body === undefined) return undefined
    const parsed = CatalogSchema.safeParse(JSON.parse(body.toString('utf8')))
    if (!parsed.success) return undefined
    const catalog = parsed.data
    const speakers = new Map(catalog.speakers.map(speaker => [speaker.key, speaker]))
    const items = new Map(catalog.items.map(item => [item.key, item]))
    if (speakers.size !== catalog.speakers.length || items.size !== catalog.items.length) return undefined
    if (catalog.items.some(item => !speakers.has(item.speaker))) return undefined
    if (catalog.speakers.some(speaker => items.get(speaker.default)?.speaker !== speaker.key)) return undefined
    return { root: canonical, directory, catalog }
  } catch {
    return undefined
  }
}

async function readContainedFile(root: string, directory: string, file: string, length?: number): Promise<Buffer | undefined> {
  let handle
  try {
    const canonicalDirectory = await realpath(directory)
    if (!contained(root, canonicalDirectory)) return undefined
    const candidate = join(directory, file)
    const before = await realpath(candidate)
    if (!contained(canonicalDirectory, before)) return undefined
    handle = await open(before, 'r')
    const opened = await handle.stat()
    if (!opened.isFile()) return undefined
    const body = length === undefined ? await handle.readFile() : Buffer.alloc(Math.min(length, opened.size))
    if (length !== undefined) {
      const result = await handle.read(body, 0, body.length, 0)
      if (result.bytesRead !== body.length) return undefined
    }
    const afterDirectory = await realpath(directory)
    const after = await realpath(candidate)
    if (!samePath(canonicalDirectory, afterDirectory) || !contained(root, afterDirectory)
      || !samePath(before, after) || !contained(afterDirectory, after)) return undefined
    const pathInfo = await stat(after)
    if (opened.dev !== pathInfo.dev || opened.ino !== pathInfo.ino) return undefined
    return body
  } catch {
    return undefined
  } finally {
    await handle?.close()
  }
}

function isWebP(body: Buffer): boolean {
  return body.length >= 12 && body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP'
}

function isGif(body: Buffer): boolean {
  if (body.length < 6) return false
  const header = body.toString('ascii', 0, 6)
  return header === 'GIF87a' || header === 'GIF89a'
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function isPng(body: Buffer): boolean {
  return body.length >= PNG_SIGNATURE.length && body.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right)
}

function contained(root: string, child: string): boolean {
  const fold = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value
  const rel = relative(fold(resolve(root)), fold(resolve(child)))
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
