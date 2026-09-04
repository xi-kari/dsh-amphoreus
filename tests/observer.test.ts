import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SuiteResolver } from '../src/host/bridge.ts'
import type { AmphoreusConfig } from '../src/host/config.ts'
import { buildMatchers, extractObservations, registerObserver } from '../src/host/observer.ts'
import type { AmphoreusStores, BindingRecord, ObservationRecord } from '../src/host/store.ts'
import type { SuiteSnapshot } from '../src/host/suite/types.ts'
import { fixtureConfig, fixtureSnapshot } from './fixture-suite.ts'

const SESSION_A = 'session-00000000-0000-4000-8000-0000000000a1'
const SESSION_B = 'session-00000000-0000-4000-8000-0000000000b2'
const CARD_A = 'amphoreus-testcard-a'
const CARD_B = 'amphoreus-testcard-b'

test('extractObservations parses handoff plus final receipt with runtime target and face lookup', () => {
  const snapshot = fixtureSnapshot({ withFaceCard: true })
  assert.equal(fixtureSnapshot().cards.size, 1)
  assert.equal(snapshot.cards.size, 2)
  assert.deepEqual(snapshot.nameIndex.get('夜星'), { skill: CARD_B, face: '夜星' })

  assert.deepEqual(extractObservations(
    '正文…\n此事移交夜星：<修复计划>\n晨星卡｜读取：common.md｜档位：标准',
    buildMatchers(snapshot),
    snapshot.nameIndex,
  ), [
    {
      kind: 'handoff',
      rawLine: '此事移交夜星：<修复计划>',
      payload: '<修复计划>',
      targetSkillName: CARD_B,
      targetDisplayName: '夜星',
      targetFace: '夜星',
    },
    {
      kind: 'receipt',
      rawLine: '晨星卡｜读取：common.md｜档位：标准',
      payload: 'common.md',
      tier: '标准',
      targetSkillName: CARD_A,
      targetDisplayName: '晨星',
    },
  ])
})

test('extractObservations parses notify, absence, and unresolved targets without guessing', () => {
  const snapshot = fixtureSnapshot({ withFaceCard: true })
  const matchers = buildMatchers(snapshot)

  assert.deepEqual(extractObservations('此事知会晨星：<纪要>', matchers, snapshot.nameIndex), [{
    kind: 'notify',
    rawLine: '此事知会晨星：<纪要>',
    payload: '<纪要>',
    targetSkillName: CARD_A,
    targetDisplayName: '晨星',
  }])
  assert.deepEqual(extractObservations('角色未部署｜原因：module_unavailable｜未完成职责：规划', matchers, snapshot.nameIndex), [{
    kind: 'absence',
    rawLine: '角色未部署｜原因：module_unavailable｜未完成职责：规划',
    payload: '规划',
    targetSkillName: null,
  }])
  assert.deepEqual(extractObservations('此事移交无名：<待办>', matchers, snapshot.nameIndex), [{
    kind: 'handoff',
    rawLine: '此事移交无名：<待办>',
    payload: '<待办>',
    targetSkillName: null,
    targetDisplayName: '无名',
  }])
})

test('extractObservations excludes complete backtick and tilde fences and limits transfers to six tail lines', () => {
  const snapshot = fixtureSnapshot({ withFaceCard: true })
  const matchers = buildMatchers(snapshot)
  const fenced = [
    '正文',
    '```text',
    '```not-a-closing-fence',
    '此事移交夜星：<伪移交>',
    '晨星卡｜读取：common.md｜档位：标准',
    '```',
    '~~~~fixture',
    '此事知会晨星：<伪知会>',
    '角色未部署｜原因：module_unavailable｜未完成职责：伪缺席',
    '~~~~',
    '收尾',
  ].join('\n')
  assert.deepEqual(extractObservations(fenced, matchers, snapshot.nameIndex), [])

  const oldTransfer = Array.from({ length: 20 }, (_, index) => index === 2
    ? '此事移交夜星：<过早示例>'
    : `正文 ${index + 1}`).join('\n')
  assert.deepEqual(extractObservations(oldTransfer, matchers, snapshot.nameIndex), [])
})

test('empty matchers are inert and global regexes reset lastIndex across repeated extraction', () => {
  const snapshot = fixtureSnapshot({ withFaceCard: true })
  assert.deepEqual(buildMatchers(undefined), {})
  assert.deepEqual(extractObservations('此事移交夜星：<修复>', {}, snapshot.nameIndex), [])

  const base = buildMatchers(snapshot).handoff!
  const global = new RegExp(base.source, `${base.flags}g`)
  const matchers = { handoff: global }
  const input = '此事移交夜星：<修复>'
  assert.equal(extractObservations(input, matchers, snapshot.nameIndex).length, 1)
  assert.equal(global.lastIndex, 0)
  assert.equal(extractObservations(input, matchers, snapshot.nameIndex).length, 1)
  assert.equal(global.lastIndex, 0)
})

test('live listener plus ownEvents replay serialize duplicate input while retaining multiple kinds at one seq', async () => {
  const event = assistantEvent(7, '此事移交夜星：<修复>\n晨星卡｜读取：common.md｜档位：标准')
  const fixture = observerFixture({
    snapshot: fixtureSnapshot({ withFaceCard: true }),
    sessions: [liveSession(SESSION_A, [event])],
  })
  const changes: DomainChange[] = []
  const offChanges = fixture.context.on('domain/changed', change => { changes.push(change as DomainChange) })
  const dispose = fixture.register()

  fixture.context.emit('session/event', liveSession(SESSION_A), event)
  await dispose()
  offChanges()

  assert.deepEqual([...fixture.observations.values.keys()].sort(), [
    `${SESSION_A}:7:handoff`,
    `${SESSION_A}:7:receipt`,
  ])
  assert.equal(fixture.observations.putCalls, 2)
  assert.deepEqual(changes.map(change => `${change.table}:${change.key}`).sort(), [
    `observations:${SESSION_A}:7:handoff`,
    `observations:${SESSION_A}:7:receipt`,
  ])
})

test('a resumed session announced after an empty startup list replays owned contracts exactly once', async () => {
  const event = assistantEvent(1948, '此事移交夜星：<恢复后移交>\n晨星卡｜读取：common.md｜档位：标准')
  const resumed = liveSession(SESSION_A, [event])
  const fixture = observerFixture({ snapshot: fixtureSnapshot({ withFaceCard: true }), sessions: [] })
  const dispose = fixture.register()

  fixture.context.emit('session/created', resumed)
  fixture.context.emit('session/created', resumed)
  fixture.context.emit('session/event', resumed, event)
  await dispose()

  assert.deepEqual([...fixture.observations.values.keys()].sort(), [
    `${SESSION_A}:1948:handoff`,
    `${SESSION_A}:1948:receipt`,
  ])
  assert.equal(fixture.observations.putCalls, 2)
})

test('existing decisions are never overwritten and existing receipts can repair an unfinished face flip', async () => {
  const snapshot = fixtureSnapshot({ withFaceCard: true })
  const event = assistantEvent(8, '此事移交夜星：<已决定>\n夜星卡｜读取：common.md｜档位：标准')
  const fixture = observerFixture({ snapshot, sessions: [liveSession(SESSION_A, [event])] })
  const dismissed = observation({
    sessionId: SESSION_A,
    seq: 8,
    kind: 'handoff',
    rawLine: '此事移交夜星：<已决定>',
    payload: '<已决定>',
    targetSkillName: CARD_B,
    targetDisplayName: '夜星',
    targetFace: '夜星',
    status: 'dismissed',
  })
  const receipt = observation({
    sessionId: SESSION_A,
    seq: 8,
    kind: 'receipt',
    rawLine: '夜星卡｜读取：common.md｜档位：标准',
    payload: 'common.md',
    tier: '标准',
    targetSkillName: CARD_B,
    targetDisplayName: '夜星',
    targetFace: '夜星',
    status: 'accepted',
  })
  fixture.observations.values.set(`${SESSION_A}:8:handoff`, dismissed)
  fixture.observations.values.set(`${SESSION_A}:8:receipt`, receipt)
  const original = binding(SESSION_A, CARD_B)
  fixture.bindings.values.set(SESSION_A, original)

  const dispose = fixture.register()
  fixture.context.emit('session/event', liveSession(SESSION_A), event)
  await dispose()

  assert.equal(fixture.observations.values.get(`${SESSION_A}:8:handoff`), dismissed)
  assert.equal(fixture.observations.putCalls, 0)
  assert.equal(fixture.bindings.updateCalls, 1)
  assert.deepEqual(fixture.bindings.values.get(SESSION_A), { ...original, face: '夜星' })
})

test('interrupted live and replay messages and non-text blocks never produce observations', async () => {
  const interrupted = assistantEvent(1, '此事移交晨星：<中断>', { interrupted: true })
  const toolOnly = assistantEvent(2, '', {
    content: [{ type: 'tool-call', arguments: '此事移交晨星：<工具参数>' }],
  })
  const fixture = observerFixture({ sessions: [liveSession(SESSION_A, [interrupted, toolOnly])] })
  const dispose = fixture.register()

  fixture.context.emit('session/event', liveSession(SESSION_A), interrupted)
  await dispose()
  assert.equal(fixture.observations.values.size, 0)
})

test('handoff and receipt switches independently gate their observation families', async () => {
  assert.deepEqual(await observedKinds({ handoff: { enabled: false }, receiptParsing: true }), ['absence', 'receipt'])
  assert.deepEqual(await observedKinds({ handoff: { enabled: true }, receiptParsing: false }), ['handoff', 'notify'])
  assert.deepEqual(await observedKinds({ handoff: { enabled: false }, receiptParsing: false }), [])
})

test('resolver snapshots atomically replace matchers and name index for subsequent events', async () => {
  const fixture = observerFixture()
  const dispose = fixture.register()
  fixture.resolver.publish(fixtureSnapshot({ withFaceCard: true }))
  fixture.context.emit('session/event', liveSession(SESSION_A), assistantEvent(4, '此事移交夜星：<新合同>'))
  await dispose()

  const value = fixture.observations.values.get(`${SESSION_A}:4:handoff`)
  assert.equal(value?.targetSkillName, CARD_B)
  assert.equal(value?.targetFace, '夜星')
  assert.equal(fixture.resolver.listenerCount, 0)
  assert.equal(fixture.context.listenerCount('session/event'), 0)
})

test('receipt face updates are atomic, preserve binding fields, emit domain changes, and reject mismatched ownership', async () => {
  const fixture = observerFixture({ snapshot: fixtureSnapshot({ withFaceCard: true }) })
  const originalA = binding(SESSION_A, CARD_B)
  const originalB = binding(SESSION_B, CARD_A)
  fixture.bindings.values.set(SESSION_A, originalA)
  fixture.bindings.values.set(SESSION_B, originalB)
  const changes: DomainChange[] = []
  const offChanges = fixture.context.on('domain/changed', change => { changes.push(change as DomainChange) })
  const dispose = fixture.register()

  const receipt = '夜星卡｜读取：common.md｜档位：标准'
  fixture.context.emit('session/event', liveSession(SESSION_A), assistantEvent(10, receipt))
  fixture.context.emit('session/event', liveSession(SESSION_A), assistantEvent(10, receipt))
  fixture.context.emit('session/event', liveSession(SESSION_B), assistantEvent(11, receipt))
  await dispose()
  offChanges()

  assert.deepEqual(fixture.bindings.values.get(SESSION_A), { ...originalA, face: '夜星' })
  assert.deepEqual(fixture.bindings.values.get(SESSION_B), originalB)
  assert.equal(fixture.bindings.updateCalls, 1)
  assert.equal(fixture.observations.putCalls, 2)
  assert.deepEqual(changes.map(change => change.table).sort(), ['bindings', 'observations', 'observations'])
})

test('async disposer detaches immediately, drains an in-flight write, and ignores later events', async () => {
  const fixture = observerFixture()
  const gate = deferred()
  fixture.observations.controls.push({ gate: gate.promise })
  const dispose = fixture.register()
  fixture.context.emit('session/event', liveSession(SESSION_A), assistantEvent(1, '此事移交晨星：<排空>'))
  await waitFor(() => fixture.observations.startedPuts === 1)

  let settled = false
  const firstDisposal = dispose()
  const draining = firstDisposal.then(() => { settled = true })
  assert.equal(fixture.context.listenerCount('session/event'), 0)
  assert.equal(fixture.context.listenerCount('session/created'), 0)
  assert.equal(fixture.resolver.listenerCount, 0)
  fixture.context.emit('session/event', liveSession(SESSION_A), assistantEvent(2, '此事移交晨星：<不应写入>'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)

  gate.resolve()
  await draining
  assert.equal(fixture.observations.putCalls, 1)
  assert.equal(fixture.observations.values.has(`${SESSION_A}:2:handoff`), false)
  assert.equal(dispose(), firstDisposal)
})

test('a failed write is warned and does not stop the serialized queue', async () => {
  const fixture = observerFixture()
  fixture.observations.controls.push({ failure: new Error('durability failed') })
  const dispose = fixture.register()
  fixture.context.emit('session/event', liveSession(SESSION_A), assistantEvent(1, '此事移交晨星：<失败>'))
  fixture.context.emit('session/event', liveSession(SESSION_A), assistantEvent(2, '晨星卡｜读取：common.md｜档位：标准'))
  await dispose()

  assert.equal(fixture.context.warnings.length, 1)
  assert.match(fixture.context.warnings[0]!, /durability failed/)
  assert.equal(fixture.observations.values.has(`${SESSION_A}:1:handoff`), false)
  assert.equal(fixture.observations.values.has(`${SESSION_A}:2:receipt`), true)
})

test('host assembly starts the observer after the resolver and drains it before bridge and stores close', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.ok(source.indexOf('await bridge.start()') < source.indexOf('registerObserver(ctx'))
  assert.ok(source.indexOf('await disposeObserver()') < source.indexOf('await bridge.close()'))
  assert.ok(source.indexOf('await disposeObserver()') < source.indexOf('await stores?.close()'))
})

interface DomainChange {
  readonly domain: string
  readonly table: string
  readonly key: string
  readonly operation: 'put'
  readonly value: unknown
}

interface TableControl {
  readonly gate?: Promise<void>
  readonly failure?: Error
}

class FakeTable<T> {
  readonly values = new Map<string, T>()
  readonly controls: TableControl[] = []
  readonly name: string
  readonly #changed: (change: DomainChange) => void
  putCalls = 0
  updateCalls = 0
  startedPuts = 0

  constructor(
    name: string,
    changed: (change: DomainChange) => void,
  ) {
    this.name = name
    this.#changed = changed
  }

  get(key: string): T | undefined {
    return this.values.get(key)
  }

  entries(): IterableIterator<[string, T]> {
    return new Map(this.values).entries()
  }

  keys(): IterableIterator<string> {
    return new Map(this.values).keys()
  }

  get size(): number {
    return this.values.size
  }

  async put(key: string, value: T): Promise<void> {
    this.putCalls++
    this.startedPuts++
    const control = this.controls.shift()
    await control?.gate
    if (control?.failure !== undefined) throw control.failure
    this.values.set(key, structuredClone(value))
    this.#changed({ domain: 'amphoreus', table: this.name, key, operation: 'put', value })
  }

  async update(key: string, transform: (current: T) => T): Promise<T> {
    this.updateCalls++
    const current = this.values.get(key)
    if (current === undefined) throw new Error(`missing-key: ${key}`)
    const next = transform(current)
    this.values.set(key, structuredClone(next))
    this.#changed({ domain: 'amphoreus', table: this.name, key, operation: 'put', value: next })
    return next
  }
}

type Listener = (...args: unknown[]) => unknown

class FakeContext {
  readonly warnings: string[] = []
  readonly liveSessions: ReturnType<typeof liveSession>[]
  readonly sessions: { list: () => ReturnType<typeof liveSession>[] }
  readonly logger = {
    warn: (message: string) => { this.warnings.push(message) },
  }
  readonly #listeners = new Map<string, Set<Listener>>()

  constructor(sessions: ReturnType<typeof liveSession>[] = []) {
    this.liveSessions = sessions
    this.sessions = { list: () => [...this.liveSessions] }
  }

  on(name: string, listener: Listener): () => void {
    const listeners = this.#listeners.get(name) ?? new Set()
    listeners.add(listener)
    this.#listeners.set(name, listeners)
    return () => { listeners.delete(listener) }
  }

  emit(name: string, ...args: unknown[]): void {
    for (const listener of [...(this.#listeners.get(name) ?? [])]) listener(...args)
  }

  listenerCount(name: string): number {
    return this.#listeners.get(name)?.size ?? 0
  }
}

class FakeResolver {
  readonly #listeners = new Set<(snapshot: SuiteSnapshot) => void | Promise<void>>()
  private snapshot: SuiteSnapshot | undefined

  constructor(snapshot: SuiteSnapshot | undefined) {
    this.snapshot = snapshot
  }

  current(): SuiteSnapshot | undefined {
    return this.snapshot
  }

  onSnapshot(listener: (snapshot: SuiteSnapshot) => void | Promise<void>): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  publish(snapshot: SuiteSnapshot): void {
    this.snapshot = snapshot
    for (const listener of [...this.#listeners]) void listener(snapshot)
  }

  get listenerCount(): number {
    return this.#listeners.size
  }
}

function observerFixture(options: {
  readonly snapshot?: SuiteSnapshot
  readonly config?: AmphoreusConfig
  readonly sessions?: ReturnType<typeof liveSession>[]
} = {}) {
  const context = new FakeContext(options.sessions)
  const changed = (change: DomainChange) => { context.emit('domain/changed', change) }
  const observations = new FakeTable<ObservationRecord>('observations', changed)
  const bindings = new FakeTable<BindingRecord>('bindings', changed)
  const resolver = new FakeResolver(options.snapshot ?? fixtureSnapshot())
  const stores = {
    main: {
      table: (name: string) => {
        if (name === 'observations') return observations
        if (name === 'bindings') return bindings
        throw new Error(`unexpected table: ${name}`)
      },
    },
  } as unknown as AmphoreusStores
  return {
    context,
    resolver,
    observations,
    bindings,
    register: () => registerObserver(context as unknown as Context, {
      config: options.config ?? fixtureConfig(),
      stores,
      resolver: resolver as unknown as SuiteResolver,
    }),
  }
}

function liveSession(id: string, events: readonly SessionEvent[] = []) {
  return { id, ownEvents: () => events }
}

function assistantEvent(
  seq: number,
  text: string,
  options: { readonly interrupted?: boolean; readonly content?: readonly unknown[] } = {},
): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time: 1_725_000_000_000 + seq,
    data: {
      turn: 1,
      step: 1,
      message: {
        content: options.content ?? [{ type: 'text', text }],
      },
      ...(options.interrupted === true ? { interrupted: true } : {}),
    },
  } as unknown as SessionEvent
}

function binding(sessionId: string, skillName: string): BindingRecord {
  return {
    sessionId,
    skillName,
    boundAt: 1_725_000_000_000,
    source: 'manual',
    injection: { state: 'done', at: 1_725_000_000_001 },
    handoffFrom: { sessionId: 'session-00000000-0000-4000-8000-000000000000', seq: 3 },
  }
}

function observation(patch: Partial<ObservationRecord> & Pick<ObservationRecord, 'sessionId' | 'seq' | 'kind' | 'rawLine' | 'status'>): ObservationRecord {
  return {
    parsedAt: 1_725_000_000_000,
    ...patch,
  }
}

async function observedKinds(configPatch: Pick<AmphoreusConfig, 'handoff' | 'receiptParsing'>): Promise<string[]> {
  const config = { ...fixtureConfig(), ...configPatch }
  const fixture = observerFixture({ config, snapshot: fixtureSnapshot({ withFaceCard: true }) })
  const dispose = fixture.register()
  fixture.context.emit('session/event', liveSession(SESSION_A), assistantEvent(3, [
    '此事移交夜星：<移交>',
    '此事知会晨星：<知会>',
    '角色未部署｜原因：module_unavailable｜未完成职责：缺席',
    '晨星卡｜读取：common.md｜档位：标准',
  ].join('\n')))
  await dispose()
  return [...fixture.observations.values.values()].map(value => value.kind).sort()
}

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'timed out waiting for observer work')
    await new Promise(resolve => setImmediate(resolve))
  }
}
