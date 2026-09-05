import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { test } from 'node:test'
import {
  createScanner,
  createSourceFile,
  isFunctionDeclaration,
  LanguageVariant,
  ScriptKind,
  ScriptTarget,
  SyntaxKind,
} from 'typescript'
import { parseSuite, type SuiteTextFile } from '../src/host/suite/parse.ts'
import type { ResolvedRoot } from '../src/host/suite/types.ts'

const FIXTURE_FIREWALL_WORDS = [
  '回执',
  '档位',
  '读取：',
  '逐字',
  '锚点',
  'pageid',
  'revid',
  'content_sha256',
  'voice_id',
  '缺答',
  '完成数',
  '证据回查',
  'module_unavailable',
  '移交物',
  '风格税',
  '深度门',
  '升档',
  '降档',
  '盲评',
  'rubric',
] as const

const LOCALE_SETTING_PROCESS_KEYS = new Set([
  'settings.visualHint',
  'settings.magazineMode',
])

interface Range {
  readonly start: number
  readonly end: number
}

function masked(source: string, ranges: readonly Range[]): string {
  const characters = source.split('')
  for (const { start, end } of ranges) {
    for (let index = start; index < end; index += 1) {
      if (characters[index] !== '\n' && characters[index] !== '\r') characters[index] = ' '
    }
  }
  return characters.join('')
}

function commentRanges(source: string): Range[] {
  const scanner = createScanner(ScriptTarget.Latest, false, LanguageVariant.JSX, source)
  const ranges: Range[] = []
  for (let token = scanner.scan(); token !== SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === SyntaxKind.SingleLineCommentTrivia || token === SyntaxKind.MultiLineCommentTrivia) {
      ranges.push({ start: scanner.getTokenPos(), end: scanner.getTextPos() })
    }
  }
  return ranges
}

function lineRanges(source: string, predicate: (line: string) => boolean): Range[] {
  const ranges: Range[] = []
  let start = 0
  for (const line of source.split(/(?<=\n)/u)) {
    if (predicate(line)) ranges.push({ start, end: start + line.length })
    start += line.length
  }
  return ranges
}

function maskWorkbench(source: string): string {
  const sourceFile = createSourceFile('workbench/app.js', source, ScriptTarget.Latest, true, ScriptKind.JS)
  const ledger = sourceFile.statements.find(statement =>
    isFunctionDeclaration(statement) && statement.name?.text === 'renderLedger')
  assert.ok(ledger?.body !== undefined, 'workbench/app.js: renderLedger body is missing')
  const ranges: Range[] = [
    { start: ledger.body.getStart(sourceFile), end: ledger.body.end },
    ...commentRanges(source),
  ]
  for (const match of source.matchAll(/\btitle\s*=\s*"[^"]*"/gu)) {
    assert.notEqual(match.index, undefined)
    ranges.push({ start: match.index, end: match.index + match[0].length })
  }
  return masked(source, ranges)
}

function maskClient(name: string, source: string): string {
  if (name === 'settings.tsx') return masked(source, [{ start: 0, end: source.length }])
  if (name === 'locales.ts') {
    return masked(source, lineRanges(source, line => {
      const key = /^\s*['"]([^'"]+)['"]\s*:/u.exec(line)?.[1]
      return key !== undefined && (LOCALE_SETTING_PROCESS_KEYS.has(key) || key.endsWith('Tip'))
    }))
  }
  if (name === 'handoff.ts') {
    return masked(source, [
      ...commentRanges(source),
      ...lineRanges(source, line => line.includes('observationKey')),
    ])
  }
  return source
}

function findViolations(
  path: string,
  source: string,
  words: readonly string[],
): string[] {
  const violations: string[] = []
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    for (const word of words) {
      if (line.includes(word)) violations.push(`${path}:${index + 1}:${word}`)
    }
  }
  return violations
}

async function realFirewallWords(configured: string): Promise<readonly string[]> {
  const expanded = expandTilde(configured)
  const canonical = await realpath(resolve(expanded))
  const root: ResolvedRoot = { index: 0, configured, expanded, canonical }
  const router = await textFile(join(canonical, 'amphoreus', 'SKILL.md'))
  const common = await textFile(join(canonical, 'amphoreus', 'references', 'common.md'))
  const snapshot = parseSuite({ root, roots: [root], router, common, cards: [] }, { parsedAt: 1, generation: 1 })
  return snapshot.contracts?.firewallWords ?? []
}

function expandTilde(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

async function textFile(path: string): Promise<SuiteTextFile> {
  return { path, content: await readFile(path, 'utf8') }
}

test('twenty process words stay inside the ledger, tooltips, settings, and named contract allowances', async () => {
  assert.equal(FIXTURE_FIREWALL_WORDS.length, 20)
  const configured = process.env.AMPHOREUS_REAL_SUITE
  const words = configured === undefined ? FIXTURE_FIREWALL_WORDS : await realFirewallWords(configured)
  assert.deepEqual(words, FIXTURE_FIREWALL_WORDS, `firewallWords=${JSON.stringify(words)}`)

  const violations: string[] = []
  const appPath = new URL('../workbench/app.js', import.meta.url)
  violations.push(...findViolations('workbench/app.js', maskWorkbench(readFileSync(appPath, 'utf8')), words))

  const clientDirectory = new URL('../src/client/', import.meta.url)
  for (const entry of readdirSync(clientDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:ts|tsx)$/u.test(entry.name)) continue
    const source = readFileSync(new URL(entry.name, clientDirectory), 'utf8')
    violations.push(...findViolations(`src/client/${basename(entry.name)}`, maskClient(entry.name, source), words))
  }

  violations.sort((left, right) => left.localeCompare(right, 'en'))
  assert.equal(violations.length, 0, violations.join('\n'))
})
