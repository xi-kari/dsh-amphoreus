import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'

const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
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
    file: z.string().max(101).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/u),
  })),
})

export type StickerCatalog = z.infer<typeof CatalogSchema>

/** Fresh external metadata, limited to registered images that can be served. */
export async function loadStickerCatalog(root: string): Promise<StickerCatalog | undefined> {
  const loaded = await readCatalog(root)
  if (loaded === undefined) return undefined
  const items: StickerCatalog['items'] = []
  for (const item of loaded.catalog.items) {
    const header = await readContainedFile(loaded.root, loaded.directory, item.file, 12)
    if (header !== undefined && isWebP(header)) items.push(item)
  }
  return { ...loaded.catalog, items }
}

/** Reads a manifest key; caller-controlled filesystem paths are never accepted. */
export async function readSticker(root: string, key: string): Promise<Buffer | undefined> {
  if (!KEY.test(key) || key.length > 96) return undefined
  const loaded = await readCatalog(root)
  const item = loaded?.catalog.items.find(candidate => candidate.key === key)
  if (loaded === undefined || item === undefined) return undefined
  const body = await readContainedFile(loaded.root, loaded.directory, item.file)
  return body !== undefined && isWebP(body) ? body : undefined
}

async function readCatalog(root: string): Promise<{ root: string; directory: string; catalog: StickerCatalog } | undefined> {
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
