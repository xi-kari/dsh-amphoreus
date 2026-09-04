import assert from 'node:assert/strict'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { parseSuite, type SuiteCardFiles, type SuiteTextFile } from '../src/host/suite/parse.ts'
import type { ResolvedRoot } from '../src/host/suite/types.ts'

const configured = process.env.AMPHOREUS_REAL_SUITE

test('AMPHOREUS_REAL_SUITE integration contract', { skip: configured === undefined ? 'AMPHOREUS_REAL_SUITE is not set' : false }, async () => {
  assert.notEqual(configured, undefined)
  const expanded = expandTilde(configured!)
  const canonical = await realpath(resolve(expanded))
  const root: ResolvedRoot = { index: 0, configured: configured!, expanded, canonical }
  const router = await textFile(join(canonical, 'amphoreus', 'SKILL.md'))
  const common = await textFile(join(canonical, 'amphoreus', 'references', 'common.md'))
  const relations = await optionalTextFile(join(canonical, 'amphoreus', 'references', 'relations.md'))
  const cards: SuiteCardFiles[] = []
  for (const entry of await readdir(canonical, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^amphoreus-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)) continue
    const dir = join(canonical, entry.name)
    const skill = await optionalTextFile(join(dir, 'SKILL.md'))
    const persona = await optionalTextFile(join(dir, 'persona.md'))
    cards.push({ dir: entry.name, ...(skill === undefined ? {} : { skill }), ...(persona === undefined ? {} : { persona }) })
  }
  cards.sort((a, b) => a.dir.localeCompare(b.dir, 'en'))

  const snapshot = parseSuite({
    root,
    roots: [root],
    router,
    common,
    ...(relations === undefined ? {} : { relations }),
    cards,
  }, { parsedAt: 1, generation: 1 })

  assert.equal(snapshot.level, 'L0', diagnosticSummary(snapshot.diagnostics))
  assert.equal(snapshot.cards.size, 13, diagnosticSummary(snapshot.diagnostics))
  assert.equal(snapshot.invalidCards.length, 0, diagnosticSummary(snapshot.diagnostics))
  assert.ok(snapshot.pipelines.length >= 2)

  const fire = snapshot.pipelines.find(pipeline => pipeline.name === '逐火线')
  const watch = snapshot.pipelines.find(pipeline => pipeline.name === '守夜线')
  assert.equal(fire?.stations.length, 10, diagnosticSummary(snapshot.diagnostics))
  assert.ok(fire?.stations.every(station => station.to !== undefined), diagnosticSummary(snapshot.diagnostics))
  assert.equal(watch?.stations[2]?.to?.face, '长夜月', diagnosticSummary(snapshot.diagnostics))
  assert.equal(snapshot.cards.get('amphoreus-anaxa')?.displayName, '那刻夏')

  const handoffs = [...snapshot.cards.values()].flatMap(card => card.handoffs)
  assert.ok(handoffs.filter(edge => edge.kind === 'handoff').length >= 20, `handoffs=${handoffs.length}; ${diagnosticSummary(snapshot.diagnostics)}`)
  assert.ok(handoffs.some(edge => edge.kind === 'notify'))
})

function expandTilde(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

async function textFile(path: string): Promise<SuiteTextFile> {
  return { path, content: await readFile(path, 'utf8') }
}

async function optionalTextFile(path: string): Promise<SuiteTextFile | undefined> {
  try {
    return await textFile(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
    throw error
  }
}

function diagnosticSummary(diagnostics: readonly { code: string; detail: string }[]): string {
  return diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.detail}`).join('\n')
}
