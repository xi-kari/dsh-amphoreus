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
const portalSource = readFileSync(new URL('../src/client/portal.tsx', import.meta.url), 'utf8')

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
    'pushState()',
    'pushCurrent()',
    'pushConfig()',
    'pushMessagesRef.current()',
    'pushLiveRef.current()',
    'pushThemeTokensRef.current()',
    'pushMagazineRef.current()',
    'flushEnterSeat()',
  ]) assert.ok(ready.includes(call), `map-ready missing ${call}`)

  assert.match(bridgeSource, /case 'amphoreus:open-seat'/)
  assert.match(bridgeSource, /const handled = await handler\?\.\(null, extra\)/)
  assert.match(bridgeSource, /await handler\?\.\(data\.heroId, extra\)/)
  assert.match(bridgeSource, /dispatchText: data\.dispatchText/u)
  assert.match(bridgeSource, /handled === false[\s\S]*type: 'amphoreus:enter-seat'[\s\S]*workspaceId: 'all'/u)
  assert.match(bridgeSource, /case 'amphoreus:open-portal'/)
  assert.match(bridgeSource, /case 'amphoreus:close':[\s\S]*handlersRef\.current\.onClose\?\.\(\)/)
  assert.match(bridgeSource, /const disposeSessions = sessions\.list\.subscribe\(push\)/)
  assert.match(bridgeSource, /const disposeModel = model\.subscribe\(push\)/)
  assert.match(bridgeSource, /identity\.id === last\.id && identity\.seatKey === last\.seatKey/)
  assert.match(bridgeSource, /disposeSessions\(\)[\s\S]*disposeModel\(\)/)
  assert.match(bridgeSource, /snapshot\.phase !== 'ready'/)
  assert.match(bridgeSource, /model\.subscribe\(pushState\)/)
  assert.match(bridgeSource, /enterSeatQueue\.subscribe\(flushEnterSeat\)/)
  assert.match(bridgeSource, /readyRef\.current = true/)
  assert.match(bridgeSource, /readyRef\.current = false/)
  const requestCurrent = bridgeSource.slice(
    bridgeSource.indexOf("case 'amphoreus:request-current'"),
    bridgeSource.indexOf("case 'amphoreus:request-config'"),
  )
  assert.ok(requestCurrent.indexOf('pushState()') < requestCurrent.indexOf('pushCurrent()'))
})

test('different-target open remembers chat before navigation and Workbench includes the seat direct-chat request', () => {
  const openCase = bridgeSource.slice(
    bridgeSource.indexOf("case 'amphoreus:open-session'"),
    bridgeSource.indexOf("case 'amphoreus:activate-session'"),
  )
  const remember = openCase.indexOf("rememberTab(localStorage, 'chat')")
  const compare = openCase.indexOf('targetId === sessions.list.getSnapshot().current')
  const open = openCase.indexOf('sessions.open(targetId)')
  assert.ok(remember >= 0 && remember < compare && compare < open)
  assert.equal((bridgeSource.match(/openView\('chat'/g) ?? []).length, 4)
  assert.match(openCase, /handlersRef\.current\.onOpened\?\.\(\)/)
})

test('TE9 insert-input uses conversation owner props, appends the draft, and opens chat without submitting', () => {
  const insertCase = bridgeSource.slice(
    bridgeSource.indexOf("case 'amphoreus:insert-input'"),
    bridgeSource.indexOf("case 'amphoreus:dispatch'"),
  )
  assert.match(insertCase, /typeof data\.text !== 'string' \|\| data\.text === ''/u)
  assert.match(insertCase, /insertInputRef\.current === undefined/u)
  assert.match(insertCase, /insertInputRef\.current\(data\.text\)/u)
  assert.doesNotMatch(insertCase, /\.prompt\(|submit\(/u)

  const view = bridgeSource.slice(bridgeSource.indexOf('export function WorkbenchView'))
  assert.match(view, /useInput,\s*inputActions,/u)
  assert.match(view, /const draft = useInput\(state => state\.draft\)/u)
  assert.match(view, /inputActions\.setDraft\(draft\.trim\(\) === '' \? text : \[draft, text\]\.join\('\\n'\)\)/u)
  assert.match(view, /rememberTab\(localStorage, 'chat'\)/u)
  assert.match(view, /openView\('chat', 'amphoreus:insert-input'\)/u)
  assert.match(view, /completeViewRequest\(\)/u)
  assert.match(view, /insertInput,/u)
  assert.doesNotMatch(bridgeSource, /activateChat|switchToChat/u)
  assert.equal(clientSource.match(/'uiConversation'/gu)?.length, 1)
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

test('TE3 bridge validates dispatch, routes handoff RPC, and shares seatDeps with both frames', () => {
  const dispatchCase = bridgeSource.slice(
    bridgeSource.indexOf("case 'amphoreus:dispatch'"),
    bridgeSource.indexOf("case 'amphoreus:accept-handoff'"),
  )
  assert.match(dispatchCase, /data\.from !== 'panel'/)
  assert.match(dispatchCase, /data\.from !== 'rail'/)
  assert.match(dispatchCase, /data\.from !== 'pipeline'/)
  assert.match(dispatchCase, /safeOptionalInteger\(data\.station\)/)
  assert.match(dispatchCase, /dispatchTask\(seatDeps/)
  assert.match(dispatchCase, /open: false/)
  assert.match(dispatchCase, /type: 'amphoreus:dispatched'/)

  const handoffCase = bridgeSource.slice(
    bridgeSource.indexOf("case 'amphoreus:accept-handoff'"),
    bridgeSource.indexOf("case 'amphoreus:create-session'"),
  )
  assert.match(handoffCase, /await model\.refresh\(\)/)
  assert.match(handoffCase, /const snapshot = model\.getSnapshot\(\)/)
  assert.match(handoffCase, /snapshot\.state\.observations\.find/)
  assert.match(handoffCase, /candidate\.kind === 'handoff'/)
  assert.match(handoffCase, /candidate\.status === 'open'/)
  assert.match(handoffCase, /移交记录不存在/)
  assert.match(handoffCase, /snapshot\.state\.seats\.some/)
  assert.match(handoffCase, /candidate\.status === 'deployed'/)
  assert.match(handoffCase, /acceptHandoff\(seatDeps, observation, \{ open: false \}\)/)
  assert.match(handoffCase, /dismissHandoff\(seatDeps, observation\)/)
  assert.match(handoffCase, /type: 'amphoreus:handoff-accepted'/)
  assert.match(handoffCase, /type: 'amphoreus:handoff-dismissed'/)
  assert.doesNotMatch(handoffCase, /sessions\.open\(/)

  assert.match(clientSource, /const seatDeps: HandoffDeps/)
  assert.ok((clientSource.match(/\n\s+seatDeps,/g) ?? []).length >= 2)
  assert.match(portalSource, /readonly seatDeps: WorkbenchBridgeDeps\['seatDeps'\]/)
  assert.match(portalSource, /useWorkbenchBridge\(frameRef, \{[\s\S]*?seatDeps,/)
  assert.equal(bridgeSource.match(/case 'amphoreus:dispatch'/gu)?.length, 1)
  assert.match(clientSource, /const enterSeatQueue = createEnterSeatQueue\(\)/u)
  assert.match(clientSource, /seatDeps,\s*enterSeatQueue,\s*openPortal,/u)
  const overlayStart = clientSource.indexOf("ctx.slots.inject('shell.overlay'")
  const viewStart = clientSource.indexOf("ctx.slots.inject('conversation.view'")
  assert.doesNotMatch(clientSource.slice(overlayStart, viewStart), /enterSeatQueue/u)
})
