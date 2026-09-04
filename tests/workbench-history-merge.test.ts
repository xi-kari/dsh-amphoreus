import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

interface WorkbenchProbe {
  state: {
    historyBySession: Map<string, Message[]>
    historyCompleteBySession: Map<string, boolean>
    pendingReplies: Map<string, { text: string; at: number }>
    liveReplies: Map<string, { running: boolean; text: string }>
  }
  persistedMessagesFor(thread: Thread): Message[]
  settlePendingReply(thread: Thread, messages: Message[]): boolean
}

interface Message {
  kind: 'user' | 'assistant' | 'error'
  text: string
  sourceSeq: number
  at: number
  placeholder?: boolean
}

interface Thread {
  dshSessionId: string
  cards: Array<{
    turn: number
    userSeq: number
    assistantSeq: number | null
    errorSeq: number | null
    toolCallIds: string[]
  }>
}

function workbenchProbe(): WorkbenchProbe {
  const source = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')
  const prefix = source.slice(0, source.indexOf('\nfunction inlineMarkdown'))
  const storage = new Map<string, string>()
  const app = { querySelector: () => null, querySelectorAll: () => [] }
  const context = {
    console,
    history: {},
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    document: { querySelector: (selector: string) => selector === '#app' ? app : null, activeElement: null },
    window: { parent: null as unknown, location: { origin: 'http://localhost' }, setTimeout, clearTimeout },
    globalThis: {} as Record<string, unknown>,
    crypto,
  }
  context.window.parent = context.window
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${prefix}\nglobalThis.__probe = { state, persistedMessagesFor, settlePendingReply }`, context)
  return context.globalThis.__probe as WorkbenchProbe
}

const card = (userSeq: number, assistantSeq: number) => ({
  turn: userSeq,
  userSeq,
  assistantSeq,
  errorSeq: null,
  toolCallIds: [],
})

test('incomplete feeds merge real history over the latest index placeholders', () => {
  const probe = workbenchProbe()
  const thread: Thread = { dshSessionId: 'session-a', cards: [card(1, 2), card(3, 4)] }
  const history: Message[] = [
    { kind: 'user', text: 'real question', sourceSeq: 3, at: 30 },
    { kind: 'assistant', text: 'real answer', sourceSeq: 4, at: 40 },
    { kind: 'error', text: 'extra terminal', sourceSeq: 5, at: 50 },
  ]
  probe.state.historyBySession.set(thread.dshSessionId, history)
  probe.state.historyCompleteBySession.set(thread.dshSessionId, false)

  const first = probe.persistedMessagesFor(thread)
  assert.deepEqual(Array.from(first, message => message.sourceSeq), [1, 2, 3, 4, 5])
  assert.equal(first.find(message => message.sourceSeq === 3)?.text, 'real question')
  assert.equal(first.find(message => message.sourceSeq === 3)?.placeholder, undefined)

  thread.cards.push(card(6, 7))
  assert.deepEqual(Array.from(probe.persistedMessagesFor(thread), message => message.sourceSeq), [1, 2, 3, 4, 5, 6, 7])

  probe.state.historyCompleteBySession.set(thread.dshSessionId, true)
  assert.deepEqual(probe.persistedMessagesFor(thread), history)
})

test('a terminal error settles a matching pending reply', () => {
  const probe = workbenchProbe()
  const thread: Thread = { dshSessionId: 'session-error', cards: [] }
  probe.state.pendingReplies.set(thread.dshSessionId, { text: 'question', at: 1_000 })
  probe.state.liveReplies.set(thread.dshSessionId, { running: true, text: 'partial' })
  const messages: Message[] = [
    { kind: 'user', text: 'question', sourceSeq: 10, at: 1_000 },
    { kind: 'error', text: 'failed', sourceSeq: 11, at: 1_001 },
  ]

  assert.equal(probe.settlePendingReply(thread, messages), true)
  assert.equal(probe.state.pendingReplies.has(thread.dshSessionId), false)
  assert.equal(probe.state.liveReplies.has(thread.dshSessionId), false)
})
