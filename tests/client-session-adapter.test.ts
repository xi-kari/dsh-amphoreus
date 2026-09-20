import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ISessions, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSessionAdapter, currentSessionId, selectedSessionList } from '../src/client/session-adapter.ts'

const ANAXA = 'session-anaxa' as SessionId
const AGLAEA = 'session-aglaea' as SessionId
const BACKGROUND = 'session-background' as SessionId
type Summary = SessionListState['byId'][SessionId]

function row(id: SessionId, retainedBy: Summary['retainedBy'] = {}): Summary {
  return { id, displayTitle: id, running: false, blank: false, updatedAt: 1, retainedBy }
}

function catalog(...rows: Summary[]): SessionListState {
  return {
    ids: rows.map(item => item.id),
    byId: Object.fromEntries(rows.map(item => [item.id, item])),
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
  }
}

function source(initial: SessionListState) {
  let current = initial
  const listeners = new Set<() => void>()
  const observable: ObservableSnapshot<SessionListState> = {
    getSnapshot: () => current,
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  return {
    observable,
    listeners,
    publish: (next: SessionListState) => {
      current = next
      for (const listener of listeners) listener()
    },
  }
}

function host(overrides: Partial<Pick<ISessions, 'list' | 'create' | 'fork' | 'binding' | 'retain'>> = {}) {
  const raw = {
    list: source(catalog()).observable,
    create: async () => ANAXA,
    fork: async () => AGLAEA,
    binding: () => undefined,
    retain: () => { assert.fail('implicit retention is forbidden') },
    ...overrides,
  } satisfies Pick<ISessions, 'list' | 'create' | 'fork' | 'binding' | 'retain'>
  return { raw, sessions: raw as ISessions }
}

test('the current seat comes from mainView ownership when the official list has no current field', () => {
  const original = Object.freeze(catalog(row(AGLAEA), row(ANAXA, { mainView: 1 })))
  assert.equal(Object.hasOwn(original, 'current'), false)
  assert.equal(currentSessionId(original), ANAXA)
  const { sessions } = host({ list: source(original).observable })
  const adapter = createSessionAdapter(sessions, { openSession: () => {} })
  const selected = adapter.list.getSnapshot()
  assert.equal(selected.current, ANAXA)
  assert.equal(selected.byId[selected.current!]?.id, ANAXA)
  assert.strictEqual(selected.ids, original.ids)
  assert.strictEqual(selected.byId, original.byId)
  assert.equal(Object.hasOwn(original, 'current'), false, 'selection must not mutate the official snapshot')
})

test('switching mainView and archiving its selection clears current even if a background reference remains', () => {
  const store = source(catalog(row(ANAXA, { mainView: 1 }), row(AGLAEA)))
  const selected = selectedSessionList(store.observable)
  assert.equal(selected.getSnapshot().current, ANAXA)
  store.publish(catalog(row(ANAXA, { amphoreusOperation: 1 }), row(AGLAEA, { mainView: 1 })))
  assert.equal(selected.getSnapshot().current, AGLAEA)
  store.publish(catalog(row(ANAXA, { amphoreusOperation: 1 }), row(AGLAEA, { amphoreusWorkbench: 1 })))
  assert.equal(selected.getSnapshot().current, undefined)
  store.publish(catalog(row(ANAXA, { amphoreusOperation: 1 })))
  assert.equal(selected.getSnapshot().current, undefined)
})

test('background operation or workbench references never steal selection, including without a main view', () => {
  const active = catalog(
    row(BACKGROUND, { amphoreusOperation: 3, amphoreusWorkbench: 2 }),
    row(ANAXA, { mainView: 1 }),
    row(AGLAEA, { mainView: 0, amphoreusOperation: 1 }),
  )
  assert.equal(currentSessionId(active), ANAXA)
  assert.equal(currentSessionId(catalog(
    row(BACKGROUND, { amphoreusOperation: 3 }),
    row(AGLAEA, { mainView: 0, amphoreusWorkbench: 1 }),
  )), undefined)
  assert.equal(currentSessionId(catalog()), undefined)
})

test('selected snapshots remain stable until the source changes and subscriptions detach from the source', () => {
  const initial = catalog(row(ANAXA, { mainView: 1 }))
  const store = source(initial)
  const selected = selectedSessionList(store.observable)
  const first = selected.getSnapshot()
  assert.strictEqual(selected.getSnapshot(), first)
  const observed: Array<ReturnType<typeof selected.getSnapshot>> = []
  const unsubscribe = selected.subscribe(() => { observed.push(selected.getSnapshot()) })
  assert.equal(store.listeners.size, 1)
  store.publish(initial)
  assert.strictEqual(observed[0], first)
  store.publish(catalog(row(AGLAEA, { mainView: 1 })))
  const second = selected.getSnapshot()
  assert.notStrictEqual(second, first)
  assert.equal(second.current, AGLAEA)
  assert.strictEqual(selected.getSnapshot(), second)
  assert.deepEqual(observed, [first, second])
  unsubscribe()
  assert.equal(store.listeners.size, 0)
  store.publish(catalog())
  assert.equal(observed.length, 2)
  assert.equal(selected.getSnapshot().current, undefined)
})

test('open delegates to workspace navigation when sessions has no open method', () => {
  const { raw, sessions } = host()
  assert.equal(Object.hasOwn(raw, 'open'), false)
  const opened: unknown[] = []
  const navigation = {
    openSession(target: unknown) {
      assert.strictEqual(this, navigation)
      opened.push(target)
    },
  }
  const adapter = createSessionAdapter(sessions, navigation)
  adapter.open(ANAXA)
  adapter.open(AGLAEA)
  assert.deepEqual(opened, [ANAXA, AGLAEA])
})

test('a catalogued session without a retained generation has no binding and lookup does not retain', () => {
  const borrowed: SessionId[] = []
  const { sessions } = host({
    list: source(catalog(row(ANAXA))).observable,
    binding: id => { borrowed.push(id); return undefined },
  })
  const adapter = createSessionAdapter(sessions, { openSession: () => { assert.fail('lookup must not navigate') } })
  assert.ok(adapter.list.getSnapshot().byId[ANAXA])
  assert.equal(adapter.binding(ANAXA), undefined)
  assert.deepEqual(borrowed, [ANAXA])
})

test('create and fork forward catalog operations without retaining, borrowing, or navigating', async () => {
  const created: unknown[] = []
  const forked: unknown[] = []
  const { sessions } = host({
    create: async options => { created.push(options); return ANAXA },
    fork: async options => { forked.push(options); return AGLAEA },
    binding: () => { assert.fail('catalog creation must not borrow a binding') },
  })
  const adapter = createSessionAdapter(sessions, { openSession: () => { assert.fail('catalog creation must not navigate') } })
  assert.equal(await adapter.create({ workspaceId: 'workspace-one', sessionId: ANAXA }), ANAXA)
  assert.equal(await adapter.create({ cwd: 'D:/fixture' }), ANAXA)
  assert.equal(await adapter.create({}), ANAXA)
  assert.equal(await adapter.fork({ sessionId: ANAXA, atSeq: 12, increaseTitle: false }), AGLAEA)
  assert.deepEqual(created, [
    { workspaceId: 'workspace-one', sessionId: ANAXA },
    { cwd: 'D:/fixture' },
    {},
  ])
  assert.deepEqual(forked, [{ sessionId: ANAXA, atSeq: 12, increaseTitle: false }])
  assert.equal(adapter.list.getSnapshot().current, undefined)
})
