import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { AmphoreusConfig, SessionStartSourceName } from '../src/host/config.ts'
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

  update(key: string, transform: (value: BindingRecord) => BindingRecord): Promise<BindingRecord> {
    const control = this.controls.shift()
    const operation = this.#tail.then(async () => {
      await control?.gate
      if (control?.failure !== undefined) throw control.failure
      const current = this.values.get(key)
      if (current === undefined) throw Object.assign(new Error('missing binding'), { code: 'missing-key' })
      const value = transform(current)
      this.puts.push(structuredClone(value))
      this.values.set(key, structuredClone(value))
      return value
    })
    this.#tail = operation.catch(() => {})
    return operation
  }

  delete(key: string): Promise<void> {
    const operation = this.#tail.then(() => { this.values.delete(key) })
    this.#tail = operation.catch(() => {})
    return operation
  }

  async idle(): Promise<void> {
    await this.#tail
    await new Promise(resolve => setImmediate(resolve))
  }
}

function config(
  autoInvokeEnabled = true,
  sources: SessionStartSourceName[] = ['startup'],
): AmphoreusConfig {
  return {
    skillRoots: [], dataDir: '', assetsRoot: '', commonPath: '', relationsPath: '', sectionAliases: {}, providerName: '', providerSource: '', providerRank: 0, registerProvider: true, forceUserOnly: false,
    heroWorkspaceMode: 'seats', magazineMode: 'light', seatStyle: true,
    wallpaper: { enabled: false, global: 'fixed', globalIndex: 0, sidebarIndex: 0, perSeat: false, darkMask: 0, lightMask: 0, surfaceAlpha: { light: 0.22, dark: 0.4 } },
    autoInvoke: { enabled: autoInvokeEnabled, sources }, receiptParsing: true, handoff: { enabled: true },
    workbench: { enabled: false, host: 'iframe', defaultView: 'chat', cardTextLimit: 8000, autoProjection: false },
    suiteWatch: { mode: 'off', pollMs: 15_000, debounceMs: 800 }, validate: { enabled: false, python: 'python' },
    sync: { source: '', ref: '', keepBackups: 3 }, trustedHosts: [],
    memory: { inject: true, autoNote: true, injectLimit: 8, command: 'remember' },
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
  const events: (InheritSeedEvent & { time: number })[] = []
  return {
    session: { id: CHILD_ID, header: { cwd: 'D:/fixture' }, snapshotEvents: () => events },
    inject: (message: unknown) => { injected.push(message) },
  }
}

function commitMessages(context: FakeContext, agent: ReturnType<typeof fakeAgent>, decision: { messages: any[] }): void {
  for (const message of decision.messages) {
    const event = { type: 'user/message', seq: agent.session.snapshotEvents().length, time: Date.now(), data: message }
    agent.session.snapshotEvents().push(event)
    context.emit('session/event', agent.session, event)
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

function injectorFixture(injectorConfig = config()) {
  const context = new FakeContext()
  const table = new QueuedBindings()
  table.values.set(PARENT_ID, parentBinding())
  const dispose = registerInjector(context as unknown as Context, { config: injectorConfig, stores: stores(table) })
  return { context, table, dispose }
}

test('listener: pre-step reads inheritedPending while the binding put is still queued', async () => {
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
    const preStep = context.emit('agent/pre-step', {
      agent: fakeAgent(injected),
      messages: [],
      signal: AbortSignal.timeout(1_000),
    }, async () => ({ kind: 'enter', messages: [] })) as Promise<{ kind: string; messages: any[] }>
    await waitFor(() => context.skillReads === 1)
    assert.equal(injected.length, 0)
    assert.equal(table.values.has(CHILD_ID), false)

    gate.resolve()
    const decision = await preStep
    assert.equal(table.puts.filter(value => value.injection.state === 'done').length, 0)
    commitMessages(context, fakeAgent(injected), decision)
    await table.idle()
    assert.equal(decision.messages.length, 1)
    assert.deepEqual(decision.messages[0]?.source, { kind: 'skill-invocation', name: SKILL, form: 'instructions' })
    assert.equal(table.values.get(CHILD_ID)?.injection.state, 'done')
    assert.equal(table.values.get(CHILD_ID)?.source, 'fork-inherit')
  } finally {
    gate.resolve()
    dispose()
  }
})

test('listener: pre-step reads inheritedPending and persists done after the queued put', async () => {
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
    assert.equal(table.puts.filter(value => value.injection.state === 'done').length, 0)
    commitMessages(context, fakeAgent([]), decision)
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

test('listener: a first prompt racing session-start receives the card in its accepted pre-step', async () => {
  const { context, table, dispose } = injectorFixture()
  const nextGate = deferred()
  const injected: unknown[] = []
  const agent = fakeAgent(injected)
  const userMessage = {
    role: 'user',
    content: [{ type: 'text', text: '你是谁' }],
    source: { kind: 'user' },
  }
  table.values.set(CHILD_ID, parentBinding({
    sessionId: CHILD_ID,
    source: 'seat-new',
    injection: { state: 'pending' },
  }))

  try {
    context.emit('agent/session-start', { agent, source: 'startup' })
    const proposed = context.emit('agent/pre-step', {
      agent,
      messages: [userMessage],
      signal: AbortSignal.timeout(1_000),
    }, async () => {
      await nextGate.promise
      return { kind: 'enter', messages: [userMessage] }
    }) as Promise<{ kind: string; messages: any[] }>

    // Let the notification-style session-start listener settle while the
    // accepted pre-step is deliberately held downstream. A correct injector
    // must still commit the card only through this pre-step decision.
    await new Promise(resolve => setImmediate(resolve))
    nextGate.resolve()
    const decision = await proposed
    assert.equal(table.values.get(CHILD_ID)?.injection.state, 'pending')
    commitMessages(context, agent, decision)
    await table.idle()

    assert.equal(injected.length, 0)
    assert.deepEqual(decision.messages.map(message => message.source.kind), ['user', 'skill-invocation'])
    assert.equal(decision.messages[1]?.source.name, SKILL)
    assert.equal(table.values.get(CHILD_ID)?.injection.state, 'done')
  } finally {
    nextGate.resolve()
    dispose()
  }
})

test('listener: startup, clear, compact, and resume sources gate the sole pre-step path', async () => {
  const cases: readonly {
    source: SessionStartSourceName
    enabledSources: SessionStartSourceName[]
    expected: number
  }[] = [
    { source: 'startup', enabledSources: ['startup'], expected: 1 },
    { source: 'clear', enabledSources: ['startup', 'clear'], expected: 1 },
    { source: 'compact', enabledSources: ['compact'], expected: 1 },
    { source: 'compact', enabledSources: ['startup', 'clear'], expected: 0 },
    { source: 'resume', enabledSources: ['startup'], expected: 1 },
  ]

  for (const row of cases) {
    const { context, table, dispose } = injectorFixture(config(true, row.enabledSources))
    const injected: unknown[] = []
    table.values.set(CHILD_ID, parentBinding({
      sessionId: CHILD_ID,
      source: 'seat-new',
      injection: { state: 'pending' },
    }))
    try {
      const agent = fakeAgent(injected)
      context.emit('agent/session-start', { agent, source: row.source })
      const decision = await context.emit('agent/pre-step', {
        agent,
        messages: [],
        signal: AbortSignal.timeout(1_000),
      }, async () => ({ kind: 'enter', messages: [] })) as { kind: string; messages: any[] }
      commitMessages(context, agent, decision)
      await table.idle()

      assert.equal(injected.length, 0, row.source)
      assert.equal(decision.messages.filter(message => message.source.kind === 'skill-invocation').length, row.expected, row.source)
      assert.equal(table.values.get(CHILD_ID)?.injection.state, row.expected === 1 ? 'done' : 'pending', row.source)
    } finally {
      dispose()
    }
  }
})

test('listener: a same-step explicit invocation wins without a second automatic card', async () => {
  const { context, table, dispose } = injectorFixture()
  const injected: unknown[] = []
  const agent = fakeAgent(injected)
  const explicit = {
    id: 'explicit-same-step',
    role: 'user',
    content: [{ type: 'text', text: '<skill_content name="amphoreus-aglaea">explicit</skill_content>' }],
    source: { kind: 'skill-invocation', name: SKILL, form: 'instructions' },
  }
  table.values.set(CHILD_ID, parentBinding({
    sessionId: CHILD_ID,
    source: 'seat-new',
    injection: { state: 'pending' },
  }))

  try {
    context.emit('agent/session-start', { agent, source: 'startup' })
    const decision = await context.emit('agent/pre-step', {
      agent,
      messages: [],
      signal: AbortSignal.timeout(1_000),
    }, async () => ({ kind: 'enter', messages: [explicit] })) as { kind: string; messages: any[] }
    assert.equal(table.values.get(CHILD_ID)?.injection.state, 'pending')
    commitMessages(context, agent, decision)
    await table.idle()

    assert.equal(injected.length, 0)
    assert.equal(decision.messages.filter(message => message.source.kind === 'skill-invocation').length, 1)
    assert.deepEqual(table.values.get(CHILD_ID)?.injection, {
      state: 'skipped',
      at: table.values.get(CHILD_ID)?.injection.at,
      reason: 'user-invoked-same-skill',
    })
  } finally {
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

test('listener: disposing clears an in-flight pending fallback and unregisters all listeners', async () => {
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

function pendingFixture() {
  const fixture = injectorFixture()
  const agent = fakeAgent([])
  fixture.table.values.set(CHILD_ID, parentBinding({ sessionId: CHILD_ID, source: 'seat-new', injection: { state: 'pending' } }))
  fixture.context.emit('agent/session-start', { agent, source: 'startup' })
  return { ...fixture, agent }
}

async function propose(context: FakeContext, agent: ReturnType<typeof fakeAgent>, options: {
  signal?: AbortSignal
  messages?: any[]
  next?: () => Promise<any>
} = {}): Promise<{ kind: string; messages: any[] }> {
  return await context.emit('agent/pre-step', {
    agent, messages: options.messages ?? [], signal: options.signal ?? AbortSignal.timeout(1_000),
  }, options.next ?? (async () => ({ kind: 'enter', messages: options.messages ?? [] }))) as { kind: string; messages: any[] }
}

test('listener: a rejected outer pre-step leaves the proposed card pending and the next attempt receives it', async () => {
  const { context, table, agent, dispose } = pendingFixture()
  try {
    const discarded = await propose(context, agent)
    assert.equal(discarded.messages.length, 1)
    await table.idle()
    assert.equal(table.values.get(CHILD_ID)?.injection.state, 'pending')
    const retry = await propose(context, agent)
    assert.equal(retry.messages.length, 1)
    assert.notEqual(retry.messages[0].id, discarded.messages[0].id)
    commitMessages(context, agent, retry)
    await table.idle()
    assert.equal(table.values.get(CHILD_ID)?.injection.state, 'done')
    assert.equal((await propose(context, agent)).messages.length, 0)
  } finally { dispose() }
})

test('listener: downstream rejection performs no lookup and retry still gets the card', async () => {
  const { context, table, agent, dispose } = pendingFixture()
  try {
    assert.equal((await propose(context, agent, { next: async () => ({ kind: 'reject', reason: 'test' }) })).kind, 'reject')
    assert.equal(context.skillReads, 0)
    assert.equal(table.values.get(CHILD_ID)?.injection.state, 'pending')
    assert.equal((await propose(context, agent)).messages.length, 1)
  } finally { dispose() }
})

test('listener: cancellation during skill lookup and after proposal never consumes the first injection', async () => {
  const { context, table, agent, dispose } = pendingFixture()
  const gate = deferred()
  const read = context.skills.get
  context.skills.get = async () => { await gate.promise; return read() }
  const controller = new AbortController()
  try {
    const cancelled = propose(context, agent, { signal: controller.signal })
    controller.abort()
    gate.resolve()
    await assert.rejects(cancelled, { name: 'AbortError' })
    assert.equal(table.values.get(CHILD_ID)?.injection.state, 'pending')
    const uncommitted = await propose(context, agent)
    assert.equal(uncommitted.messages.length, 1)
    assert.equal(table.values.get(CHILD_ID)?.injection.state, 'pending')
    const retry = await propose(context, agent)
    commitMessages(context, agent, retry)
    await table.idle()
    assert.equal(table.values.get(CHILD_ID)?.injection.state, 'done')
  } finally { gate.resolve(); dispose() }
})

test('listener: an unaccepted explicit skill and a removed input card do not suppress retry', async () => {
  const { context, table, agent, dispose } = pendingFixture()
  const explicit = { id: 'explicit', role: 'user', content: [], source: { kind: 'skill-invocation', name: SKILL } }
  try {
    const discarded = await propose(context, agent, { messages: [explicit] })
    assert.deepEqual(discarded.messages, [explicit])
    assert.equal(table.values.get(CHILD_ID)?.injection.state, 'pending')
    const retry = await propose(context, agent, { messages: [explicit], next: async () => ({ kind: 'enter', messages: [] }) })
    assert.equal(retry.messages.length, 1)
    assert.notEqual(retry.messages[0].id, explicit.id)
    commitMessages(context, agent, retry)
    await table.idle()
    assert.equal(table.values.get(CHILD_ID)?.injection.state, 'done')
  } finally { dispose() }
})

test('listener: accepted messages deduplicate before the asynchronous binding update completes', async () => {
  const { context, table, agent, dispose } = pendingFixture()
  const gate = deferred()
  try {
    const decision = await propose(context, agent)
    table.controls.push({ gate: gate.promise })
    commitMessages(context, agent, decision)
    assert.equal(table.values.get(CHILD_ID)?.injection.state, 'pending')
    assert.equal((await propose(context, agent)).messages.length, 0)
    context.emit('session/event', agent.session, agent.session.snapshotEvents()[0])
    gate.resolve()
    await table.idle()
    assert.equal(table.puts.length, 1)
    assert.equal(table.values.get(CHILD_ID)?.injection.state, 'done')
  } finally { gate.resolve(); dispose() }
})

test('listener: queued rebind and delete cannot be overwritten or resurrected by an old commit', async () => {
  for (const operation of ['rebind', 'delete'] as const) {
    const { context, table, agent, dispose } = pendingFixture()
    try {
      const decision = await propose(context, agent)
      const newBinding = parentBinding({ sessionId: CHILD_ID, skillName: 'amphoreus-cyrene', boundAt: Date.now(), injection: { state: 'pending' } })
      if (operation === 'rebind') void table.put(CHILD_ID, newBinding)
      else void table.delete(CHILD_ID)
      commitMessages(context, agent, decision)
      await table.idle()
      assert.deepEqual(table.values.get(CHILD_ID), operation === 'rebind' ? newBinding : undefined)
      assert.equal(context.warnings.length, 0)
    } finally { dispose() }
  }
})

test('listener: resumed pending sessions recover accepted logs within the current binding only', async () => {
  for (const logged of ['accepted', 'before-binding', 'other-skill', 'none'] as const) {
    const { context, table, agent, dispose } = pendingFixture()
    const current = table.values.get(CHILD_ID)!
    if (logged !== 'none') {
      agent.session.snapshotEvents().push({
        type: 'user/message', seq: 0, time: logged === 'before-binding' ? current.boundAt - 1 : current.boundAt,
        data: { source: { kind: 'skill-invocation', name: logged === 'other-skill' ? 'amphoreus-cyrene' : SKILL } },
      })
    }
    try {
      context.emit('agent/session-start', { agent, source: 'resume' })
      const decision = await propose(context, agent)
      await table.idle()
      assert.equal(decision.messages.length, logged === 'accepted' ? 0 : 1, logged)
      assert.equal(table.values.get(CHILD_ID)?.injection.state, logged === 'accepted' ? 'done' : 'pending', logged)
      assert.equal(context.skillReads, logged === 'accepted' ? 0 : 1, logged)
    } finally { dispose() }
  }
})

test('listener: completed logged cards and inherited bindings never inject on resume', async () => {
  for (const injection of [{ state: 'done', at: NOW }, { state: 'skipped', at: NOW, reason: 'inherited-from-parent' }] as const) {
    const { context, table, agent, dispose } = pendingFixture()
    table.values.set(CHILD_ID, { ...table.values.get(CHILD_ID)!, injection })
    if (injection.state === 'done') {
      agent.session.snapshotEvents().push({ type: 'user/message', seq: 0, time: NOW, data: { source: { kind: 'skill-invocation', name: SKILL } } })
    }
    try {
      context.emit('agent/session-start', { agent, source: 'resume' })
      assert.equal((await propose(context, agent)).messages.length, 0)
      assert.equal(context.skillReads, 0)
    } finally { dispose() }
  }
})

test('listener: a persisted done state without an accepted log card recovers the first injection on resume', async () => {
  for (const logged of ['none', 'before-binding', 'other-skill'] as const) {
    const { context, table, agent, dispose } = pendingFixture()
    const previous = { ...table.values.get(CHILD_ID)!, injection: { state: 'done' as const, at: NOW } }
    table.values.set(CHILD_ID, previous)
    if (logged !== 'none') {
      agent.session.snapshotEvents().push({
        type: 'user/message', seq: 0, time: logged === 'before-binding' ? previous.boundAt - 1 : NOW,
        data: { source: { kind: 'skill-invocation', name: logged === 'other-skill' ? 'amphoreus-cyrene' : SKILL } },
      })
    }
    try {
      context.emit('agent/session-start', { agent, source: 'resume' })
      const decision = await propose(context, agent)
      assert.equal(decision.messages.length, 1, logged)
      assert.equal(table.values.get(CHILD_ID)?.injection.state, 'pending', logged)
      commitMessages(context, agent, decision)
      await table.idle()
      assert.equal(table.values.get(CHILD_ID)?.injection.state, 'done', logged)
      assert.equal((await propose(context, agent)).messages.length, 0, logged)
    } finally { dispose() }
  }
})

test('listener: a failed status write does not repeat an accepted card and restart repairs from the log', async () => {
  const { context, table, agent, dispose } = pendingFixture()
  try {
    const decision = await propose(context, agent)
    table.controls.push({ failure: new Error('status write unavailable') })
    commitMessages(context, agent, decision)
    await table.idle()
    assert.equal(table.values.get(CHILD_ID)?.injection.state, 'pending')
    assert.equal((await propose(context, agent)).messages.length, 0)
    assert.ok(context.warnings.some(message => message.includes('status write unavailable')))
    dispose()
    const restarted = new FakeContext()
    const disposeRestarted = registerInjector(restarted as unknown as Context, { config: config(), stores: stores(table) })
    try {
      restarted.emit('agent/session-start', { agent, source: 'resume' })
      assert.equal((await propose(restarted, agent)).messages.length, 0)
      assert.equal(restarted.skillReads, 0)
      assert.equal(table.values.get(CHILD_ID)?.injection.state, 'done')
    } finally { disposeRestarted() }
  } finally { dispose() }
})

test('listener: changing the seat during card lookup rejects the stale proposal', async () => {
  const { context, table, agent, dispose } = pendingFixture()
  const gate = deferred()
  const read = context.skills.get
  let reading = false
  context.skills.get = async () => { reading = true; await gate.promise; return read() }
  try {
    const pending = propose(context, agent)
    await waitFor(() => reading)
    const changed = { ...table.values.get(CHILD_ID)!, skillName: 'amphoreus-cyrene', boundAt: Date.now() }
    await table.put(CHILD_ID, changed)
    gate.resolve()
    assert.equal((await pending).kind, 'reject')
    assert.deepEqual(table.values.get(CHILD_ID), changed)
  } finally { gate.resolve(); dispose() }
})
