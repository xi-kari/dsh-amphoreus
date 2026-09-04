import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { AmphoreusConfig } from '../src/host/config.ts'
import { planForkInheritance, registerInjector, type InheritSeedEvent } from '../src/host/injector.ts'
import type { AmphoreusStores, BindingRecord } from '../src/host/store.ts'

const PARENT_ID = 'session-00000000-0000-0000-0000-000000000011'
const CHILD_ID = 'session-00000000-0000-0000-0000-000000000012'
const SKILL = 'amphoreus-aglaea'
const NOW = 1_725_000_000_000

const parentBinding = (patch: Partial<BindingRecord> = {}): BindingRecord => ({
  sessionId: PARENT_ID,
  skillName: SKILL,
  face: 'dialogue',
  boundAt: NOW - 1,
  source: 'manual',
  injection: { state: 'done', at: NOW - 1 },
  ...patch,
})

const seedInvocation = (name = SKILL, seq = 0): InheritSeedEvent => ({
  type: 'user/message',
  seq,
  data: { source: { kind: 'skill-invocation', name } },
})

function plan(overrides: Partial<Parameters<typeof planForkInheritance>[0]> = {}) {
  return planForkInheritance({
    childId: CHILD_ID,
    parent: parentBinding(),
    childExisting: undefined,
    freshFork: true,
    seedEvents: [],
    autoInvokeEnabled: true,
    now: NOW,
    ...overrides,
  })
}

test('plan: a parent without a binding does not create a child binding', () => {
  assert.equal(plan({ parent: undefined }), undefined)
})

test('plan: an existing child binding is never replaced', () => {
  const existing = parentBinding({ sessionId: CHILD_ID, source: 'seat-enter' })
  assert.equal(plan({ childExisting: existing }), undefined)
})

test('plan: a resumed seeded session fails the exact fresh-fork equality', () => {
  assert.equal(plan({ freshFork: false }), undefined)
})

test('plan: inherited and disabled injections retain their distinct skipped reasons', () => {
  assert.deepEqual(plan({ seedEvents: [seedInvocation()] })?.injection, {
    state: 'skipped',
    at: NOW,
    reason: 'inherited-from-parent',
  })
  assert.deepEqual(plan({ autoInvokeEnabled: false })?.injection, {
    state: 'skipped',
    at: NOW,
    reason: 'auto-invoke-disabled',
  })
})

test('plan: a fresh uninjected fork is pending, fork-sourced, and preserves the parent face', () => {
  assert.deepEqual(plan(), {
    sessionId: CHILD_ID,
    skillName: SKILL,
    face: 'dialogue',
    boundAt: NOW,
    source: 'fork-inherit',
    injection: { state: 'pending' },
  })
  assert.equal(Object.hasOwn(plan({ parent: parentBinding({ face: undefined }) })!, 'face'), false)
})

type Listener = (...args: any[]) => unknown

class FakeContext {
  readonly active = new Map<string, Listener>()
  readonly registered = new Map<string, Listener>()
  readonly warnings: string[] = []
  skillReads = 0
  readonly logger = { warn: (message: string) => { this.warnings.push(message) } }
  readonly skills = {
    get: async () => {
      this.skillReads += 1
      return {
        name: SKILL,
        description: 'fixture',
        invocation: { modelInvocable: false, userInvocable: true },
        source: 'custom',
        provider: 'fixture',
        content: '# inherited card',
      }
    },
  }

  on(name: string, listener: Listener): () => void {
    this.active.set(name, listener)
    this.registered.set(name, listener)
    return () => { this.active.delete(name) }
  }

  emit(name: string, ...args: any[]): unknown {
    return this.active.get(name)?.(...args)
  }
}

interface PutControl {
  readonly gate?: Promise<void>
  readonly failure?: Error
  readonly synchronousFailure?: Error
}

class QueuedBindings {
  readonly values = new Map<string, BindingRecord>()
  readonly puts: BindingRecord[] = []
  readonly controls: PutControl[] = []
  #tail: Promise<void> = Promise.resolve()

  get(key: string): BindingRecord | undefined {
    return this.values.get(key)
  }

  put(key: string, value: BindingRecord): Promise<void> {
    const control = this.controls.shift()
    if (control?.synchronousFailure !== undefined) throw control.synchronousFailure
    this.puts.push(structuredClone(value))
    const operation = this.#tail.then(async () => {
      await control?.gate
      if (control?.failure !== undefined) throw control.failure
      this.values.set(key, structuredClone(value))
    })
    this.#tail = operation.catch(() => {})
    return operation
  }

  async idle(): Promise<void> {
    await this.#tail
    await new Promise(resolve => setImmediate(resolve))
  }
}

function config(autoInvokeEnabled = true): AmphoreusConfig {
  return {
    skillRoots: [], dataDir: '', assetsRoot: '', commonPath: '', relationsPath: '', sectionAliases: {}, providerName: '', providerSource: '', providerRank: 0, registerProvider: true, forceUserOnly: false,
    heroWorkspaceMode: 'seats', magazineMode: 'light', seatStyle: true,
    wallpaper: { enabled: false, global: 'fixed', globalIndex: 0, sidebarIndex: 0, perSeat: false, darkMask: 0, lightMask: 0, surfaceAlpha: { light: 0.22, dark: 0.4 } },
    autoInvoke: { enabled: autoInvokeEnabled, sources: ['startup'] }, receiptParsing: true, handoff: { enabled: true },
    workbench: { enabled: false, host: 'iframe', defaultView: 'chat', cardTextLimit: 8000, autoProjection: false },
    suiteWatch: { mode: 'off', pollMs: 15_000, debounceMs: 800 }, validate: { enabled: false, python: 'python' },
    sync: { source: '', ref: '', keepBackups: 3 }, trustedHosts: [],
  }
}

function stores(table: QueuedBindings): AmphoreusStores {
  return {
    main: { table: (name: string) => {
      assert.equal(name, 'bindings')
      return table
    } },
  } as unknown as AmphoreusStores
}

function createdSession(options: {
  readonly firstLiveSeq?: number
  readonly inheritedEventCount?: number
  readonly events?: readonly InheritSeedEvent[]
  readonly snapshotFailure?: Error
} = {}) {
  const inheritedEventCount = options.inheritedEventCount ?? 1
  const events = options.events ?? [{ type: 'request/header', seq: 0, data: {} }]
  return {
    id: CHILD_ID,
    header: { id: CHILD_ID, cwd: 'D:/fixture', parentSession: PARENT_ID },
    inheritedEventCount,
    firstLiveSeq: options.firstLiveSeq ?? inheritedEventCount,
    snapshotEvents: (from = 0, to = events.length) => {
      if (options.snapshotFailure !== undefined) throw options.snapshotFailure
      return events.slice(from, to)
    },
  }
}

function fakeAgent(injected: unknown[]) {
  return {
    session: { id: CHILD_ID, header: { cwd: 'D:/fixture' } },
    inject: (message: unknown) => { injected.push(message) },
  }
}

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'timed out waiting for asynchronous listener work')
    await new Promise(resolve => setImmediate(resolve))
  }
}

function injectorFixture() {
  const context = new FakeContext()
  const table = new QueuedBindings()
  table.values.set(PARENT_ID, parentBinding())
  const dispose = registerInjector(context as unknown as Context, { config: config(), stores: stores(table) })
  return { context, table, dispose }
}

test('listener: Path 1 reads inheritedPending while the binding put is still queued', async () => {
  const { context, table, dispose } = injectorFixture()
  const gate = deferred()
  table.controls.push({ gate: gate.promise })
  const injected: unknown[] = []
  try {
    context.emit('session/created', createdSession({
      events: [
        { type: 'request/header', seq: 0, data: {} },
        seedInvocation(SKILL, 1),
      ],
    }))
    assert.equal(table.puts[0]?.injection.state, 'pending')
    context.emit('agent/session-start', { agent: fakeAgent(injected), source: 'startup' })
    await waitFor(() => injected.length === 1)
    assert.equal(table.values.has(CHILD_ID), false)

    gate.resolve()
    await table.idle()
    assert.equal(table.values.get(CHILD_ID)?.injection.state, 'done')
    assert.equal(table.values.get(CHILD_ID)?.source, 'fork-inherit')
  } finally {
    gate.resolve()
    dispose()
  }
})

test('listener: Path 2 also reads inheritedPending and persists done after the queued put', async () => {
  const { context, table, dispose } = injectorFixture()
  const gate = deferred()
  table.controls.push({ gate: gate.promise })
  try {
    context.emit('session/created', createdSession())
    const preStep = context.emit('agent/pre-step', {
      agent: fakeAgent([]),
      messages: [],
      signal: AbortSignal.timeout(1_000),
    }, async () => ({ kind: 'enter', messages: [] })) as Promise<{ kind: string; messages: any[] }>
    await waitFor(() => context.skillReads === 1)
    assert.equal(table.values.has(CHILD_ID), false)

    gate.resolve()
    const decision = await preStep
    await table.idle()
    assert.equal(decision.kind, 'enter')
    assert.equal(decision.messages.length, 1)
    assert.deepEqual(decision.messages[0]?.source, { kind: 'skill-invocation', name: SKILL, form: 'instructions' })
    assert.equal(table.values.get(CHILD_ID)?.injection.state, 'done')
  } finally {
    gate.resolve()
    dispose()
  }
})

test('listener: rejected and synchronous puts warn and clear the pending fallback', async () => {
  for (const control of [
    { failure: new Error('async put failed') },
    { synchronousFailure: new Error('sync put failed') },
  ]) {
    const { context, table, dispose } = injectorFixture()
    const injected: unknown[] = []
    try {
      table.controls.push(control)
      context.emit('session/created', createdSession())
      await table.idle()
      context.emit('agent/session-start', { agent: fakeAgent(injected), source: 'startup' })
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(injected.length, 0)
      assert.equal(table.values.has(CHILD_ID), false)
      assert.ok(context.warnings.some(message => message.includes(control.failure?.message ?? control.synchronousFailure?.message ?? '')))
    } finally {
      dispose()
    }
  }
})

test('listener: snapshot failures are contained, and resumed sessions create no binding', async () => {
  const { context, table, dispose } = injectorFixture()
  try {
    context.emit('session/created', createdSession({ snapshotFailure: new Error('snapshot failed') }))
    context.emit('session/created', createdSession({ firstLiveSeq: 3, inheritedEventCount: 1 }))
    await table.idle()
    assert.equal(table.puts.length, 0)
    assert.equal(table.values.has(CHILD_ID), false)
    assert.ok(context.warnings.some(message => message.includes('snapshot failed')))
  } finally {
    dispose()
  }
})

test('listener: disposing clears an in-flight pending fallback and unregisters all three paths', async () => {
  const { context, table, dispose } = injectorFixture()
  const gate = deferred()
  const injected: unknown[] = []
  table.controls.push({ gate: gate.promise })
  context.emit('session/created', createdSession())
  const retainedStart = context.registered.get('agent/session-start')!

  dispose()
  assert.equal(context.active.size, 0)
  retainedStart({ agent: fakeAgent(injected), source: 'startup' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(injected.length, 0)

  gate.resolve()
  await table.idle()
})
