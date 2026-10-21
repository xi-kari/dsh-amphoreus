import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { renderSkillContent, type SkillProviderObservation } from '@deepseek-ai/dsh-skill'
import { readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { test } from 'node:test'
import { createSkillProvider } from '../src/host/bridge.ts'
import { buildMatchers, extractObservations } from '../src/host/observer.ts'
import { registerSeatPrompt, seatPromptAssembly } from '../src/host/seat-prompt.ts'
import type { AmphoreusStores, BindingRecord } from '../src/host/store.ts'
import { parseSuite } from '../src/host/suite/parse.ts'
import { SuiteReader } from '../src/host/suite/reader.ts'
import type { ResolvedRoot, SuiteSnapshot } from '../src/host/suite/types.ts'

const configured = process.env.AMPHOREUS_REAL_SUITE
const realSuiteOptions = { skip: configured === undefined ? 'AMPHOREUS_REAL_SUITE is not set' : false }

test('AMPHOREUS_REAL_SUITE integration contract', realSuiteOptions, async () => {
  const { snapshot } = await loadRealSuite()

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

test('real suite provider preserves every external card through the host skill renderer', realSuiteOptions, async () => {
  const { reader, snapshot } = await loadRealSuite()
  const reparses: string[] = []
  const provider = createSkillProvider({
    current: () => snapshot,
    readFresh: (path, signal) => reader.readSkillPath(path, signal),
    scheduleReparse: reason => { reparses.push(reason) },
  }, { providerName: 'dsh-amphoreus', providerSource: 'amphoreus', providerRank: 300, forceUserOnly: false })
  const observation = await provider.list({}) as SkillProviderObservation
  assert.equal(observation.complete, true)
  assert.equal(observation.candidates.length, 14)
  for (const candidate of observation.candidates) {
    const definition = await provider.get(candidate, {})
    assert.ok(definition, candidate.name)
    assert.ok(definition.path, candidate.name)
    const raw = await readFile(definition.path, 'utf8')
    const body = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '').trim()
    assert.equal(definition.content, body, candidate.name)
    assert.deepEqual(definition.resourceBase, { kind: 'directory', path: dirname(definition.path) })
    const rendered = renderSkillContent(definition)
    assert.ok(rendered.includes(`<skill_instructions>\n${body}\n</skill_instructions>`), candidate.name)
    const parsed = snapshot.cards.get(candidate.name)
    if (parsed !== undefined) assert.equal(parsed.body, body, candidate.name)
  }
  assert.deepEqual(reparses, [])
})

test('v1.8 work-method references remain external and readable through each seat prompt', realSuiteOptions, async () => {
  const { root, files, snapshot } = await loadRealSuite()
  assert.ok(files.common)
  assert.ok(/^## 工作方法内核$/m.test(files.common.content), 'external common.md must expose the v1.8 work-method section')
  assert.ok(snapshot.contracts?.sections.includes('工作方法内核'))
  let active: BindingRecord | undefined
  let current: SuiteSnapshot = snapshot
  type Assembly = Parameters<typeof seatPromptAssembly>[0]
  let callback!: (assembly: Assembly, context: { agent: { session: { id: string } } }, next: () => Promise<Assembly>) => Promise<Assembly>
  const ctx = { on: (_name: string, handler: typeof callback) => { callback = handler; return () => {} } } as unknown as Context
  const stores = { main: { table: () => ({ get: () => active }) } } as unknown as AmphoreusStores
  const dispose = registerSeatPrompt(ctx, { stores, current: () => current })
  try {
    for (const card of snapshot.cards.values()) {
      active = { sessionId: 'external-suite-seat', skillName: card.name, boundAt: 1, source: 'seat-new', injection: { state: 'pending' } }
      const original: Assembly = {
        sections: [{ name: 'harness:identity', text: 'Host identity.' }],
        contexts: [], tools: [], variables: { cwd: process.cwd() },
      }
      const context = { agent: { session: { id: active.sessionId } } }
      const result = await callback(original, context, async () => original)
      const identity = result.sections[0]!.text
      const references = new Map([
        ['技能卡', card.path],
        ['persona.md', join(dirname(card.path), 'persona.md')],
        ['common.md', join(root.canonical, 'amphoreus/references/common.md')],
        ['relations.md', join(root.canonical, 'amphoreus/references/relations.md')],
      ])
      for (const [label, expected] of references) {
        const line = identity.split('\n').find(value => value.startsWith(`${label}：`))
        assert.ok(line, `${card.name}: ${label}`)
        const emitted = line.slice(label.length + 1).split('（')[0]!
        assert.ok(isAbsolute(emitted), emitted)
        assert.equal(await realpath(emitted), await realpath(expected))
        assert.deepEqual(await readFile(emitted), await readFile(expected))
      }
      assert.ok(!identity.includes(files.common.content))
      assert.ok(!identity.includes(card.body))
      assert.strictEqual(result.variables, original.variables)
      current = { ...snapshot, cards: new Map([...snapshot.cards].filter(([name]) => name !== card.name)) }
      assert.strictEqual(await callback(original, context, async () => original), original)
      current = snapshot
    }
  } finally {
    dispose()
  }
})

test('real suite absence and incomplete handoffs retain the external contract', realSuiteOptions, async () => {
  const { files, snapshot } = await loadRealSuite()
  assert.equal(snapshot.contracts?.absence.fromFile, true)
  assert.equal(snapshot.contracts?.handoff.fromFile, true)
  const matchers = buildMatchers(snapshot)
  const duty = 'integration-fixture-duty'
  const absence = snapshot.contracts!.absence.template.replace(/<[^>]+>/, duty)
  const missing = extractObservations(absence, matchers, snapshot.nameIndex)
  assert.equal(missing.length, 1)
  assert.equal(missing[0]?.kind, 'absence')
  assert.equal(missing[0]?.payload, duty)
  assert.equal(missing[0]?.targetSkillName, null)
  const unavailable = parseSuite({ ...files, cards: files.cards.filter(card => card.dir !== 'amphoreus-phainon') }, { parsedAt: 2, generation: 2 })
  assert.equal(unavailable.cards.has('amphoreus-phainon'), false)
  assert.equal([...unavailable.nameIndex.values()].some(target => target.skill === 'amphoreus-phainon'), false)
  assert.ok(unavailable.pipelines.some(pipeline => pipeline.stations.some(station => station.text === '白厄' && station.to === undefined)))
  for (const skillName of ['amphoreus-aglaea', 'amphoreus-terrae']) {
    const card = snapshot.cards.get(skillName)
    assert.ok(card)
    const source = files.cards.find(item => item.dir === skillName)?.skill?.content
    assert.ok(source)
    const missingMaterialRule = source.split('\n').find(line => /移交物缺材料/.test(line))
    assert.ok(missingMaterialRule, skillName)
    assert.ok(card.body.includes(missingMaterialRule), skillName)
    const edges = card.handoffs.filter(edge => edge.kind === 'handoff')
    assert.ok(edges.length >= 2, skillName)
    for (const edge of edges) {
      const payload = '<待补：integration-fixture-evidence>'
      const line = edge.raw.replace(/<[^>]+>/, payload)
      const observations = extractObservations(line, matchers, snapshot.nameIndex)
      assert.equal(observations.length, 1, line)
      assert.equal(observations[0]?.kind, 'handoff')
      assert.equal(observations[0]?.payload, payload)
      assert.equal(observations[0]?.targetSkillName, edge.to?.skill)
      assert.equal(observations[0]?.rawLine, line)
    }
  }
})

async function loadRealSuite() {
  assert.notEqual(configured, undefined)
  const expanded = expandTilde(configured!)
  const canonical = await realpath(resolve(expanded))
  const root: ResolvedRoot = { index: 0, configured: configured!, expanded, canonical }
  const reader = await SuiteReader.create(canonical)
  const files = await reader.loadSuiteFiles({
    root, roots: [root], commonPath: 'amphoreus/references/common.md', relationsPath: 'amphoreus/references/relations.md',
  })
  const snapshot = parseSuite(files, { parsedAt: 1, generation: 1 })
  return { root, reader, files, snapshot }
}

function expandTilde(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

function diagnosticSummary(diagnostics: readonly { code: string; detail: string }[]): string {
  return diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.detail}`).join('\n')
}
