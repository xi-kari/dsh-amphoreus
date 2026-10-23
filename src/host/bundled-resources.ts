import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MAX_BUNDLED_RESOURCE_BYTES = 256 * 1024 * 1024
const MAX_RESOURCE_FILE_BYTES = 64 * 1024 * 1024

export const BUNDLED_VISUAL_DEFAULTS = {
  wallpaperCursor: 0,
  backgroundMode: 'preset' as const,
  magazineMode: 'full' as const,
  grammar: { frostScale: 1, mascot: 'reactive' as const, ambient: true },
  codeBackground: { enabled: true, intensity: 0.7, interactive: true },
}

export interface BundledResourceFile {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

export interface BundledResourceManifest {
  readonly schemaVersion: 1
  readonly originals: number
  readonly derived: number
  readonly bytes: number
  readonly files: readonly BundledResourceFile[]
}

export interface PrepareBundledResourcesOptions {
  readonly dataDir: string
  readonly configuredAssetsRoot: string
  readonly savedAssetsRoot?: string | undefined
  readonly hasExistingStore: boolean
  readonly moduleUrl?: string | URL
  readonly resourcesRoot?: string
}

export interface PreparedBundledResources {
  readonly assetsRoot: string
  readonly copiedFiles: number
  readonly originals: number
  readonly derived: number
  readonly defaultPrefs?: typeof BUNDLED_VISUAL_DEFAULTS
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

export function bundledResourcePath(root: string, path: string): string {
  if (path === '' || isAbsolute(path) || path.includes('\\') || path.includes(':')
    || path.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`Invalid bundled resource path: ${path}`)
  }
  return join(root, ...path.split('/'))
}

export function parseBundledResourceManifest(value: unknown): BundledResourceManifest {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.files)
    || value.files.length === 0 || value.files.length > 1000) throw new Error('Invalid bundled resources manifest.')
  const paths = new Set<string>()
  const files = value.files.map((entry: unknown): BundledResourceFile => {
    if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.bytes !== 'number'
      || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes > MAX_RESOURCE_FILE_BYTES
      || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(entry.sha256)) {
      throw new Error('Invalid bundled resource record.')
    }
    bundledResourcePath('.', entry.path)
    const original = /^assets\/.+\.(?:png|jpe?g|webp|gif)$/iu.test(entry.path)
    const derived = /^assets-cache\/(?:_global|[a-z0-9][a-z0-9-]*)\/[a-z0-9-]+\.webp$/u.test(entry.path)
    if (!original && !derived && entry.path !== 'ASSETS-NOTICE.txt') throw new Error(`Unexpected bundled resource: ${entry.path}`)
    if (paths.has(entry.path)) throw new Error(`Duplicate bundled resource: ${entry.path}`)
    paths.add(entry.path)
    return { path: entry.path, bytes: entry.bytes, sha256: entry.sha256 }
  })
  const bytes = files.reduce((total, entry) => total + entry.bytes, 0)
  const originals = files.filter(entry => entry.path.startsWith('assets/')).length
  const derived = files.filter(entry => entry.path.startsWith('assets-cache/')).length
  if (originals === 0 || derived === 0 || !paths.has('ASSETS-NOTICE.txt')
    || value.bytes !== bytes || value.originals !== originals || value.derived !== derived
    || bytes > MAX_BUNDLED_RESOURCE_BYTES) throw new Error('Bundled resource totals or required contents are invalid.')
  return { schemaVersion: 1, originals, derived, bytes, files }
}

export async function inspectBundledResources(root: string): Promise<BundledResourceManifest> {
  const canonical = await realpath(root)
  const manifest = parseBundledResourceManifest(JSON.parse(await readFile(join(canonical, 'manifest.json'), 'utf8')) as unknown)
  for (const entry of manifest.files) {
    const path = bundledResourcePath(canonical, entry.path)
    const info = await lstat(path)
    const actual = await realpath(path)
    const rel = relative(canonical, actual)
    if (!info.isFile() || info.isSymbolicLink() || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
      throw new Error(`Bundled resource is not a contained regular file: ${entry.path}`)
    }
    if (info.size !== entry.bytes) throw new Error(`Bundled resource integrity mismatch: ${entry.path}`)
    const bytes = await readFile(actual)
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Bundled resource integrity mismatch: ${entry.path}`)
  }
  return manifest
}

export async function discoverBundledResources(moduleUrl: string | URL = import.meta.url): Promise<string | undefined> {
  let directory = dirname(fileURLToPath(moduleUrl))
  for (let depth = 0; depth < 8; depth += 1) {
    let manifest: unknown
    try { manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as unknown }
    catch (error) { if (!hasCode(error, 'ENOENT')) throw error }
    if (isRecord(manifest) && manifest.name === 'dsh-amphoreus') {
      const root = join(directory, 'resources')
      try {
        if (!(await lstat(root)).isDirectory()) throw new Error('Bundled resources path is not a directory.')
        return root
      } catch (error) {
        if (hasCode(error, 'ENOENT')) return undefined
        throw error
      }
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return undefined
}

async function ensureCacheDirectory(dataDir: string, segments: readonly string[]): Promise<string> {
  await mkdir(dataDir, { recursive: true })
  let directory = dataDir
  for (const segment of segments) {
    directory = join(directory, segment)
    try {
      const info = await lstat(directory)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Bundled assets need a regular cache directory: ${directory}`)
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error
      await mkdir(directory)
    }
  }
  return directory
}

export async function prepareBundledResources(options: PrepareBundledResourcesOptions): Promise<PreparedBundledResources | undefined> {
  if (options.savedAssetsRoot?.trim() || options.configuredAssetsRoot.trim()) return undefined
  const root = options.resourcesRoot ?? await discoverBundledResources(options.moduleUrl)
  if (root === undefined) return undefined
  const manifest = await inspectBundledResources(root)
  let copiedFiles = 0
  for (const entry of manifest.files) {
    if (!entry.path.startsWith('assets-cache/')) continue
    const parts = entry.path.split('/')
    const filename = parts.pop()!
    const directory = await ensureCacheDirectory(resolve(options.dataDir), parts)
    try {
      await copyFile(bundledResourcePath(root, entry.path), join(directory, filename), constants.COPYFILE_EXCL)
      copiedFiles += 1
    } catch (error) { if (!hasCode(error, 'EEXIST')) throw error }
  }
  return {
    assetsRoot: resolve(root, 'assets'), copiedFiles, originals: manifest.originals, derived: manifest.derived,
    ...options.hasExistingStore ? {} : { defaultPrefs: structuredClone(BUNDLED_VISUAL_DEFAULTS) },
  }
}
