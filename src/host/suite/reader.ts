import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { normalizeContent, parseFrontmatterFields, splitFrontmatter } from './markdown.ts'
import type { SuiteCardFiles, SuiteFiles, SuiteTextFile } from './parse.ts'
import { CARD_NAME, type Diagnostic, type Frontmatter, type ResolvedRoot } from './types.ts'

const MAX_BYTES = 1024 * 1024
const MAX_LINES = 20_000
const MAX_ROOT_ENTRIES = 200
const SUITE_DIR = /^amphoreus(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/

export interface FreshSkillFile {
  readonly path: string
  readonly directory: string
  readonly sha256: string
  readonly frontmatter: Frontmatter
  readonly body: string
}

export interface LoadSuiteOptions {
  readonly root: ResolvedRoot
  readonly roots: readonly ResolvedRoot[]
  readonly commonPath: string
  readonly relationsPath: string
  readonly diagnostics?: readonly Diagnostic[]
  readonly signal?: AbortSignal
}

/** Central read-only boundary for suite roots. */
export class SuiteReader {
  readonly root: string
  readonly #diagnostics: Diagnostic[]

  private constructor(root: string, diagnostics: Diagnostic[]) {
    this.root = root
    this.#diagnostics = diagnostics
  }

  static async create(root: string, diagnostics: Diagnostic[] = []): Promise<SuiteReader> {
    return new SuiteReader(await realpath(resolve(root)), diagnostics)
  }

  get diagnostics(): readonly Diagnostic[] {
    return this.#diagnostics
  }

  async listCardDirs(signal?: AbortSignal): Promise<readonly { name: string; path: string }[]> {
    throwIfAborted(signal)
    const entries = await readdir(this.root, { withFileTypes: true })
    if (entries.length > MAX_ROOT_ENTRIES) {
      this.#diagnostics.push({
        code: 'file-too-large',
        severity: 'warn',
        path: this.root,
        detail: `技能根顶层条目 ${entries.length} 超过扫描上限 ${MAX_ROOT_ENTRIES}`,
      })
    }
    const result: { name: string; path: string }[] = []
    for (const entry of entries.slice(0, MAX_ROOT_ENTRIES)) {
      throwIfAborted(signal)
      if (!CARD_NAME.test(entry.name)) continue
      const guarded = await this.guardPath(entry.name)
      if (guarded === undefined) continue
      let info
      try {
        info = await stat(guarded)
      } catch {
        continue
      }
      if (info.isDirectory()) result.push({ name: entry.name, path: guarded })
    }
    return result.sort((a, b) => a.name.localeCompare(b.name, 'en'))
  }

  /**
   * Return a canonical contained path. Missing targets return undefined;
   * lexical traversal and link/junction escapes are diagnosed and rejected.
   */
  async guardPath(rel: string): Promise<string | undefined> {
    const normalized = rel.replaceAll('\\', '/')
    const segments = normalized.split('/')
    if (
      rel.includes('\0')
      || rel === ''
      || isAbsolute(rel)
      || segments.some(segment => segment === '' || segment === '.' || segment === '..')
      || !SUITE_DIR.test(segments[0] ?? '')
    ) {
      this.#diagnostics.push({ code: 'symlink-escape', severity: 'warn', detail: `拒绝技能根外路径 ${JSON.stringify(rel)}` })
      return undefined
    }
    const candidate = resolve(this.root, ...segments)
    if (!contained(this.root, candidate)) {
      this.#diagnostics.push({ code: 'symlink-escape', severity: 'warn', path: candidate, detail: `路径越出技能根：${rel}` })
      return undefined
    }
    try {
      await lstat(candidate)
      const canonical = await realpath(candidate)
      if (!contained(this.root, canonical)) {
        this.#diagnostics.push({ code: 'symlink-escape', severity: 'warn', path: candidate, detail: `链接目标越出技能根：${rel}` })
        return undefined
      }
      return canonical
    } catch (error) {
      if (isMissing(error)) return undefined
      this.#diagnostics.push({ code: 'io-error', severity: 'warn', path: candidate, detail: String(error) })
      return undefined
    }
  }

  async readText(rel: string, maxBytes = MAX_BYTES, signal?: AbortSignal): Promise<string | undefined> {
    throwIfAborted(signal)
    const path = await this.guardPath(rel)
    if (path === undefined) return undefined
    let info
    try {
      info = await stat(path)
    } catch (error) {
      if (isMissing(error)) return undefined
      this.#diagnostics.push({ code: 'io-error', severity: 'warn', path, detail: String(error) })
      return undefined
    }
    if (!info.isFile()) return undefined
    if (info.size > maxBytes) {
      this.#diagnostics.push({ code: 'file-too-large', severity: 'warn', path, detail: `文件 ${info.size} bytes 超过上限 ${maxBytes}` })
      return undefined
    }
    throwIfAborted(signal)
    const text = await readFile(path, 'utf8')
    throwIfAborted(signal)
    if (lineCount(text) > MAX_LINES) {
      this.#diagnostics.push({ code: 'file-too-large', severity: 'warn', path, detail: `文件行数超过上限 ${MAX_LINES}` })
      return undefined
    }
    return text
  }

  async readTextFile(rel: string, signal?: AbortSignal): Promise<SuiteTextFile | undefined> {
    const path = await this.guardPath(rel)
    if (path === undefined) return undefined
    const content = await this.readText(rel, MAX_BYTES, signal)
    return content === undefined ? undefined : { path, content }
  }

  async readSkillPath(absolutePath: string, signal?: AbortSignal): Promise<FreshSkillFile | undefined> {
    throwIfAborted(signal)
    const requested = resolve(absolutePath)
    let canonical: string
    try {
      canonical = await realpath(requested)
    } catch (error) {
      if (isMissing(error)) return undefined
      this.#diagnostics.push({ code: 'io-error', severity: 'warn', path: requested, detail: String(error) })
      return undefined
    }
    throwIfAborted(signal)
    const rel = relative(this.root, canonical).split(sep).join('/')
    const path = await this.guardPath(rel)
    if (path === undefined) return undefined
    const content = await this.readText(rel, MAX_BYTES, signal)
    if (content === undefined) return undefined
    const normalized = normalizeContent(content)
    const split = splitFrontmatter(normalized)
    if (split.kind !== 'ok') return undefined
    const fields = parseFrontmatterFields(split.data)
    if (fields.kind !== 'ok') return undefined
    return {
      path,
      directory: resolve(path, '..'),
      sha256: createHash('sha256').update(normalized, 'utf8').digest('hex'),
      frontmatter: fields.frontmatter,
      body: split.body.trim(),
    }
  }

  async loadSuiteFiles(options: LoadSuiteOptions): Promise<SuiteFiles> {
    const cards: SuiteCardFiles[] = []
    for (const card of await this.listCardDirs(options.signal)) {
      const skillRel = `${card.name}/SKILL.md`
      const personaRel = `${card.name}/persona.md`
      const skill = await this.readTextFile(skillRel, options.signal)
      const personaPath = await this.guardPath(personaRel)
      const persona = personaPath === undefined ? undefined : { path: personaPath, content: '' }
      cards.push({ dir: card.name, ...(skill === undefined ? {} : { skill }), ...(persona === undefined ? {} : { persona }) })
    }
    const router = await this.readTextFile('amphoreus/SKILL.md', options.signal)
    const common = await this.readTextFile(options.commonPath, options.signal)
    const relations = await this.readTextFile(options.relationsPath, options.signal)
    return {
      root: options.root,
      roots: options.roots,
      cards,
      diagnostics: [...(options.diagnostics ?? []), ...this.#diagnostics],
      ...(router === undefined ? {} : { router }),
      ...(common === undefined ? {} : { common }),
      ...(relations === undefined ? {} : { relations }),
    }
  }
}

function contained(root: string, child: string): boolean {
  const fold = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value
  const base = fold(resolve(root))
  const target = fold(resolve(child))
  return target === base || target.startsWith(`${base}${sep}`)
}

function lineCount(text: string): number {
  let count = 1
  for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) === 10) count++
  return count
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}
