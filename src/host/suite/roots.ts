/**
 * Root discovery (设计文档 01 §1): expand each configured skillRoots entry,
 * canonicalize and dedupe, then select the primary root — the first root
 * whose `amphoreus/SKILL.md` has frontmatter `name` exactly `amphoreus`.
 * When no root has a router card, the first root holding at least one
 * `amphoreus-*` card directory becomes primary in cards-only mode (§1.3
 * step 4). This module never writes to any root.
 *
 * `expandRootPath` is pure over an injected {@link RootEnv}; only the
 * resolve/select functions touch the filesystem. `$DSH_HOME` expands to the
 * caller-resolved DSH home (config > env > ~/.dsh), never the raw variable;
 * `%VAR%`/`$VAR`/`${VAR}` come from the injected env with USERPROFILE/HOME
 * falling back to homedir; `~user` is unsupported and kept literal — all per
 * dsh-home-paths semantics (设计文档 01 F18).
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { homedir as osHomedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { normalizeContent, splitFrontmatter } from './markdown.ts'
import { CARD_NAME, ROUTER_NAME, type Diagnostic, type ResolvedRoot } from './types.ts'

export interface RootEnv {
  /** Environment map (usually process.env). */
  readonly env: Readonly<Record<string, string | undefined>>
  readonly homedir: () => string
  /** Already-resolved DSH home; callers compute it via resolveDshHome(). */
  readonly dshHome: string
}

export function defaultRootEnv(dshHome: string): RootEnv {
  return { env: process.env, homedir: osHomedir, dshHome }
}

export type ExpandResult =
  | { readonly kind: 'ok'; readonly expanded: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'var-unset'; readonly variable: string }

const VAR_NAME = '[A-Za-z_][A-Za-z0-9_]*'
const PERCENT_VAR = new RegExp(`%(${VAR_NAME})%`, 'g')
const BRACE_VAR = new RegExp(`\\$\\{(${VAR_NAME})\\}`, 'g')
const BARE_VAR = new RegExp(`\\$(${VAR_NAME})`, 'g')

export function expandRootPath(configured: string, renv: RootEnv): ExpandResult {
  const trimmed = configured.trim()
  if (trimmed === '') return { kind: 'empty' }
  let missing: string | undefined
  const substitute = (whole: string, name: string): string => {
    if (name === 'DSH_HOME') return renv.dshHome
    const value = renv.env[name]
    if (value !== undefined && value !== '') return value
    if (name === 'USERPROFILE' || name === 'HOME') return renv.homedir()
    missing ??= name
    return whole
  }
  const substituted = trimmed
    .replace(PERCENT_VAR, substitute)
    .replace(BRACE_VAR, substitute)
    .replace(BARE_VAR, substitute)
  if (missing !== undefined) return { kind: 'var-unset', variable: missing }
  let path = substituted
  if (path === '~') {
    path = renv.homedir()
  } else if (path.startsWith('~/') || path.startsWith('~\\')) {
    path = join(renv.homedir(), path.slice(2))
  }
  // Anything else starting with `~` (e.g. `~user`) stays literal and, being
  // relative, resolves against the DSH home like every other relative entry.
  if (!isAbsolute(path)) path = resolve(renv.dshHome, path)
  return { kind: 'ok', expanded: path }
}

function realpathNative(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

function dedupeKey(canonical: string): string {
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

export interface ResolvedRootsResult {
  readonly roots: readonly ResolvedRoot[]
  readonly diagnostics: readonly Diagnostic[]
}

/**
 * Expand, canonicalize and dedupe the configured roots. Missing roots stay in
 * the list (the watcher may see them appear later) with a root-missing
 * diagnostic; unexpandable entries are dropped with root-unexpandable.
 */
export async function resolveRoots(configured: readonly string[], renv: RootEnv): Promise<ResolvedRootsResult> {
  const roots: ResolvedRoot[] = []
  const diagnostics: Diagnostic[] = []
  const seen = new Set<string>()
  for (let index = 0; index < configured.length; index++) {
    const entry = configured[index]!
    const expansion = expandRootPath(entry, renv)
    if (expansion.kind === 'empty') {
      diagnostics.push({ code: 'root-unexpandable', severity: 'warn', detail: `skillRoots[${index}] 为空串，已跳过` })
      continue
    }
    if (expansion.kind === 'var-unset') {
      diagnostics.push({
        code: 'root-unexpandable', severity: 'warn',
        detail: `skillRoots[${index}] "${entry}" 引用未设置的变量 ${expansion.variable}，已跳过`,
      })
      continue
    }
    const expanded = expansion.expanded
    let canonical = expanded
    try {
      const info = await stat(expanded)
      if (info.isDirectory()) {
        canonical = realpathNative(expanded)
      } else {
        diagnostics.push({
          code: 'root-missing', severity: 'info', path: expanded,
          detail: `skillRoots[${index}] "${entry}" → ${expanded} 不是目录`,
        })
      }
    } catch {
      diagnostics.push({
        code: 'root-missing', severity: 'info', path: expanded,
        detail: `skillRoots[${index}] "${entry}" → ${expanded} 不存在`,
      })
    }
    const key = dedupeKey(canonical)
    if (seen.has(key)) continue
    seen.add(key)
    roots.push({ index, configured: entry, expanded, canonical })
  }
  return { roots, diagnostics }
}

export type RootProbe =
  | { readonly kind: 'router-valid' }
  | { readonly kind: 'router-missing' }
  | { readonly kind: 'router-invalid'; readonly detail: string }
  | { readonly kind: 'not-a-directory' }

/** Cheap router-card check: existence + frontmatter name only (full parsing is parse.ts's job). */
export async function probeRoot(root: ResolvedRoot): Promise<RootProbe> {
  try {
    const info = await stat(root.canonical)
    if (!info.isDirectory()) return { kind: 'not-a-directory' }
  } catch {
    return { kind: 'not-a-directory' }
  }
  let raw: string
  try {
    raw = await readFile(join(root.canonical, ROUTER_NAME, 'SKILL.md'), 'utf8')
  } catch {
    return { kind: 'router-missing' }
  }
  const split = splitFrontmatter(normalizeContent(raw))
  if (split.kind === 'yaml-error') return { kind: 'router-invalid', detail: split.message }
  if (split.kind === 'none') return { kind: 'router-invalid', detail: 'missing YAML frontmatter' }
  if (split.data.name !== ROUTER_NAME) {
    return { kind: 'router-invalid', detail: `frontmatter name ${JSON.stringify(split.data.name)} 不是 "${ROUTER_NAME}"` }
  }
  return { kind: 'router-valid' }
}

async function hasCardDir(root: ResolvedRoot): Promise<boolean> {
  let entries
  try {
    entries = await readdir(root.canonical, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    if (!CARD_NAME.test(entry.name)) continue
    try {
      const info = await stat(join(root.canonical, entry.name, 'SKILL.md'))
      if (info.isFile()) return true
    } catch {
      // A card dir without SKILL.md doesn't qualify; keep scanning.
    }
  }
  return false
}

export interface PrimarySelection {
  readonly primary: ResolvedRoot | undefined
  /** 'router' = valid router card; 'cards-only' = §1.3 step 4 fallback. */
  readonly primaryKind: 'router' | 'cards-only' | undefined
  /** Other valid roots, in configured order (§1.3 step 5). */
  readonly standby: readonly ResolvedRoot[]
  readonly diagnostics: readonly Diagnostic[]
}

/**
 * §1.3: the whole suite comes from exactly one root; the first valid one
 * wins and later valid roots are standby. Broken router frontmatter demotes a
 * root to "no router card" with a router-frontmatter-invalid diagnostic.
 */
export async function selectPrimaryRoot(roots: readonly ResolvedRoot[]): Promise<PrimarySelection> {
  const diagnostics: Diagnostic[] = []
  const valid: ResolvedRoot[] = []
  const routerless: ResolvedRoot[] = []
  for (const root of roots) {
    const probe = await probeRoot(root)
    if (probe.kind === 'router-valid') {
      valid.push(root)
    } else if (probe.kind === 'router-invalid') {
      diagnostics.push({
        code: 'router-frontmatter-invalid', severity: 'warn',
        path: join(root.canonical, ROUTER_NAME, 'SKILL.md'), detail: probe.detail,
      })
      routerless.push(root)
    } else if (probe.kind === 'router-missing') {
      routerless.push(root)
    }
  }
  if (valid.length > 0) {
    return { primary: valid[0]!, primaryKind: 'router', standby: valid.slice(1), diagnostics }
  }
  for (const root of routerless) {
    if (await hasCardDir(root)) {
      diagnostics.push({
        code: 'router-missing', severity: 'warn', path: root.canonical,
        detail: `根内无合规路由卡 ${ROUTER_NAME}/SKILL.md，按仅角色卡模式采用`,
      })
      return { primary: root, primaryKind: 'cards-only', standby: [], diagnostics }
    }
  }
  return { primary: undefined, primaryKind: undefined, standby: [], diagnostics }
}
