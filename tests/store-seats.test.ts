import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planSeatReconciliation } from '../src/host/seats.ts'
import {
  amphoreusCanvasDomain,
  amphoreusDomain,
  BindingSchema,
  CanvasSchema,
  GlobalSchema,
  INITIAL_GLOBAL,
  SeatSchema,
  updateAmphoreusGlobal,
  type AmphoreusDomain,
  type SeatRecord,
} from '../src/host/store.ts'
import { parseSuite, type SuiteTextFile } from '../src/host/suite/parse.ts'
import type { SuiteSnapshot } from '../src/host/suite/types.ts'

test('storage domains expose the required single and per-record table layouts', () => {
  assert.equal(amphoreusDomain.name, 'amphoreus')
  assert.equal(amphoreusDomain.layout, 'single')
  assert.deepEqual(Object.keys(amphoreusDomain.tables), ['seats', 'bindings', 'memory', 'observations', 'suite_events'])
  assert.equal(amphoreusCanvasDomain.name, 'amphoreus_canvas')
  assert.equal(amphoreusCanvasDomain.layout, 'per-record')
  assert.deepEqual(Object.keys(amphoreusCanvasDomain.tables), ['canvas'])

  assert.equal(SeatSchema.safeParse({}).success, false)
  assert.equal(BindingSchema.safeParse({
    sessionId: 'session-fixture', skillName: 'amphoreus-testcard-a', boundAt: 1,
    source: 'seat-new', injection: { state: 'pending' },
  }).success, true)
  assert.equal(CanvasSchema.safeParse({ positions: {}, collapsed: [], branchAnchors: {}, updatedAt: 1 }).success, true)
  assert.deepEqual(INITIAL_GLOBAL.workbench, { hiddenSessionIds: [] })
  assert.equal(INITIAL_GLOBAL.prefs.quickPhrasesInitialized, false)
  const legacyGlobal = GlobalSchema.parse({
    ...INITIAL_GLOBAL,
    prefs: { lastSeat: null, wallpaperCursor: 0, quickPhrases: [] },
  })
  assert.equal(legacyGlobal.prefs.quickPhrasesInitialized, false)
})

test('global updates serialize read-modify-write across independent fields', async () => {
  let current = structuredClone(INITIAL_GLOBAL)
  const domain = {
    global: {
      get: () => current,
      set: async (next: typeof current) => {
        await new Promise(resolve => setTimeout(resolve, 5))
        current = next
      },
    },
  } as unknown as AmphoreusDomain

  await Promise.all([
    updateAmphoreusGlobal(domain, global => ({ ...global, workbench: { hiddenSessionIds: ['session-a'] } })),
    updateAmphoreusGlobal(domain, global => ({ ...global, prefs: { ...global.prefs, lastSeat: 'aglaea' } })),
  ])

  assert.deepEqual(current.workbench.hiddenSessionIds, ['session-a'])
  assert.equal(current.prefs.lastSeat, 'aglaea')
})

test('seat reconciliation creates every fictional card once with deterministic unknown-card order', () => {
  const snapshot = suite(['amphoreus-testcard-b', 'amphoreus-testcard-a'])
  const plan = planSeatReconciliation(snapshot, [], INITIAL_GLOBAL, 100)
  assert.deepEqual(plan.puts.map(put => [put.key, put.change, put.value.order]), [
    ['amphoreus-testcard-a', 'added', 13],
    ['amphoreus-testcard-b', 'added', 14],
  ])
  assert.equal(plan.global.seeded, true)
  assert.equal(plan.global.suite.status, 'ok')
  assert.equal(plan.events.filter(event => event.kind === 'seat-added').length, 2)

  const entries = plan.puts.map(put => [put.key, put.value] as const)
  const repeat = planSeatReconciliation(snapshot, entries, plan.global, 100)
  assert.equal(repeat.puts.length, 0)
  assert.equal(repeat.globalChanged, false)
})

test('seat reconciliation preserves user overrides and undeploys disappeared cards without deleting records', () => {
  const original = planSeatReconciliation(suite(['amphoreus-testcard-a', 'amphoreus-testcard-b']), [], INITIAL_GLOBAL, 100)
  const existing = original.puts.map(put => {
    const value = put.key === 'amphoreus-testcard-a'
      ? { ...put.value, userOrder: 90, userDisplayName: '自定义席名', hidden: true }
      : put.value
    return [put.key, value] as const
  })
  const next = planSeatReconciliation(suite(['amphoreus-testcard-a']), existing, original.global, 200)
  const kept = next.puts.find(put => put.key === 'amphoreus-testcard-a')?.value
  const missing = next.puts.find(put => put.key === 'amphoreus-testcard-b')?.value
  assert.equal(kept?.userOrder, 90)
  assert.equal(kept?.userDisplayName, '自定义席名')
  assert.equal(kept?.hidden, true)
  assert.equal(missing?.status, 'undeployed')
  assert.ok(next.events.some(event => event.kind === 'seat-removed'))
})

test('L3 never invents seats and marks an existing deployed seat undeployed', () => {
  const missing = parseSuite({ cards: [] }, { parsedAt: 300, generation: 3 })
  const empty = planSeatReconciliation(missing, [], INITIAL_GLOBAL, 300)
  assert.equal(empty.puts.length, 0)
  assert.equal(empty.global.seeded, false)
  assert.equal(empty.global.suite.status, 'missing')

  const old = seat('amphoreus-testcard-old', '旧星', 1)
  const retained = planSeatReconciliation(missing, [['amphoreus-testcard-old', old]], INITIAL_GLOBAL, 300)
  assert.equal(retained.puts[0]?.value.status, 'undeployed')
  assert.equal(retained.puts[0]?.change, 'undeployed')
})

test('explicit rename hints link old and new records but never rewrite their keys', () => {
  const old = seat('amphoreus-testcard-old', '旧星', 1)
  const snapshot = suite(['amphoreus-testcard-new'])
  const plan = planSeatReconciliation(snapshot, [['amphoreus-testcard-old', old]], INITIAL_GLOBAL, 400, [
    { from: 'amphoreus-testcard-old', to: 'amphoreus-testcard-new', similarity: 0.92 },
  ])
  const from = plan.puts.find(put => put.key === 'amphoreus-testcard-old')?.value
  const to = plan.puts.find(put => put.key === 'amphoreus-testcard-new')?.value
  assert.equal(from?.status, 'undeployed')
  assert.equal(from?.renamedTo, 'amphoreus-testcard-new')
  assert.equal(to?.renamedFrom, 'amphoreus-testcard-old')
  assert.ok(plan.events.some(event => event.kind === 'seat-renamed' && event.detail.includes('0.920')))
})

function suite(names: readonly string[]): SuiteSnapshot {
  const root = { index: 0, configured: 'X:/fixture', expanded: 'X:/fixture', canonical: 'X:/fixture' }
  const cards = names.map((name, index) => ({
    dir: name,
    skill: text(`${name}/SKILL.md`, `---\nname: ${name}\ndescription: fixture ${name}／虚构星${index}；\ndisable-model-invocation: true\n---\n## 身份与职能\n- 编号${index === 0 ? '一' : '二'}\n## 输出模板\n- \`虚构星${index}卡｜读取：common.md｜档位：标准／静音\`\n## 协作与移交\n`),
  }))
  const dispatchRows = names.map((name, index) => `| 职责${index} | 虚构星${index} \`${name}\` |`).join('\n')
  return parseSuite({
    root,
    roots: [root],
    router: text('amphoreus/SKILL.md', `---\nname: amphoreus\ndescription: fixture\ndisable-model-invocation: true\n---\n## 必读分层\n- \`角色未部署｜原因：module_unavailable｜未完成职责：<职责>\`\n## 分派表\n| 需求 | 角色与 skill |\n|---|---|\n${dispatchRows}\n## 流水线与会诊\n`),
    common: text('amphoreus/references/common.md', '# fixture\n## 深度门\n| 深度 | 条件 | 形态 |\n|---|---|---|\n| L0 | 简单 | 单卡 |\n- `角色未部署｜原因：module_unavailable｜未完成职责：<职责>`\n## 风格税\n| 档位 | 范围 | 用途 |\n|---|---|---|\n| 标准 | 中 | 默认 |\n## 移交与流水线\n- `此事移交◯◯：<内容>`\n## 汇报与回执\n- `◯◯卡｜读取：<内容>｜档位：标准／静音`\n'),
    cards,
  }, { parsedAt: 100, generation: 1 })
}

function text(path: string, content: string): SuiteTextFile {
  return { path, content }
}

function seat(skillName: string, displayName: string, at: number): SeatRecord {
  return {
    skillName,
    heroId: null,
    displayName,
    aliases: [displayName],
    duties: [],
    status: 'deployed',
    order: 13,
    firstSeenAt: at,
    lastSeenAt: at,
  }
}

test('seat preset: schema accepts the three optional tiers, rejects malformed ones, and stays optional for legacy records', () => {
  const base = seat('amphoreus-testcard-a', '甲', 1)
  assert.equal(SeatSchema.safeParse(base).success, true)
  assert.equal(SeatSchema.safeParse({ ...base, preset: {} }).success, true)
  assert.equal(SeatSchema.safeParse({ ...base, preset: { agentPreset: 'standard' } }).success, true)
  assert.equal(SeatSchema.safeParse({ ...base, preset: { model: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' } } }).success, true)
  assert.equal(SeatSchema.safeParse({ ...base, preset: { permission: 'read-only' } }).success, true)
  assert.equal(SeatSchema.safeParse({ ...base, preset: { agentPreset: 'Bad Preset' } }).success, false)
  assert.equal(SeatSchema.safeParse({ ...base, preset: { agentPreset: '-leading' } }).success, false)
  assert.equal(SeatSchema.safeParse({ ...base, preset: { model: { provider: 'deepseek' } } }).success, false)
  assert.equal(SeatSchema.safeParse({ ...base, preset: { permission: 7 } }).success, false)
  assert.equal(SeatSchema.safeParse({ ...base, preset: null }).success, false)
})

test('seat preset: reconciliation preserves the preset like the other user-owned fields', () => {
  const original = planSeatReconciliation(suite(['amphoreus-testcard-a', 'amphoreus-testcard-b']), [], INITIAL_GLOBAL, 100)
  const preset = { agentPreset: 'standard', model: { provider: 'deepseek', model: 'deepseek-chat' }, permission: 'workspace-write' }
  const existing = original.puts.map(put => [put.key, put.key === 'amphoreus-testcard-a' ? { ...put.value, preset } : put.value] as const)
  const unchanged = planSeatReconciliation(suite(['amphoreus-testcard-a', 'amphoreus-testcard-b']), existing, original.global, 100)
  assert.equal(unchanged.puts.length, 0, 'a preserved preset is not a change')
  const next = planSeatReconciliation(suite(['amphoreus-testcard-a']), existing, original.global, 200)
  assert.deepEqual(next.puts.find(put => put.key === 'amphoreus-testcard-a')?.value.preset, preset)
  assert.equal(Object.hasOwn(next.puts.find(put => put.key === 'amphoreus-testcard-b')!.value, 'preset'), false)
})
