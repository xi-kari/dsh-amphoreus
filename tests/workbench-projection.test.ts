import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProjectionIndex, projectableEvent, type HiddenStore } from '../src/host/workbench.ts'
import {
  ASSISTANT,
  COMPACT_CHECKPOINT,
  RUNTIME_CONTEXT,
  SKILL_INJECT,
  SYSTEM_REMINDER,
  SYSTEM_REMINDER_NO_SOURCE,
  TURN_END_ABORTED,
  TURN_END_COMPLETED,
  TURN_END_ERROR,
  TURN_END_INTERRUPTED,
  TURN_END_MAX_TOKENS,
  TURN_START,
  TOOL_CALL,
  TOOL_RESULT,
  USER_NO_SOURCE,
  USER_PLAIN,
} from './fixtures/session-events.ts'

const ROOT_EVENTS = [
  TURN_START,
  RUNTIME_CONTEXT,
  SKILL_INJECT,
  USER_PLAIN,
  TOOL_CALL,
  ASSISTANT,
  TOOL_RESULT,
  TURN_END_ERROR,
]

const CHILD_EVENTS = [
  { ...TURN_START, seq: 8, time: 4, data: { turn: 2 } },
  {
    ...USER_PLAIN,
    seq: 9,
    time: 5,
    data: {
      ...USER_PLAIN.data,
      id: 'child-user',
      content: [{ type: 'text', text: 'child question' }],
    },
  },
  {
    ...TOOL_CALL,
    seq: 10,
    time: 6,
    data: { ...TOOL_CALL.data, turn: 2, callId: 'call-child' },
  },
  {
    ...ASSISTANT,
    seq: 11,
    time: 7,
    data: {
      ...ASSISTANT.data,
      turn: 2,
      message: {
        ...ASSISTANT.data.message,
        id: 'child-assistant',
        content: [{ type: 'text', text: 'child answer' }],
      },
    },
  },
]

test('projects only ordinary user, assistant, and terminal error events', () => {
  assert.equal(projectableEvent(USER_PLAIN)?.kind, 'user')
  assert.equal(projectableEvent(USER_NO_SOURCE)?.kind, 'user')

  assert.equal(projectableEvent(SKILL_INJECT), null)
  assert.equal(projectableEvent(SYSTEM_REMINDER), null)
  assert.equal(projectableEvent(SYSTEM_REMINDER_NO_SOURCE), null)
  assert.equal(projectableEvent(RUNTIME_CONTEXT), null)
  assert.equal(projectableEvent(COMPACT_CHECKPOINT), null)

  assert.equal(projectableEvent(ASSISTANT)?.kind, 'assistant')
  assert.equal(projectableEvent(TURN_START), null)

  assert.equal(projectableEvent(TURN_END_ERROR)?.kind, 'error')
  assert.equal(projectableEvent(TURN_END_ABORTED)?.kind, 'error')
  assert.equal(projectableEvent(TURN_END_INTERRUPTED)?.kind, 'error')
  assert.equal(projectableEvent(TURN_END_COMPLETED), null)
  assert.equal(projectableEvent(TURN_END_MAX_TOKENS), null)
})

test('projection index keeps only stable seq structure and replays idempotently', () => {
  const index = new ProjectionIndex(new MemoryHiddenStore())
  const session = { id: 'session-a', events: ROOT_EVENTS }

  index.replay(session)
  assert.deepEqual(index.get('session-a')?.cards, [{
    turnIndex: 0,
    turn: 1,
    userSeq: 3,
    assistantSeq: 5,
    toolCallIds: ['call-1'],
    errorSeq: 7,
  }])

  index.replay(session)
  assert.equal(index.get('session-a')?.cards.length, 1)
  const updatedAt = index.get('session-a')?.updatedAt
  index.apply(session, [ASSISTANT])
  assert.equal(index.get('session-a')?.updatedAt, updatedAt)

  const serialized = JSON.stringify(index.list())
  for (const body of ['FIXTURE_SKILL_BODY', 'FIXTURE_ANSWER', 'FIXTURE_TOOL_RESULT', '帮我看看']) {
    assert.equal(serialized.includes(body), false)
  }
  index.flush()
})

test('cold and live fork replay use only own events and hide cascades to descendants', async () => {
  const hidden = new MemoryHiddenStore()
  const index = new ProjectionIndex(hidden)
  index.replay({ id: 'session-a', events: ROOT_EVENTS })

  index.replay({
    id: 'session-b',
    header: { parentSession: 'session-a' },
    inheritedEventCount: 8,
    events: [...ROOT_EVENTS, ...CHILD_EVENTS],
  })
  const coldCards = index.get('session-b')?.cards
  assert.deepEqual(coldCards, [{
    turnIndex: 0,
    turn: 2,
    userSeq: 9,
    assistantSeq: 11,
    toolCallIds: ['call-child'],
    errorSeq: null,
  }])
  assert.deepEqual(index.get('session-a')?.forks, [{ childSessionId: 'session-b', atSeq: 7 }])
  assert.equal(index.get('session-b')?.inheritedCount, 8)

  index.replay({
    id: 'session-c',
    header: { parentSession: 'session-a' },
    inheritedEventCount: 8,
    ownEvents: () => CHILD_EVENTS,
  })
  assert.deepEqual(index.get('session-c')?.cards, coldCards)

  const revision = index.revision
  const result = await index.hide('session-a')
  assert.equal(result.revision, revision + 1)
  assert.equal(index.list().length, 0)
  assert.equal(index.list(true).length, 3)
  assert.equal(index.list(true).every(session => session.hidden), true)
  assert.deepEqual(hidden.get(), ['session-a', 'session-b', 'session-c'])
})

test('projection index coalesces change notifications for 800ms', async () => {
  const index = new ProjectionIndex(new MemoryHiddenStore())
  const calls: readonly string[][] = []
  const mutableCalls = calls as string[][]
  const dispose = index.subscribe(sessionIds => mutableCalls.push([...sessionIds]))

  index.replay({ id: 'session-a', events: ROOT_EVENTS })
  await new Promise(resolve => setTimeout(resolve, 900))

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], ['session-a'])
  dispose()
})

class MemoryHiddenStore implements HiddenStore {
  #ids: string[] = []

  get(): readonly string[] {
    return this.#ids
  }

  async set(ids: readonly string[]): Promise<void> {
    this.#ids = [...ids]
  }
}
