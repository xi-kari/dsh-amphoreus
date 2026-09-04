import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import type { BindingRecord } from '../src/host/store.ts'
import type { AmphoreusState } from '../src/shared/api.ts'
import { heroVisualOf } from '../src/shared/heroes.ts'
import { bindingIndex, currentSeatOf } from '../src/client/seat-model.ts'

const bridgeSource = readFileSync(new URL('../src/client/workbench.tsx', import.meta.url), 'utf8')
const clientSource = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')

const helperStart = bridgeSource.indexOf('export function currentSessionIdentity')
const helperEnd = bridgeSource.indexOf('\ninterface BridgeMessage', helperStart)
assert.ok(helperStart >= 0 && helperEnd > helperStart)
const helperSource = bridgeSource.slice(helperStart, helperEnd).replaceAll('export function', 'function')
const compiledHelpers = transpileModule(
  `${helperSource}\nglobalThis.__helpers = { currentSessionIdentity, buildCurrentSessionMessage }`,
  { compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2024 } },
).outputText
const context = {
  bindingIndex,
  currentSeatOf,
  heroVisualOf,
  __helpers: undefined as undefined | {
    currentSessionIdentity(list: SessionListSnapshot, state: AmphoreusState | undefined): CurrentSessionIdentity
    buildCurrentSessionMessage(list: SessionListSnapshot, state: AmphoreusState | undefined): unknown
  },
}
vm.runInNewContext(compiledHelpers, context)
const { buildCurrentSessionMessage, currentSessionIdentity } = context.__helpers!
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

interface SessionListSnapshot {
  readonly current: string | undefined
  readonly byId: Record<string, { readonly title?: string; readonly displayTitle: string; readonly cwd?: string } | undefined>
}

interface CurrentSessionIdentity {
  readonly id: string | undefined
  readonly seatKey: string | null
}

const list = (current: string | undefined): SessionListSnapshot => ({
  current,
  byId: {
    'session-current': {
      title: 'Durable title',
      displayTitle: 'Display title',
      cwd: 'D:/workspace',
    },
  },
})

const binding = (skillName: string): BindingRecord => ({
  sessionId: 'session-current',
  skillName,
  boundAt: 1,
  source: 'manual',
  injection: { state: 'done', at: 1 },
})

const state = (bindings: readonly BindingRecord[]): AmphoreusState => ({ bindings }) as unknown as AmphoreusState

test('current-session message carries cwd and known, unknown, or absent binding identity', () => {
  assert.deepEqual(plain(buildCurrentSessionMessage(list(undefined), state([]))), {
    source: 'dsh-amphoreus',
    type: 'amphoreus:current-session',
    session: null,
    seat: null,
  })
  assert.deepEqual(plain(buildCurrentSessionMessage(list('session-current'), state([]))), {
    source: 'dsh-amphoreus',
    type: 'amphoreus:current-session',
    session: { id: 'session-current', title: 'Durable title', cwd: 'D:/workspace' },
    seat: null,
  })
  assert.deepEqual(plain(buildCurrentSessionMessage(list('session-current'), state([binding('amphoreus-anaxa')]))), {
    source: 'dsh-amphoreus',
    type: 'amphoreus:current-session',
    session: { id: 'session-current', title: 'Durable title', cwd: 'D:/workspace' },
    seat: { skillName: 'amphoreus-anaxa', heroId: 'anaxa' },
  })
  assert.deepEqual(plain(buildCurrentSessionMessage(list('session-current'), state([binding('amphoreus-future-card')]))), {
    source: 'dsh-amphoreus',
    type: 'amphoreus:current-session',
    session: { id: 'session-current', title: 'Durable title', cwd: 'D:/workspace' },
    seat: { skillName: 'amphoreus-future-card', heroId: null },
  })
})

test('late binding changes seatKey without changing the current id', () => {
  const before = currentSessionIdentity(list('session-current'), state([]))
  const after = currentSessionIdentity(list('session-current'), state([binding('amphoreus-anaxa')]))
  assert.equal(before.id, after.id)
  assert.equal(before.seatKey, null)
  assert.notEqual(after.seatKey, before.seatKey)
  assert.match(after.seatKey ?? '', /^amphoreus-anaxa\u0000anaxa$/u)
})

test('shared hook retains full replay, strict source checks, dual current subscription, and portal routes', () => {
  assert.ok((bridgeSource.match(/useWorkbenchBridge/g) ?? []).length >= 2)
  assert.match(bridgeSource, /event\.origin !== window\.location\.origin/)
  assert.match(bridgeSource, /event\.source !== frameRef\.current\?\.contentWindow/)
  assert.match(bridgeSource, /data\?\.source !== 'dsh-amphoreus'/)

  const ready = bridgeSource.slice(
    bridgeSource.indexOf("case 'amphoreus:map-ready'"),
    bridgeSource.indexOf("case 'amphoreus:map-opened'"),
  )
  for (const call of [
    'pushWorkspaces()',
    'pushCurrent()',
    'pushConfig()',
    'pushMessagesRef.current()',
    'pushLiveRef.current()',
    'pushThemeTokensRef.current()',
    'pushMagazineRef.current()',
  ]) assert.ok(ready.includes(call), `map-ready missing ${call}`)

  assert.match(bridgeSource, /case 'amphoreus:open-seat'/)
  assert.match(bridgeSource, /await handler\?\.\(null\)/)
  assert.match(bridgeSource, /await handler\?\.\(data\.heroId\)/)
  assert.match(bridgeSource, /case 'amphoreus:open-portal'/)
  assert.match(bridgeSource, /case 'amphoreus:close':[\s\S]*handlersRef\.current\.onClose\?\.\(\)/)
  assert.match(bridgeSource, /const disposeSessions = sessions\.list\.subscribe\(push\)/)
  assert.match(bridgeSource, /const disposeModel = model\.subscribe\(push\)/)
  assert.match(bridgeSource, /identity\.id === last\.id && identity\.seatKey === last\.seatKey/)
  assert.match(bridgeSource, /disposeSessions\(\)[\s\S]*disposeModel\(\)/)
})

test('different-target open remembers chat before navigation and Workbench keeps two direct chat openings', () => {
  const openCase = bridgeSource.slice(
    bridgeSource.indexOf("case 'amphoreus:open-session'"),
    bridgeSource.indexOf("case 'amphoreus:activate-session'"),
  )
  const remember = openCase.indexOf("rememberTab(localStorage, 'chat')")
  const compare = openCase.indexOf('targetId === sessions.list.getSnapshot().current')
  const open = openCase.indexOf('sessions.open(targetId)')
  assert.ok(remember >= 0 && remember < compare && compare < open)
  assert.equal((bridgeSource.match(/openView\('chat'/g) ?? []).length, 2)
  assert.match(openCase, /handlersRef\.current\.onOpened\?\.\(\)/)
})

test('TC4 no-open create flow and the temporary optional portal seam stay explicit', () => {
  assert.match(clientSource, /startSeatSession: skillName => startSeatSession\(seatDeps, skillName, \{ open: false \}\)/)
  assert.match(clientSource, /\bmodel,\s*theme: themeBridge/)
  assert.doesNotMatch(clientSource, /openPortal:\s*\(\)\s*=>\s*\{\s*\}/)
  assert.match(bridgeSource, /readonly openPortal\?: \(\) => void/)
  assert.match(bridgeSource, /openPortal === undefined \? \{\} : \{ onOpenPortal: openPortal \}/)
  const createCase = bridgeSource.slice(
    bridgeSource.indexOf("case 'amphoreus:create-session'"),
    bridgeSource.indexOf("case 'amphoreus:send-message'"),
  )
  assert.doesNotMatch(createCase, /sessions\.open\(/)
})
