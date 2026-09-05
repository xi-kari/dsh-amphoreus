import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { CARD_NAME, type SuiteFingerprint } from './types.ts'

const execFileAsync = promisify(execFile)
const MISSING = 'MISSING'

interface CachedDigest {
  readonly size: number
  readonly mtimeMs: number
  readonly sha256: string
}

export class FingerprintCache {
  #root: string | undefined
  readonly #files = new Map<string, CachedDigest>()

  prepare(root: string): void {
    const canonical = resolve(root)
    if (this.#root === canonical) return
    this.#root = canonical
    this.#files.clear()
  }

  get(relativePath: string): CachedDigest | undefined {
    return this.#files.get(relativePath)
  }

  set(relativePath: string, value: CachedDigest): void {
    this.#files.set(relativePath, value)
  }

  prune(known: ReadonlySet<string>): void {
    for (const key of this.#files.keys()) {
      if (!known.has(key)) this.#files.delete(key)
    }
  }

  clear(): void {
    this.#root = undefined
    this.#files.clear()
  }
}

export interface FingerprintOptions {
  readonly cache?: FingerprintCache
  readonly includeManifest?: boolean
  readonly computedAt?: number
  readonly gitBin?: string
  readonly gitTimeoutMs?: number
}

/**
 * Content identity for every runtime-relevant suite file. The manifest is
 * always content keyed; size and mtime only avoid re-reading unchanged files.
 */
export async function computeSuiteFingerprint(root: string, options: FingerprintOptions = {}): Promise<SuiteFingerprint> {
  const canonical = resolve(root)
  const cache = options.cache ?? new FingerprintCache()
  cache.prepare(canonical)
  const relativePaths = await suiteManifestPaths(canonical)
  const known = new Set(relativePaths)
  cache.prune(known)

  const internal: { rel: string; sha256: string; size: number; mtimeMs: number }[] = []
  for (const rel of relativePaths) {
    const absolute = join(canonical, ...rel.split('/'))
    let info
    try {
      info = await stat(absolute)
      if (!info.isFile()) throw missingError()
    } catch (error) {
      if (!isMissing(error)) throw error
      internal.push({ rel, sha256: MISSING, size: 0, mtimeMs: 0 })
      continue
    }
    const cached = cache.get(rel)
    let digest: string
    if (cached !== undefined && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
      digest = cached.sha256
    } else {
      digest = createHash('sha256').update(await readFile(absolute)).digest('hex')
      cache.set(rel, { size: info.size, mtimeMs: info.mtimeMs, sha256: digest })
    }
    internal.push({ rel, sha256: digest, size: info.size, mtimeMs: info.mtimeMs })
  }

  const manifestText = internal.map(entry => entry.sha256 === MISSING
    ? `${entry.rel}\0${MISSING}`
    : `${entry.rel}\0${entry.sha256}\0${entry.size}`).join('\n')
  const statText = internal.map(entry => `${entry.rel}\0${entry.size}\0${entry.mtimeMs}`).join('\n')
  const manifestSha256 = hashText(manifestText)
  const statDigest = hashText(statText)
  const git = await readGitIdentity(canonical, options.gitBin ?? 'git', options.gitTimeoutMs ?? 3000)
  const label = git === undefined
    ? `sha256:${manifestSha256.slice(0, 12)}`
    : `${git.head.slice(0, 7)}${git.describe === undefined ? '' : ` (${git.describe})`}${git.dirty ? '+dirty' : ''}`

  return {
    manifestSha256,
    statDigest,
    fileCount: internal.length,
    label,
    computedAt: options.computedAt ?? Date.now(),
    ...(git === undefined ? {} : { git }),
    ...(options.includeManifest === false
      ? {}
      : { manifest: internal.map(({ rel, sha256, size }) => ({ rel, sha256, size })) }),
  }
}

/** Runtime-relevant paths only; evals and every unrelated skill are excluded. */
export async function suiteManifestPaths(root: string): Promise<readonly string[]> {
  const result = new Set<string>([
    'amphoreus/SKILL.md',
    'amphoreus/references/common.md',
    'amphoreus/references/relations.md',
    'amphoreus/scripts/validate.py',
  ])

  for (const rel of ['amphoreus/scripts/stickers.py', 'amphoreus/assets/stickers/manifest.json']) {
    try {
      const path = join(root, ...rel.split('/'))
      if (await insideRoot(root, path) && (await stat(path)).isFile()) result.add(rel)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
  try {
    const directory = join(root, 'amphoreus', 'assets', 'stickers')
    if (await insideRoot(root, directory)) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if ((entry.isFile() || entry.isSymbolicLink()) && /^[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/u.test(entry.name)
          && await insideRoot(directory, join(directory, entry.name))) {
          result.add(`amphoreus/assets/stickers/${entry.name}`)
        }
      }
    }
  } catch (error) {
    if (!isMissing(error)) throw error
  }

  try {
    for (const entry of await readdir(join(root, 'amphoreus', 'references'), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) result.add(`amphoreus/references/${entry.name}`)
    }
  } catch (error) {
    if (!isMissing(error)) throw error
  }

  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!CARD_NAME.test(entry.name)) continue
      let directory = entry.isDirectory()
      if (!directory) {
        try {
          directory = (await stat(join(root, entry.name))).isDirectory()
        } catch (error) {
          if (!isMissing(error)) throw error
        }
      }
      if (!directory) continue
      result.add(`${entry.name}/SKILL.md`)
      result.add(`${entry.name}/persona.md`)
    }
  } catch (error) {
    if (!isMissing(error)) throw error
  }

  return [...result].sort(codePointCompare)
}

async function insideRoot(root: string, child: string): Promise<boolean> {
  const fold = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value
  const rel = relative(fold(await realpath(root)), fold(await realpath(child)))
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** True only for paths whose first segment belongs to this suite. */
export function isSuiteWatchPath(filename: string | Buffer | null): boolean {
  if (filename === null) return true
  const normalized = filename.toString().replaceAll('\\', '/')
  const first = normalized.split('/', 1)[0] ?? ''
  return first === 'amphoreus' || CARD_NAME.test(first)
}

function codePointCompare(left: string, right: string): number {
  const a = [...left]
  const b = [...right]
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index++) {
    const delta = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!
    if (delta !== 0) return delta
  }
  return a.length - b.length
}

async function readGitIdentity(
  root: string,
  gitBin: string,
  timeout: number,
): Promise<SuiteFingerprint['git'] | undefined> {
  try {
    const head = (await runGit(gitBin, root, ['rev-parse', 'HEAD'], timeout)).trim()
    if (!/^[0-9a-f]{40,64}$/iu.test(head)) return undefined
    let describe: string | undefined
    try {
      const value = (await runGit(gitBin, root, ['describe', '--tags', '--exact-match'], timeout)).trim()
      if (value !== '') describe = value
    } catch {
      // An untagged commit is a normal state.
    }
    const status = await runGit(gitBin, root, ['status', '--porcelain', '--', 'amphoreus', 'amphoreus-*'], timeout)
    return { head, dirty: status.trim() !== '', ...(describe === undefined ? {} : { describe }) }
  } catch {
    return undefined
  }
}

async function runGit(gitBin: string, root: string, args: readonly string[], timeout: number): Promise<string> {
  const { stdout } = await execFileAsync(gitBin, ['-C', root, ...args], {
    timeout,
    windowsHide: true,
    encoding: 'utf8',
  })
  return stdout
}

function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function missingError(): NodeJS.ErrnoException {
  const error = new Error('not a regular file') as NodeJS.ErrnoException
  error.code = 'ENOENT'
  return error
}

/** Convert an absolute child path to the manifest's portable relative form. */
export function manifestRelativePath(root: string, child: string): string {
  return relative(resolve(root), resolve(child)).split(sep).join('/')
}
