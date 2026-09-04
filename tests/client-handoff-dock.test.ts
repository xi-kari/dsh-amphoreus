import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { en, zh } from '../src/client/locales.ts'

const dock = readFileSync(new URL('../src/client/handoff-dock.tsx', import.meta.url), 'utf8')
const dockCss = readFileSync(new URL('../src/client/handoff-dock.module.css', import.meta.url), 'utf8')
const badge = readFileSync(new URL('../src/client/seat-badge.tsx', import.meta.url), 'utf8')
const badgeCss = readFileSync(new URL('../src/client/seat-badge.module.css', import.meta.url), 'utf8')
const client = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')

const helperStart = dock.indexOf('export function latestOpenHandoff')
const helperEnd = dock.indexOf('\nfunction errorMessage', helperStart)
assert.ok(helperStart >= 0 && helperEnd > helperStart)
const helper = dock
  .slice(helperStart, helperEnd)
  .replace('export function latestOpenHandoff', 'function latestOpenHandoff')
  .replace('export function acquireHandoffAction', 'function acquireHandoffAction')
const compiled = transpileModule(
  `${helper}\nglobalThis.__latestOpenHandoff = latestOpenHandoff; globalThis.__acquireHandoffAction = acquireHandoffAction`,
  { compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2024 } },
).outputText
const context = { globalThis: {} as Record<string, unknown> }
context.globalThis = context
vm.createContext(context)
vm.runInContext(compiled, context)
const latestOpenHandoff = context.globalThis.__latestOpenHandoff as (
  observations: Array<Record<string, unknown>>,
  sessionId: string,
) => Record<string, unknown> | undefined
const acquireHandoffAction = context.globalThis.__acquireHandoffAction as (
  lock: { current: boolean },
) => boolean

const observation = (
  sessionId: string,
  seq: number,
  kind = 'handoff',
  status = 'open',
): Record<string, unknown> => ({
  sessionId,
  seq,
  kind,
  status,
  rawLine: '',
  parsedAt: seq,
})

test('latestOpenHandoff selects only the newest open handoff for the current session', () => {
  const current = 'session-current'
  const selected = latestOpenHandoff([
    observation(current, 4),
    observation(current, 12, 'receipt', 'accepted'),
    observation('session-other', 30),
    observation(current, 20, 'handoff', 'accepted'),
    observation(current, 18),
    observation(current, 22, 'handoff', 'dismissed'),
  ], current)

  assert.equal(selected?.seq, 18)
  assert.equal(latestOpenHandoff([], current), undefined)
})

test('dock gates both write actions through one synchronous lock and performs no automatic action', () => {
  const lock = { current: false }
  assert.equal(acquireHandoffAction(lock), true)
  assert.equal(acquireHandoffAction(lock), false)
  lock.current = false
  assert.equal(acquireHandoffAction(lock), true)

  assert.doesNotMatch(dock, /useEffect|\.prompt\(|fetch\(|document\.body\.appendChild/u)
  assert.match(dock, /const actionLock = useRef\(false\)/u)
  assert.match(dock, /if \(!acquireHandoffAction\(actionLock\)\) return/u)
  assert.match(dock, /actionLock\.current = false/u)
  assert.equal(dock.match(/runAction\(\(\) => (?:accept|dismiss)Handoff/gu)?.length, 2)
  assert.match(dock, /seat\?\.status === 'deployed'/u)
  assert.match(dock, /\{deployed && \(/u)
  assert.match(dock, /skill=\{open\.targetSkillName \?\? null\}/u)
  assert.match(dock, /size=\{state\.effectiveConfig\.magazineMode === 'full' \? 48 : 28\}/u)
  assert.match(dock, /assetsConfigured=\{state\.effectiveConfig\.assetsConfigured\}/u)
  assert.match(dock, /open\.targetFace === undefined \? \{\} : \{ face: open\.targetFace \}/u)
  assert.doesNotMatch(dock, /face=\{open\.targetFace\}/u)
  assert.match(dock, /aria-busy=\{busy\}/u)
  assert.match(dock, /aria-expanded=\{showPayload\}/u)
  assert.match(dock, /<pre id=\{payloadId\}[^>]*>\{open\.payload \?\? ''\}<\/pre>/u)
  assert.equal(dock.includes('移交物'), false)
})

test('SeatBadge uses the shared asset route and resets image fallback by source identity', () => {
  assert.match(badge, /heroVisualOf\(skill\)/u)
  assert.match(badge, /stickerAssetUrl\(visual\.assets\.sticker\)/u)
  assert.match(badge, /fallbackHue\(skill\)/u)
  assert.match(badge, /brokenSrc !== stickerSrc/u)
  assert.match(badge, /setBrokenSrc\(stickerSrc\)/u)
  assert.match(badge, /readonly assetsConfigured: boolean/u)
  assert.match(badge, /faceLabel === null \? null/u)
  assert.doesNotMatch(badge, /\/amphoreus\/assets\/|document\.body\.appendChild/u)
})

test('handoff dictionaries are complete and keep the process word in the tooltip key only', () => {
  const expected = {
    'handoff.ask': '移交给 {name}？',
    'handoff.absent': '{name} 未部署，无法移交',
    'handoff.view': '查看内容',
    'handoff.payloadTip': '移交物',
    'handoff.accept': '移交',
    'handoff.dismiss': '忽略',
    'handoff.connecting': '黄金裔接通中…',
  } as const
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(zh[key as keyof typeof zh], value)
    assert.equal(typeof en[key as keyof typeof en], 'string')
  }
  assert.deepEqual(Object.keys(en), Object.keys(zh))
  assert.equal(Object.values(zh).filter(value => value === '移交物').length, 1)
})

test('dock registration follows the Workbench view and reuses the singleton handoff deps', () => {
  const view = client.indexOf("ctx.slots.inject('conversation.view'")
  const handoff = client.indexOf("ctx.slots.inject('conversation.input.dock'")
  assert.ok(view >= 0 && handoff > view)
  const registration = client.slice(handoff)
  assert.match(registration, /id: 'amphoreus-handoff'/u)
  assert.match(registration, /order: 30/u)
  assert.match(registration, /inject: \(\) => \(\{ model, seatDeps \}\)/u)
  assert.equal(client.match(/const seatDeps: HandoffDeps = \{/gu)?.length, 1)
  assert.equal(client.match(/name: 'conversation\.input\.dock'/gu)?.length, 1)
})

test('new component styles use alias colors without hardcoded color or dark-theme branches', () => {
  for (const [name, source] of [['dock', dockCss], ['badge', badgeCss]] as const) {
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b/iu, name)
    assert.doesNotMatch(source, /\brgba?\(|\bhsl[a]?\(/iu, name)
    assert.doesNotMatch(source, /\[data-theme=[^\]]+\]/u, name)
    assert.doesNotMatch(source, /--dsw-(?!alias-)/u, name)
  }
  assert.match(dockCss, /\.dock\[data-magazine="full"\]/u)
  assert.match(dockCss, /var\(--dsw-alias-button-primary-fill\)/u)
  assert.match(badgeCss, /var\(--dsw-alias-label-primary-inverted\)/u)
})
