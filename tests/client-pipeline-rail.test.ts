import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { DSW_ALIAS_TOKENS } from '../src/shared/tokens.ts'
import { en, zh } from '../src/client/locales.ts'

const rail = readFileSync(new URL('../src/client/pipeline-rail.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/client/pipeline-rail.module.css', import.meta.url), 'utf8')
const client = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')

const helperStart = rail.indexOf('export function matchesBinding')
const helperEnd = rail.indexOf('\nfunction errorMessage', helperStart)
assert.ok(helperStart >= 0 && helperEnd > helperStart)
const helper = rail.slice(helperStart, helperEnd).replaceAll('export function ', 'function ')
const compiled = transpileModule(
  `${helper}\nglobalThis.__rail = { matchesBinding, findPipelinePosition, stationIsDeployed, targetIsAvailable, acquirePipelineDispatch }`,
  { compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2024 } },
).outputText
const context = { globalThis: {} as Record<string, unknown> }
context.globalThis = context
vm.createContext(context)
vm.runInContext(compiled, context)
const helpers = context.globalThis.__rail as {
  matchesBinding(station: Record<string, unknown>, binding?: Record<string, unknown>): boolean
  findPipelinePosition(pipelines: readonly Record<string, unknown>[], binding?: Record<string, unknown>): { pipeline: number; station: number } | undefined
  stationIsDeployed(station: Record<string, unknown>, seats: readonly Record<string, unknown>[]): boolean
  targetIsAvailable(target: Record<string, unknown>, pipelines: readonly Record<string, unknown>[], seats: readonly Record<string, unknown>[]): boolean
  acquirePipelineDispatch(lock: { current: boolean }): boolean
}

const pipelines = [
  {
    name: 'line-a',
    source: 'common',
    stations: [
      { text: 'primary-face', skill: 'amphoreus-shared', face: 'primary' },
      { text: 'unresolved' },
      { text: 'other', skill: 'amphoreus-other' },
    ],
  },
  {
    name: 'line-b',
    source: 'common',
    stations: [
      { text: 'secondary-face', skill: 'amphoreus-shared', face: 'secondary' },
    ],
  },
] as const
const seats = [
  { skillName: 'amphoreus-shared', status: 'deployed' },
  { skillName: 'amphoreus-other', status: 'undeployed' },
] as const

test('position matching is face-aware, ordered, and compatible with bindings without a face', () => {
  const secondary = { skillName: 'amphoreus-shared', face: 'secondary' }
  assert.equal(helpers.matchesBinding(pipelines[0].stations[0], secondary), false)
  assert.equal(helpers.matchesBinding(pipelines[1].stations[0], secondary), true)
  const exact = helpers.findPipelinePosition(pipelines, secondary)
  assert.equal(exact?.pipeline, 1)
  assert.equal(exact?.station, 0)

  const legacy = { skillName: 'amphoreus-shared' }
  assert.equal(helpers.matchesBinding(pipelines[0].stations[0], legacy), true)
  assert.equal(helpers.matchesBinding(pipelines[1].stations[0], legacy), true)
  const first = helpers.findPipelinePosition(pipelines, legacy)
  assert.equal(first?.pipeline, 0)
  assert.equal(first?.station, 0)
  assert.equal(helpers.findPipelinePosition(pipelines, undefined), undefined)
})

test('unresolved and undeployed stations retain their indexes but cannot become dispatch targets', () => {
  assert.equal(helpers.stationIsDeployed(pipelines[0].stations[0], seats), true)
  assert.equal(helpers.stationIsDeployed(pipelines[0].stations[1], seats), false)
  assert.equal(helpers.stationIsDeployed(pipelines[0].stations[2], seats), false)

  const target = {
    skill: 'amphoreus-shared',
    face: 'secondary',
    name: 'secondary-face',
    pipeline: 'line-b',
    station: 0,
  }
  assert.equal(helpers.targetIsAvailable(target, pipelines, seats), true)
  assert.equal(helpers.targetIsAvailable({ ...target, station: 1 }, pipelines, seats), false)
  assert.equal(helpers.targetIsAvailable({ ...target, face: 'primary' }, pipelines, seats), false)
  assert.equal(helpers.targetIsAvailable({ ...target, name: 'stale' }, pipelines, seats), false)
  assert.equal(helpers.targetIsAvailable({ ...target, pipeline: 'missing' }, pipelines, seats), false)
})

test('the submit lock rejects a same-tick second dispatch', () => {
  const lock = { current: false }
  assert.equal(helpers.acquirePipelineDispatch(lock), true)
  assert.equal(helpers.acquirePipelineDispatch(lock), false)
  lock.current = false
  assert.equal(helpers.acquirePipelineDispatch(lock), true)
})

test('rail registration uses the strict session utility slot and shared dependency faces', () => {
  const start = client.indexOf("ctx.slots.inject('conversation.session.header.utilities'")
  const end = client.indexOf("ctx.slots.inject('sidebar.footer.action'", start)
  assert.ok(start >= 0 && end > start)
  const registration = client.slice(start, end)
  assert.match(registration, /name: 'conversation\.session\.header\.utilities'/u)
  assert.match(registration, /id: 'amphoreus-rail'/u)
  assert.match(registration, /order: 10/u)
  assert.match(registration, /locale: NS/u)
  assert.match(registration, /inject: \(sessionId: string\) => \(\{/u)
  assert.match(registration, /model,\s*seatDeps,\s*sessionId,/u)
  assert.match(registration, /ctx\.sessions\.list as unknown as/u)
  assert.match(registration, /\)\.getSnapshot\(\)\.byId\[id\]\?\.cwd/u)
  assert.match(registration, /\.byId\[id\]\?\.cwd/u)
  assert.equal(client.match(/const seatDeps: HandoffDeps = \{/gu)?.length, 1)
})

test('rail lifecycle gates availability and cleans both document listeners', () => {
  assert.match(rail, /state\?\.suite !== undefined[\s\S]*state\.effectiveConfig\.pipelinesEnabled[\s\S]*state\.suite\.pipelines\.length > 0/u)
  assert.match(rail, /const closePanel = useCallback\(\(\): void => \{[\s\S]*setOpen\(false\)[\s\S]*setTarget\(undefined\)[\s\S]*setError\(undefined\)/u)
  assert.match(rail, /if \(!available\) \{\s*closePanel\(\)/u)
  assert.match(rail, /document\.addEventListener\('pointerdown', onDown\)/u)
  assert.match(rail, /document\.addEventListener\('keydown', onKey\)/u)
  assert.match(rail, /document\.removeEventListener\('pointerdown', onDown\)/u)
  assert.match(rail, /document\.removeEventListener\('keydown', onKey\)/u)
  assert.match(rail, /event\.target instanceof Node/u)
  assert.match(rail, /event\.key === 'Escape'/u)
  assert.match(rail, /\}, \[available, closePanel, open\]\)/u)
  assert.doesNotMatch(rail, /Popover|document\.body\.appendChild/u)
})

test('runtime lines preserve station order, deployment gates, badge assets, and conditional faces', () => {
  assert.match(rail, /pipelines\.map\(\(pipeline, pipelineIndex\)/u)
  assert.match(rail, /pipeline\.stations\.map\(\(station, stationIndex\)/u)
  assert.match(rail, /disabled=\{!deployed \|\| busy\}/u)
  assert.match(rail, /if \(!deployed \|\| station\.skill === undefined\) return/u)
  assert.match(rail, /station: stationIndex/u)
  assert.match(rail, /position\.station \+ 1/u)
  assert.match(rail, /assetsConfigured=\{state\.effectiveConfig\.assetsConfigured\}/u)
  assert.equal(rail.match(/station\.face === undefined \? \{\} : \{ face: station\.face \}/gu)?.length, 2)
  assert.doesNotMatch(rail, /face=\{station\.face\}/u)
  assert.doesNotMatch(rail, /逐火线|守夜线|那刻夏|赛飞儿/u)
})

test('dispatch revalidates the latest target and forwards rail, open, cwd, and face exactly once', () => {
  assert.match(rail, /const submitLock = useRef\(false\)/u)
  assert.match(rail, /!acquirePipelineDispatch\(submitLock\)/u)
  assert.match(rail, /const latest = model\.getSnapshot\(\)\.state/u)
  assert.match(rail, /targetIsAvailable\(target, latest\.suite\.pipelines, latest\.seats\)/u)
  assert.match(rail, /await dispatchTask\(seatDeps, \{/u)
  assert.match(rail, /from: 'rail'/u)
  assert.match(rail, /open: true/u)
  assert.match(rail, /target\.face === undefined \? \{\} : \{ face: target\.face \}/u)
  assert.equal(rail.match(/cwdOf\(sessionId\)/gu)?.length, 1)
  assert.match(rail, /setText\(''\)[\s\S]*closePanel\(\)/u)
  const catchStart = rail.indexOf('} catch (dispatchError) {')
  const finallyStart = rail.indexOf('} finally {', catchStart)
  const failure = rail.slice(catchStart, finallyStart)
  assert.match(failure, /setError\(errorMessage\(dispatchError\)\)/u)
  assert.doesNotMatch(failure, /setText|setTarget|setOpen/u)
  assert.doesNotMatch(rail, /fetch\(|\.fork\(|\.prompt\(|session\.append/u)
})

test('rail dictionaries are complete and styles use only known alias color tokens', () => {
  const expected = {
    'rail.title': '站位',
    'rail.tip': '流水线站位；点击站位可派发到该席',
    'rail.dispatchTo': '派发给 {name}',
    'rail.placeholder': '写下要交给这一站的任务…',
    'rail.cancel': '取消',
    'rail.send': '派发',
  } as const
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(zh[key as keyof typeof zh], value)
    assert.equal(typeof en[key as keyof typeof en], 'string')
  }
  assert.deepEqual(Object.keys(en), Object.keys(zh))

  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/iu)
  assert.doesNotMatch(css, /\brgba?\(|\bhsla?\(/iu)
  assert.doesNotMatch(css, /\[data-theme=[^\]]+\]/u)
  assert.doesNotMatch(css, /--dsw-(?!alias-)/u)
  const aliases = [...css.matchAll(/var\((--dsw-alias-[a-z0-9-]+)\)/gu)].map(match => match[1])
  assert.ok(aliases.length >= 12)
  for (const alias of aliases) assert.equal(DSW_ALIAS_TOKENS.includes(alias as never), true, alias)
  assert.match(css, /box-shadow: 0 10px 30px var\(--dsw-alias-bg-mask-1\)/u)
})
