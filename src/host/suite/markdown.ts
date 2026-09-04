/**
 * Lexical layer of the suite parser (设计文档 01 §2.2): pure functions over
 * in-memory text, no I/O, no config. The frontmatter algorithm mirrors
 * `skill-filesystem` (parseFrontmatter / parseInvocationPolicy, checked
 * against deepseek-harness-source @ alpha.4) so the plugin and DSH always
 * agree on which cards are valid.
 */
import { parse as parseYaml } from 'yaml'
import { SKILL_NAME, type Frontmatter, type MdSection } from './types.ts'

/**
 * Text intake: strip a UTF-8 BOM and normalize CRLF to LF. No NFC
 * normalization — the suite distinguishes U+2022 from U+00B7.
 */
export function normalizeContent(raw: string): string {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return text.replaceAll('\r\n', '\n')
}

export type SplitFrontmatter =
  | { readonly kind: 'ok'; readonly data: Readonly<Record<string, unknown>>; readonly body: string; readonly bodyStartLine: number }
  | { readonly kind: 'none' }
  | { readonly kind: 'yaml-error'; readonly message: string }

/**
 * Frontmatter block detection, same algorithm as skill-filesystem: the first
 * line must be exactly `---` (a trailing CR is tolerated), the block ends at
 * the next line that is exactly `---`, and the YAML in between must parse to
 * a plain object — arrays, scalars and null all count as "no frontmatter".
 * `bodyStartLine` is the 1-based line number of the body's first line in the
 * original file, for whole-file diagnostics.
 */
export function splitFrontmatter(raw: string): SplitFrontmatter {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return { kind: 'none' }
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return { kind: 'none' }
  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, start)
  if (closing === undefined) return { kind: 'none' }
  let parsed: unknown
  try {
    parsed = parseYaml(raw.slice(start, closing.start))
  } catch (error) {
    return { kind: 'yaml-error', message: String(error) }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { kind: 'none' }
  let bodyStartLine = 1
  for (let i = 0; i < closing.bodyStart; i++) {
    if (raw.charCodeAt(i) === 10) bodyStartLine++
  }
  return { kind: 'ok', data: parsed as Record<string, unknown>, body: raw.slice(closing.bodyStart), bodyStartLine }
}

function findClosingFrontmatter(raw: string, start: number): { start: number; bodyStart: number } | undefined {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  return undefined
}

const LEGACY_INVOCATION_KEYS = [
  ['disableModelInvocation', 'disable-model-invocation'],
  ['modelInvocable', 'disable-model-invocation'],
  ['userInvocable', 'user-invocable'],
] as const

export type FrontmatterFieldsResult =
  | { readonly kind: 'ok'; readonly frontmatter: Frontmatter }
  | { readonly kind: 'missing-field'; readonly detail: string }
  | { readonly kind: 'bad-name'; readonly name: string; readonly detail: string }
  | { readonly kind: 'legacy-key'; readonly key: string; readonly detail: string }
  | { readonly kind: 'bad-boolean'; readonly detail: string }

/**
 * Field validation in skill-filesystem's order: name/description presence,
 * name shape, then invocation policy. A legacy invocation key rejects the
 * whole card; booleans accept true/yes/on/1 and false/no/off/0
 * case-insensitively. `legacy-key` maps to the card-legacy-key diagnostic,
 * every other failure to card-frontmatter-invalid.
 */
export function parseFrontmatterFields(data: Readonly<Record<string, unknown>>): FrontmatterFieldsResult {
  const name = stringField(data, 'name')
  const description = stringField(data, 'description')
  if (name === undefined || description === undefined) {
    return { kind: 'missing-field', detail: 'frontmatter requires name and description' }
  }
  if (!SKILL_NAME.test(name)) {
    return { kind: 'bad-name', name, detail: `invalid skill name "${name}"` }
  }
  for (const [legacy, canonical] of LEGACY_INVOCATION_KEYS) {
    if (Object.hasOwn(data, legacy)) {
      return { kind: 'legacy-key', key: legacy, detail: `frontmatter field "${legacy}" is unsupported; use "${canonical}"` }
    }
  }
  let disableModelInvocation: boolean | undefined
  let userInvocable: boolean | undefined
  try {
    disableModelInvocation = frontmatterBoolean(data, 'disable-model-invocation')
    userInvocable = frontmatterBoolean(data, 'user-invocable')
  } catch (error) {
    return { kind: 'bad-boolean', detail: String(error) }
  }
  return { kind: 'ok', frontmatter: { name, description, disableModelInvocation, userInvocable, raw: data } }
}

function stringField(data: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function frontmatterBoolean(data: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true':
      case 'yes':
      case 'on':
        return true
      case 'false':
      case 'no':
      case 'off':
        return false
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

const HEADING = /^(#{2,3})\s+(.+?)\s*$/
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/

/**
 * Split a body into H2 sections with H3 children (设计文档 01 §2.2). Headings
 * inside fenced code blocks (``` or ~~~) are ignored. An H2's `lines` span
 * everything up to the next H2 — including its H3 children's raw lines — so
 * semantic passes can scan a named section in one go; an H3's `lines` stop at
 * the next heading of any level. Content before the first heading belongs to
 * no section (the caller still holds the full body).
 */
export function sectionize(body: string, firstLineNumber = 1): MdSection[] {
  const lines = body.split('\n')
  const headings: { index: number; level: 2 | 3; title: string }[] = []
  let fence: { char: string; length: number } | undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fenceMatch = FENCE_OPEN.exec(line)
    if (fence !== undefined) {
      if (
        fenceMatch !== null
        && fenceMatch[1]![0] === fence.char
        && fenceMatch[1]!.length >= fence.length
        && line.slice(fenceMatch[0].length).trim() === ''
      ) {
        fence = undefined
      }
      continue
    }
    if (fenceMatch !== null) {
      fence = { char: fenceMatch[1]![0]!, length: fenceMatch[1]!.length }
      continue
    }
    const heading = HEADING.exec(line)
    if (heading !== null) {
      headings.push({ index: i, level: heading[1]!.length as 2 | 3, title: heading[2]!.trim() })
    }
  }

  const roots: MdSection[] = []
  let lastH2: MdSection | undefined
  for (let h = 0; h < headings.length; h++) {
    const { index, level, title } = headings[h]!
    let end = lines.length
    for (let k = h + 1; k < headings.length; k++) {
      if (headings[k]!.level <= level) {
        end = headings[k]!.index
        break
      }
    }
    const section: MdSection = {
      title,
      level,
      startLine: firstLineNumber + index,
      endLine: firstLineNumber + end - 1,
      lines: lines.slice(index + 1, end),
      children: [],
    }
    if (level === 2) {
      roots.push(section)
      lastH2 = section
    } else if (lastH2 !== undefined) {
      lastH2.children.push(section)
    } else {
      roots.push(section)
    }
  }
  return roots
}

export interface TableRow {
  readonly cells: readonly string[]
  readonly line: number
}

export interface ParsedTable {
  readonly headerCells: readonly string[]
  readonly rows: readonly TableRow[]
  readonly dropped: readonly { readonly line: number; readonly raw: string }[]
  readonly headerLine: number
}

const TABLE_SEPARATOR = /^\|(\s*:?-+:?\s*\|)+\s*$/

/**
 * First markdown table in `lines`: a header row starting with an ASCII `|`,
 * a `|---|` separator row, then data rows until the first line not starting
 * with `|`. U+FF5C `｜` is never a cell separator. Rows whose column count
 * differs from the header are dropped and reported for a table-row-unparsed
 * diagnostic.
 */
export function parseTable(lines: readonly string[], firstLineNumber = 1): ParsedTable | undefined {
  for (let i = 0; i + 1 < lines.length; i++) {
    const header = lines[i]!.trim()
    if (!header.startsWith('|')) continue
    if (!TABLE_SEPARATOR.test(lines[i + 1]!.trim())) continue
    const headerCells = splitCells(header)
    const rows: TableRow[] = []
    const dropped: { line: number; raw: string }[] = []
    for (let k = i + 2; k < lines.length; k++) {
      const trimmed = lines[k]!.trim()
      if (!trimmed.startsWith('|')) break
      const cells = splitCells(trimmed)
      if (cells.length === headerCells.length) {
        rows.push({ cells, line: firstLineNumber + k })
      } else {
        dropped.push({ line: firstLineNumber + k, raw: trimmed })
      }
    }
    return { headerCells, rows, dropped, headerLine: firstLineNumber + i }
  }
  return undefined
}

function splitCells(row: string): string[] {
  let text = row
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|')) text = text.slice(0, -1)
  return text.split('|').map(cell => cell.trim())
}

const INLINE_CODE = /`([^`]+)`/g

/**
 * All inline-code spans on one line, in order. Contract templates, handoff
 * lines and receipt lines all live inside inline code.
 */
export function inlineCodes(line: string): string[] {
  return [...line.matchAll(INLINE_CODE)].map(match => match[1]!)
}

/**
 * Per-line normalization before matching (设计文档 01 §2.2): trim, strip a
 * leading list marker, unwrap whole-line bold emphasis.
 */
export function normalizeLine(line: string): string {
  let text = line.trim().replace(/^[-*]\s+/, '')
  const bold = /^\*\*(.+)\*\*$/.exec(text)
  if (bold !== null) text = bold[1]!.trim()
  return text
}
