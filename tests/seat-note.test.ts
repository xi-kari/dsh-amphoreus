import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { AmphoreusConfig } from '../src/host/config.ts'
import {
  appendSeatNote,
  createSeatMemoryReader,
  deleteSeatNote,
  effectiveMemorySettings,
  extractSeatNote,
  normalizeNoteText,
  patchSeatMemorySettings,
  registerSeatNoteObserver,
} from '../src/host/memory.ts'
import type { AmphoreusStores, BindingRecord, MemoryRecord } from '../src/host/store.ts'
import { fixtureConfig } from './fixture-suite.ts'

const SESSION_A = 'session-00000000-0000-4000-8000-00000000000a'
const SESSION_B = 'session-00000000-0000-4000-8000-00000000000b'
const RECEIPT = '晨星卡｜读取：common.md｜档位：标准'

class FakeTable<T> {
  readonly values = new Map<string, T>()
  putCalls = 0
  updateCalls = 0
  failNextPut: Error | undefined
  get(key: string): T | undefined { return this.values.get(key) }
  entries(): IterableIterator<[string, T]> { return new Map(this.values).entries() }
  async put(key: string, value: T): Promise<void> {
    this.putCalls++
    if (this.failNextPut !== undefined) {
      const failure = this.failNextPut
      this.failNextPut = undefined
      throw failure
    }
    this.values.set(key, structuredClone(value))
  }
  async update(key: string, transform: (current: T) => T): Promise<T> {
    this.updateCalls++
    const current = this.values.get(key)
    if (current === undefined) throw Object.assign(new Error(`missing-key: ${key}`), { code: 'missing-key' })
    const next = transform(current)
    this.values.set(key, structuredClone(next))
    return next
  }
  async delete(key: string): Promise<boolean> { return this.values.delete(key) }
}

type Listener = (...args: unknown[]) => unknown

class FakeContext {
  readonly warnings: string[] = []
  readonly logger = { warn: (message: string) => { this.warnings.push(message) } }
  readonly sessions: { list: () => FakeSession[] }
  readonly #listeners = new Map<string, Set<Listener>>()
  constructor(sessions: FakeSession[] = []) {
    this.sessions = { list: () => [...sessions] }
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
  listenerCount(name: string): number { return this.#listeners.get(name)?.size ?? 0 }
}

interface FakeSession {
  readonly id: string
  readonly events: SessionEvent[]
  ownEvents(): readonly SessionEvent[]
  snapshotEvents(): readonly SessionEvent[]
}

function session(id: string, events: SessionEvent[] = []): FakeSession {
  return { id, events, ownEvents: () => [...events], snapshotEvents: () => [...events] }
}

function assistant(seq: number, text: string, options: { turn?: number; interrupted?: boolean } = {}): SessionEvent {
  return {
    type: 'assistant/message', seq, time: 1_725_000_000_000 + seq,
    data: { turn: options.turn ?? 1, step: 1, message: { content: [{ type: 'text', text }] }, ...(options.interrupted === true ? { interrupted: true } : {}) },
  } as unknown as SessionEvent
}

function turnEnd(seq: number, kind: 'completed' | 'aborted' | 'error' = 'completed', turn = 1): SessionEvent {
  return { type: 'turn/end', seq, time: 1_725_000_000_000 + seq, data: { turn, reason: { kind } } } as unknown as SessionEvent
}

function binding(sessionId: string, skillName: string, patch: Partial<BindingRecord> = {}): BindingRecord {
  return { sessionId, skillName, boundAt: 1, source: 'seat-new', injection: { state: 'done' }, ...patch }
}

function fixture(options: { config?: AmphoreusConfig; sessions?: FakeSession[] } = {}) {
  const context = new FakeContext(options.sessions)
  const memory = new FakeTable<MemoryRecord>()
  const bindings = new FakeTable<BindingRecord>()
  const seats = new FakeTable<{ skillName: string; displayName: string; userDisplayName?: string }>()
  const stores = {
    main: {
      table: (name: string) => {
        if (name === 'memory') return memory
        if (name === 'bindings') return bindings
        if (name === 'seats') return seats
        throw new Error(`unexpected table: ${name}`)
      },
    },
  } as unknown as AmphoreusStores
  const config = options.config ?? fixtureConfig()
  return {
    context, memory, bindings, seats, stores, config,
    register: () => registerSeatNoteObserver(context as unknown as Context, { config, stores }),
    reader: () => createSeatMemoryReader({ config, stores, current: () => undefined }),
  }
}

test('extractSeatNote takes the note line before the receipt, ignores fenced examples and receipt-only tails', () => {
  assert.equal(extractSeatNote(`正文。\n\n留言：下次记得问开拓者的猫叫什么。\n${RECEIPT}`), '下次记得问开拓者的猫叫什么。')
  assert.equal(extractSeatNote('正文。\n留言: ascii colon works too\n'), 'ascii colon works too')
  assert.equal(extractSeatNote('正文。\n```\n留言：这是示例，不算。\n```\n' + RECEIPT), undefined)
  assert.equal(extractSeatNote(RECEIPT), undefined)
  assert.equal(extractSeatNote('留言：\n' + RECEIPT), undefined)
  // Only the trailing window counts: a note buried far above is not the seat's closing line.
  const far = ['留言：太早了', ...Array.from({ length: 8 }, (_, index) => `第 ${index} 行`)].join('\n')
  assert.equal(extractSeatNote(far), undefined)
  // <details>台账 wrapper is unwrapped like the observer does.
  assert.equal(extractSeatNote(`正文\n<details><summary>台账</summary>\n留言：包在台账里也算\n</details>`), '包在台账里也算')
})

test('normalizeNoteText flattens line breaks and clamps by code point to 200', () => {
  assert.equal(normalizeNoteText('  a\r\n  b  '), 'a b')
  const long = '好'.repeat(250)
  assert.equal([...normalizeNoteText(long)].length, 200)
  const emoji = '😀'.repeat(201)
  assert.equal([...normalizeNoteText(emoji)].length, 200)
})

test('appendSeatNote creates on first write, updates afterwards, dedupes by id and survives a lost put race', async () => {
  const table = new FakeTable<MemoryRecord>()
  const first = await appendSeatNote(table, 'amphoreus-testcard-a', { text: ' 一 ', author: 'user' }, 10)
  assert.equal(first?.text, '一')
  assert.equal(table.putCalls, 1)
  assert.equal(table.get('amphoreus-testcard-a')?.notes.length, 1)
  assert.equal(table.get('amphoreus-testcard-a')?.updatedAt, 10)

  const second = await appendSeatNote(table, 'amphoreus-testcard-a', { text: '二', author: 'seat', id: 'fixed', sessionId: SESSION_A, seq: 7 }, 20)
  assert.deepEqual(second, { id: 'fixed', text: '二', createdAt: 20, author: 'seat', sessionId: SESSION_A, seq: 7 })
  assert.equal(table.updateCalls, 1)
  const again = await appendSeatNote(table, 'amphoreus-testcard-a', { text: '二（改）', author: 'seat', id: 'fixed' }, 30)
  assert.equal(again?.text, '二')
  assert.equal(table.get('amphoreus-testcard-a')?.notes.length, 2)
  assert.equal(table.updateCalls, 1, 'duplicate id must not write')

  assert.equal(await appendSeatNote(table, 'amphoreus-testcard-a', { text: '   ', author: 'user' }), undefined)

  // put fails because another writer created the record in between → fall through to update.
  const racy = new FakeTable<MemoryRecord>()
  racy.failNextPut = new Error('exists')
  const original = racy.put.bind(racy)
  racy.put = async (key, value) => {
    racy.values.set(key, { skillName: key, notes: [], pinnedSessionIds: [], updatedAt: 0 })
    await original(key, value)
  }
  const raced = await appendSeatNote(racy, 'amphoreus-testcard-b', { text: '三', author: 'user' })
  assert.equal(raced?.text, '三')
  assert.equal(racy.get('amphoreus-testcard-b')?.notes.length, 1)
  assert.equal(racy.updateCalls, 1)
})

test('deleteSeatNote and patchSeatMemorySettings are partial and create-on-demand', async () => {
  const table = new FakeTable<MemoryRecord>()
  assert.equal(await deleteSeatNote(table, 'amphoreus-testcard-a', 'nope'), false)
  await appendSeatNote(table, 'amphoreus-testcard-a', { text: '一', author: 'user', id: 'n1' })
  await appendSeatNote(table, 'amphoreus-testcard-a', { text: '二', author: 'user', id: 'n2' })
  assert.equal(await deleteSeatNote(table, 'amphoreus-testcard-a', 'n1'), true)
  assert.deepEqual(table.get('amphoreus-testcard-a')?.notes.map(note => note.id), ['n2'])
  assert.equal(await deleteSeatNote(table, 'amphoreus-testcard-a', 'n1'), false)

  const created = await patchSeatMemorySettings(table, 'amphoreus-testcard-b', { inject: false }, 5)
  assert.deepEqual(created, { skillName: 'amphoreus-testcard-b', notes: [], pinnedSessionIds: [], updatedAt: 5, settings: { inject: false } })
  const merged = await patchSeatMemorySettings(table, 'amphoreus-testcard-b', { injectLimit: 3 }, 6)
  assert.deepEqual(merged.settings, { inject: false, injectLimit: 3 })
  assert.deepEqual(effectiveMemorySettings(fixtureConfig(), merged), { inject: false, autoNote: true, injectLimit: 3 })
  assert.deepEqual(effectiveMemorySettings(fixtureConfig(), undefined), { inject: true, autoNote: true, injectLimit: 8 })
})

test('a completed turn whose final message carries a note line stores one seat-authored note keyed by seq', async () => {
  const fixture = fixture_()
  fixture.bindings.values.set(SESSION_A, binding(SESSION_A, 'amphoreus-testcard-a'))
  const live = session(SESSION_A)
  const dispose = fixture.register()
  live.events.push(assistant(3, '先想一想。', {}), assistant(5, `好的。\n留言：开拓者喜欢在雨天聊天。\n${RECEIPT}`), turnEnd(6))
  fixture.context.emit('session/event', live, live.events[2])
  await dispose()
  const record = fixture.memory.get('amphoreus-testcard-a')
  assert.equal(record?.notes.length, 1)
  assert.deepEqual({ ...record!.notes[0], createdAt: 0 }, {
    id: `${SESSION_A}:5:note`, text: '开拓者喜欢在雨天聊天。', createdAt: 0, author: 'seat', sessionId: SESSION_A, seq: 5,
  })
  assert.deepEqual(fixture.context.warnings, [])
})

test('interrupted final message falls back to nothing; aborted turns, unbound sessions and disabled autoNote record nothing', async () => {
  const fixture = fixture_()
  fixture.bindings.values.set(SESSION_A, binding(SESSION_A, 'amphoreus-testcard-a'))
  const dispose = fixture.register()

  const aborted = session(SESSION_A, [assistant(1, '留言：不该被记。'), turnEnd(2, 'aborted')])
  fixture.context.emit('session/event', aborted, aborted.events[1])

  const interrupted = session(SESSION_A, [assistant(1, '留言：被打断的前缀', { interrupted: true }), turnEnd(2)])
  fixture.context.emit('session/event', interrupted, interrupted.events[1])

  const unbound = session(SESSION_B, [assistant(1, '留言：没有席位'), turnEnd(2)])
  fixture.context.emit('session/event', unbound, unbound.events[1])

  // Per-seat autoNote off wins over the config default.
  fixture.memory.values.set('amphoreus-testcard-a', { skillName: 'amphoreus-testcard-a', notes: [], pinnedSessionIds: [], settings: { autoNote: false }, updatedAt: 0 })
  const disabled = session(SESSION_A, [assistant(1, '留言：已关闭'), turnEnd(2)])
  fixture.context.emit('session/event', disabled, disabled.events[1])
  await dispose()
  assert.equal(fixture.memory.get('amphoreus-testcard-a')?.notes.length, 0)
  assert.equal(fixture.memory.get('amphoreus-testcard-b'), undefined)
})

test('only the matching turn is inspected and the text is clamped to 200 code points', async () => {
  const fixture = fixture_()
  fixture.bindings.values.set(SESSION_A, binding(SESSION_A, 'amphoreus-testcard-a'))
  const dispose = fixture.register()
  const live = session(SESSION_A, [
    assistant(1, '留言：上一回合的旧留言', { turn: 1 }), turnEnd(2, 'completed', 1),
    assistant(3, `留言：${'长'.repeat(260)}`, { turn: 2 }), turnEnd(4, 'completed', 2),
    assistant(5, '没有留言的一回合', { turn: 3 }), turnEnd(6, 'completed', 3),
  ])
  fixture.context.emit('session/event', live, live.events[3])
  fixture.context.emit('session/event', live, live.events[5])
  await dispose()
  const notes = fixture.memory.get('amphoreus-testcard-a')?.notes ?? []
  assert.equal(notes.length, 1)
  assert.equal(notes[0]?.seq, 3)
  assert.equal([...notes[0]!.text].length, 200)
})

test('startup and session/created replay ownEvents idempotently and disposal unhooks both listeners', async () => {
  const restored = session(SESSION_A, [assistant(1, `留言：重放一次\n${RECEIPT}`), turnEnd(2)])
  const fixture = fixture_({ sessions: [restored] })
  fixture.bindings.values.set(SESSION_A, binding(SESSION_A, 'amphoreus-testcard-a'))
  const dispose = fixture.register()
  assert.equal(fixture.context.listenerCount('session/event'), 1)
  assert.equal(fixture.context.listenerCount('session/created'), 1)
  fixture.context.emit('session/created', restored)
  fixture.context.emit('session/event', restored, restored.events[1])
  await dispose()
  assert.equal(fixture.memory.get('amphoreus-testcard-a')?.notes.length, 1)
  assert.equal(fixture.memory.putCalls + fixture.memory.updateCalls, 1)
  assert.equal(fixture.context.listenerCount('session/event'), 0)
  assert.equal(fixture.context.listenerCount('session/created'), 0)
  fixture.context.emit('session/event', restored, turnEnd(9))
  await dispose()
  assert.equal(fixture.memory.get('amphoreus-testcard-a')?.notes.length, 1)
})

test('a failed write is warned and the serialized queue keeps going', async () => {
  const fixture = fixture_()
  fixture.bindings.values.set(SESSION_A, binding(SESSION_A, 'amphoreus-testcard-a'))
  fixture.memory.failNextPut = new Error('durability failed')
  const dispose = fixture.register()
  const first = session(SESSION_A, [assistant(1, '留言：一'), turnEnd(2)])
  const second = session(SESSION_A, [assistant(3, '留言：二'), turnEnd(4)])
  fixture.context.emit('session/event', first, first.events[1])
  fixture.context.emit('session/event', second, second.events[1])
  await dispose()
  assert.equal(fixture.context.warnings.length, 1)
  assert.match(fixture.context.warnings[0]!, /durability failed/)
  assert.deepEqual(fixture.memory.get('amphoreus-testcard-a')?.notes.map(note => note.text), ['二'])
})

test('reader honours inject/limit/autoNote and adds handoff notes only across a different bound seat', () => {
  const fixture = fixture_()
  const record = (skill: string, texts: string[], settings?: MemoryRecord['settings']): MemoryRecord => ({
    skillName: skill, pinnedSessionIds: [], updatedAt: 0,
    notes: texts.map((text, index) => ({ id: `${skill}-${index}`, text, createdAt: index, author: index % 2 === 0 ? 'seat' : 'user' })),
    ...(settings === undefined ? {} : { settings }),
  })
  fixture.memory.values.set('amphoreus-testcard-a', record('amphoreus-testcard-a', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10']))
  fixture.memory.values.set('amphoreus-testcard-b', record('amphoreus-testcard-b', ['b1', 'b2', 'b3', 'b4']))
  fixture.seats.values.set('amphoreus-testcard-b', { skillName: 'amphoreus-testcard-b', displayName: '暮星', userDisplayName: '暮星·改' })
  fixture.bindings.values.set(SESSION_B, binding(SESSION_B, 'amphoreus-testcard-b'))
  const read = fixture.reader()

  const own = read(binding(SESSION_A, 'amphoreus-testcard-a'))
  assert.deepEqual(own?.notes.map(note => note.text), ['a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10'])
  assert.equal(own?.notes[0]?.author, 'seat')
  assert.equal(own?.autoNote, true)
  assert.equal(own?.handoff, undefined)

  const handed = read(binding(SESSION_A, 'amphoreus-testcard-a', { handoffFrom: { sessionId: SESSION_B, seq: 3 } }))
  assert.equal(handed?.handoff?.sourceDisplayName, '暮星·改')
  assert.deepEqual(handed?.handoff?.notes.map(note => note.text), ['b2', 'b3', 'b4'])

  // Same seat across the edge (handoff-fork to itself) or an unbound source adds nothing.
  fixture.bindings.values.set(SESSION_B, binding(SESSION_B, 'amphoreus-testcard-a'))
  assert.equal(read(binding(SESSION_A, 'amphoreus-testcard-a', { handoffFrom: { sessionId: SESSION_B, seq: 3 } }))?.handoff, undefined)
  assert.equal(read(binding(SESSION_A, 'amphoreus-testcard-a', { handoffFrom: { sessionId: 'session-missing', seq: 0 } }))?.handoff, undefined)

  // inject off → no notes but the autoNote instruction still stands; both off → undefined (nothing to add).
  fixture.memory.values.set('amphoreus-testcard-a', record('amphoreus-testcard-a', ['a1'], { inject: false }))
  assert.deepEqual(read(binding(SESSION_A, 'amphoreus-testcard-a')), { notes: [], autoNote: true })
  fixture.memory.values.set('amphoreus-testcard-a', record('amphoreus-testcard-a', ['a1'], { inject: false, autoNote: false }))
  assert.equal(read(binding(SESSION_A, 'amphoreus-testcard-a')), undefined)
  fixture.memory.values.set('amphoreus-testcard-a', record('amphoreus-testcard-a', ['a1', 'a2'], { injectLimit: 1 }))
  assert.deepEqual(read(binding(SESSION_A, 'amphoreus-testcard-a'))?.notes.map(note => note.text), ['a2'])
  fixture.memory.values.set('amphoreus-testcard-a', record('amphoreus-testcard-a', ['a1'], { injectLimit: 0 }))
  assert.deepEqual(read(binding(SESSION_A, 'amphoreus-testcard-a'))?.notes, [])
})

const fixture_ = fixture
