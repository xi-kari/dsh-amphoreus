import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionFollowFrame, SessionHistoryRecord } from '@deepseek-ai/dsh-api-session-controller/types'
import type { AmphoreusState } from '../src/shared/api.ts'
import {
  conferenceTargets,
  startConference,
  type ConferenceProgress,
  type ConferenceTarget,
} from '../src/client/conference.ts'

class MutableSnapshot<T> {
  #listeners = new Set<() => void>()
  private value: T
  constructor(value: T) { this.value = value }
  getSnapshot(): T { return this.value }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
  set(value: T): void {
    this.value = value
    for (const listener of this.#listeners) listener()
  }
}

function emptyChat(): ChatSnapshot {
  return {
    nodes: new Map(),
    legacy: { nodes: [], partial: { blocks: [] } },
  } as unknown as ChatSnapshot
}

function answeredChat(text: string): ChatSnapshot {
  return {
    nodes: new Map(),
    legacy: {
      nodes: [{
        kind: 'assistant',
        seq: 2,
        time: 2,
        turn: 0,
        step: 0,
        blocks: [{ kind: 'text', text }],
      }],
      partial: { blocks: [] },
    },
  } as unknown as ChatSnapshot
}

function failedChat(message: string): ChatSnapshot {
  const chat = answeredChat('角色的部分回答')
  return {
    ...chat,
    legacy: {
      ...chat.legacy,
      nodes: [...chat.legacy.nodes, { kind: 'turn-error', seq: 3, time: 3, turn: 0, step: 0, message }],
    },
  } as unknown as ChatSnapshot
}

function journalEvent(type: string, data: unknown): SessionHistoryRecord & SessionFollowFrame {
  return { type: 'event', event: { type, data, seq: 1, time: 1 } } as unknown as SessionHistoryRecord & SessionFollowFrame
}

function journalSnapshot(records: SessionHistoryRecord[]): SessionFollowFrame {
  return { type: 'snapshot', records, hasMore: false } as unknown as SessionFollowFrame
}

const target = (index: number): ConferenceTarget => ({
  skillName: `amphoreus-role-${index}`,
  displayName: `角色 ${index}`,
})

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error('condition was not reached')
}

test('conferenceTargets uses only the trusted deployed snapshot, sorts it, and deduplicates skills', () => {
  const state = {
    seats: [
      { skillName: 'amphoreus-b', displayName: 'B', status: 'deployed', order: 4, userOrder: 1 },
      { skillName: 'amphoreus-a', displayName: 'A', userDisplayName: 'A+', status: 'deployed', order: 0 },
      { skillName: 'amphoreus-b', displayName: 'B duplicate', status: 'deployed', order: 2 },
      { skillName: 'amphoreus-missing', displayName: 'Missing', status: 'undeployed', order: 3 },
      { skillName: 'amphoreus-hidden', displayName: 'Hidden', status: 'deployed', hidden: true, order: 5 },
    ],
  } as unknown as Pick<AmphoreusState, 'seats'>

  assert.deepEqual(conferenceTargets(state), [
    { skillName: 'amphoreus-a', displayName: 'A+' },
    { skillName: 'amphoreus-b', displayName: 'B' },
  ])
})

test('startConference sends one identical prompt per target, keeps at most three active, and emits visible final replies', async () => {
  const feeds = new Map<string, MutableSnapshot<ChatSnapshot | undefined>>()
  const faces = new Map<string, MutableSnapshot<{ running: boolean; hasMore: boolean }>>()
  const calls: Array<{ target: ConferenceTarget; text: string; id: string }> = []
  const progress: ConferenceProgress[] = []
  const active = new Set<string>()
  let maxActive = 0

  const run = startConference({
    concurrency: 3,
    createId: () => 'conference-fixed',
    dispatch: async (seat, text) => {
      const id = `session-${seat.skillName}`
      calls.push({ target: seat, text, id })
      feeds.set(id, new MutableSnapshot(emptyChat()))
      faces.set(id, new MutableSnapshot({ running: true, hasMore: false }))
      active.add(id)
      maxActive = Math.max(maxActive, active.size)
      return id
    },
    conversationFeed: id => feeds.get(id),
    sessionFace: id => faces.get(id),
    emit: event => progress.push(event),
    replyTimeoutMs: 5_000,
  }, {
    text: '  你是谁？  ',
    targets: [1, 2, 3, 4, 5].map(target),
  })

  await until(() => calls.length === 3)
  assert.equal(maxActive, 3)
  assert.deepEqual(calls.map(call => call.text), ['你是谁？', '你是谁？', '你是谁？'])

  const complete = (call: typeof calls[number]): void => {
    active.delete(call.id)
    feeds.get(call.id)?.set(answeredChat(`${call.target.displayName} 的回答`))
    faces.get(call.id)?.set({ running: false, hasMore: false })
  }

  complete(calls[0]!)
  await until(() => calls.length === 4)
  complete(calls[1]!)
  await until(() => calls.length === 5)
  for (const call of calls.slice(2)) complete(call)
  await run.completed

  assert.equal(run.conferenceId, 'conference-fixed')
  assert.equal(maxActive, 3)
  assert.equal(calls.length, 5)
  assert.equal(new Set(calls.map(call => call.target.skillName)).size, 5)
  assert.deepEqual(calls.map(call => call.text), Array(5).fill('你是谁？'))
  assert.deepEqual(
    progress.filter(event => event.phase === 'done').map(event => event.text).sort(),
    [1, 2, 3, 4, 5].map(index => `角色 ${index} 的回答`).sort(),
  )
  assert.equal(progress.some(event => event.phase === 'failed'), false)
})

test('startConference reports one target failure without suppressing successful seats', async () => {
  const feeds = new Map<string, MutableSnapshot<ChatSnapshot | undefined>>()
  const faces = new Map<string, MutableSnapshot<{ running: boolean; hasMore: boolean }>>()
  const progress: ConferenceProgress[] = []
  const targets = [1, 2, 3].map(target)

  const run = startConference({
    createId: () => 'conference-partial',
    dispatch: async seat => {
      if (seat.skillName.endsWith('-2')) throw new Error('席位队列拒绝')
      const id = `session-${seat.skillName}`
      feeds.set(id, new MutableSnapshot(answeredChat(`${seat.displayName} 完成`)))
      faces.set(id, new MutableSnapshot({ running: false, hasMore: false }))
      return id
    },
    conversationFeed: id => feeds.get(id),
    sessionFace: id => faces.get(id),
    emit: event => progress.push(event),
  }, { text: '共同回答', targets })

  await run.completed

  const terminal = progress
    .filter(event => event.phase === 'done' || event.phase === 'failed')
    .sort((left, right) => left.skillName.localeCompare(right.skillName))
  assert.deepEqual(terminal.map(event => [event.skillName, event.phase, event.error ?? event.text]), [
    ['amphoreus-role-1', 'done', '角色 1 完成'],
    ['amphoreus-role-2', 'failed', '席位队列拒绝'],
    ['amphoreus-role-3', 'done', '角色 3 完成'],
  ])
})

test('an unopened background session waits for durable success and preserves text beyond the outline preview', async () => {
  const feed = new MutableSnapshot<ChatSnapshot | undefined>(emptyChat())
  const staleFace = new MutableSnapshot({ running: true, hasMore: false })
  const sessionList = new MutableSnapshot({
    byId: {} as Record<string, {
      running: boolean
      completed?: boolean
      projectionValues?: { turnOutline?: { response: string }[] }
    } | undefined>,
  })
  const progress: ConferenceProgress[] = []
  const targetSeat = target(1)
  const fullReply = `角色 1 的完整后台回复：${'我会先核实，再执行。'.repeat(45)}`
  let finishTurn!: () => void
  const turnEnd = new Promise<void>(resolve => { finishTurn = resolve })
  const run = startConference({
    dispatch: async () => {
      sessionList.set({ byId: { 'session-background': { running: true } } })
      return 'session-background'
    },
    conversationFeed: () => feed,
    sessionFace: () => staleFace,
    sessionList,
    followSession: async function * () {
      yield journalSnapshot([
        journalEvent('turn/start', { turn: 1 }),
        journalEvent('assistant/message', { message: { content: [{ type: 'text', text: fullReply }] } }),
      ])
      await turnEnd
      yield journalEvent('turn/end', { turn: 1, reason: { kind: 'completed' } })
    },
    emit: event => progress.push(event),
  }, { text: '背景会议', targets: [targetSeat] })

  await until(() => progress.some(event => event.phase === 'running'))
  sessionList.set({
    byId: {
      'session-background': { running: false, completed: true },
    },
  })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(progress.some(event => event.phase === 'failed'), false)
  sessionList.set({
    byId: {
      'session-background': {
        running: false,
        completed: true,
        projectionValues: { turnOutline: [{ response: `${fullReply.slice(0, 119)}…` }] },
      },
    },
  })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(progress.some(event => event.phase === 'done'), false)
  finishTurn()
  await run.completed

  assert.deepEqual(
    progress.filter(event => event.phase === 'done').map(event => event.text),
    [fullReply],
  )
})

test('background turn errors take precedence over partial text and allow the next seat to run', async () => {
  const progress: ConferenceProgress[] = []
  const run = startConference({
    concurrency: 1,
    dispatch: async seat => seat.skillName,
    conversationFeed: () => undefined,
    sessionFace: () => undefined,
    followSession: async function * (sessionId) {
      yield journalSnapshot([
        journalEvent('turn/start', { turn: 1 }),
        journalEvent('assistant/message', { message: { content: [{ type: 'text', text: '尚未完成的部分回答' }] } }),
        journalEvent('turn/end', {
          turn: 1,
          reason: sessionId.endsWith('-1')
            ? { kind: 'error', error: { code: 'UNKNOWN', message: '模型调用中断' } }
            : { kind: 'completed' },
        }),
      ])
    },
    emit: event => progress.push(event),
  }, { text: '共同回答', targets: [target(1), target(2)] })

  await run.completed
  assert.deepEqual(progress.filter(event => event.phase === 'done' || event.phase === 'failed').map(event => [event.phase, event.error ?? event.text]), [
    ['failed', '模型调用中断'],
    ['done', '尚未完成的部分回答'],
  ])
})

test('non-success terminal reasons never become successful conference replies', async () => {
  for (const reason of ['aborted', 'blocked', 'max-tokens', 'interrupted']) {
    const progress: ConferenceProgress[] = []
    const run = startConference({
      dispatch: async () => 'session-ended',
      conversationFeed: () => undefined,
      sessionFace: () => undefined,
      followSession: async function * () {
        yield journalSnapshot([
          journalEvent('assistant/message', { message: { content: [{ type: 'text', text: '部分回答' }] } }),
          journalEvent('turn/end', { turn: 1, reason: { kind: reason } }),
        ])
      },
      emit: event => progress.push(event),
    }, { text: '共同回答', targets: [target(1)] })
    await run.completed
    assert.equal(progress.some(event => event.phase === 'done'), false, reason)
    assert.equal(progress.filter(event => event.phase === 'failed').length, 1, reason)
  }
})

test('a completed turn without assistant text reports an explicit failure', async () => {
  const progress: ConferenceProgress[] = []
  const run = startConference({
    dispatch: async () => 'session-empty',
    conversationFeed: () => undefined,
    sessionFace: () => undefined,
    followSession: async function * () {
      yield journalSnapshot([
        journalEvent('turn/start', { turn: 1 }),
        journalEvent('turn/end', { turn: 1, reason: { kind: 'completed' } }),
      ])
    },
    emit: event => progress.push(event),
  }, { text: '共同回答', targets: [target(1)] })
  await run.completed
  assert.deepEqual(progress.filter(event => event.phase === 'failed').map(event => event.error), ['角色已结束本轮，但没有文字回复'])
  assert.equal(progress.some(event => event.phase === 'done'), false)
})

test('cancelling a pending journal aborts and closes its iterator without publishing a later reply', async () => {
  const progress: ConferenceProgress[] = []
  let started = false
  let closed = false
  let journalSignal: AbortSignal | undefined
  const run = startConference({
    dispatch: async () => 'session-following',
    conversationFeed: () => undefined,
    sessionFace: () => undefined,
    followSession: async function * (_sessionId, signal) {
      journalSignal = signal
      started = true
      try {
        yield journalSnapshot([journalEvent('turn/start', { turn: 1 })])
        await new Promise<void>((_resolve, reject) => {
          if (signal.aborted) reject(signal.reason)
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      } finally {
        closed = true
      }
    },
    emit: event => progress.push(event),
  }, { text: '共同回答', targets: [target(1)] })
  await until(() => started)
  run.cancel()
  await run.completed
  await until(() => closed)
  assert.equal(journalSignal?.aborted, true)
  assert.equal(progress.some(event => event.phase === 'done'), false)
  assert.deepEqual(progress.filter(event => event.phase === 'failed').map(event => event.error), ['会议已取消'])
})

test('a journal timeout aborts its iterator and reports the timeout reason', async () => {
  const progress: ConferenceProgress[] = []
  let closed = false
  const run = startConference({
    dispatch: async () => 'session-timeout',
    conversationFeed: () => undefined,
    sessionFace: () => undefined,
    replyTimeoutMs: 5,
    followSession: async function * (_sessionId, signal) {
      try {
        yield journalSnapshot([journalEvent('turn/start', { turn: 1 })])
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('transport aborted')), { once: true })
        })
      } finally {
        closed = true
      }
    },
    emit: event => progress.push(event),
  }, { text: '共同回答', targets: [target(1)] })
  await run.completed
  assert.equal(closed, true)
  assert.deepEqual(progress.filter(event => event.phase === 'failed').map(event => event.error), ['等待角色回复超时'])
})

test('terminal feed errors override outline text even while the running flag is stale', async () => {
  const progress: ConferenceProgress[] = []
  const run = startConference({
    dispatch: async () => 'session-error',
    conversationFeed: () => new MutableSnapshot(failedChat('接口连接失败')),
    sessionFace: () => new MutableSnapshot({ running: true, hasMore: false }),
    sessionList: new MutableSnapshot({ byId: { 'session-error': {
      running: true,
      projectionValues: { turnOutline: [{ response: '角色的部分回答' }] },
    } } }),
    emit: event => progress.push(event),
  }, { text: '共同回答', targets: [target(1)] })
  await run.completed
  assert.equal(progress.some(event => event.phase === 'done'), false)
  assert.deepEqual(progress.filter(event => event.phase === 'failed').map(event => event.error), ['接口连接失败'])
})

test('a paused animation frame clock does not block settlement or dispatch of the next seat', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
  let frameRequests = 0
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: () => { frameRequests += 1; return 1 },
  })
  t.after(() => {
    if (original === undefined) Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
    else Object.defineProperty(globalThis, 'requestAnimationFrame', original)
  })
  const feed = new MutableSnapshot<ChatSnapshot | undefined>(emptyChat())
  const face = new MutableSnapshot({ running: true, hasMore: false })
  const progress: ConferenceProgress[] = []
  let calls = 0
  const run = startConference({
    concurrency: 1,
    dispatch: async () => { calls += 1; return `session-${calls}` },
    conversationFeed: () => feed,
    sessionFace: () => face,
    emit: event => progress.push(event),
    replyTimeoutMs: 500,
  }, { text: '共同回答', targets: [target(1), target(2)] })
  await until(() => progress.some(event => event.phase === 'running'))
  feed.set(answeredChat('隐藏页中的回复'))
  face.set({ running: false, hasMore: false })
  await run.completed
  assert.equal(calls, 2)
  assert.equal(frameRequests, 0)
  assert.equal(progress.filter(event => event.phase === 'done').length, 2)
})

test('cancelling a conference settles every unfinished seat and stops later dispatches', async () => {
  const feed = new MutableSnapshot<ChatSnapshot | undefined>(emptyChat())
  const face = new MutableSnapshot({ running: true, hasMore: false })
  const progress: ConferenceProgress[] = []
  let calls = 0
  const targets = [1, 2, 3].map(target)
  const run = startConference({
    concurrency: 1,
    dispatch: async () => {
      calls += 1
      return 'session-running'
    },
    conversationFeed: () => feed,
    sessionFace: () => face,
    emit: event => progress.push(event),
  }, { text: '共同回答', targets })

  await until(() => progress.some(event => event.phase === 'running'))
  run.cancel()
  await run.completed

  assert.equal(calls, 1)
  assert.deepEqual(
    progress.filter(event => event.phase === 'failed').map(event => event.skillName).sort(),
    targets.map(item => item.skillName).sort(),
  )
  assert.equal(progress.filter(event => event.phase === 'failed').every(event => event.error === '会议已取消'), true)
})

test('cancelling while dispatch is pending settles immediately and suppresses a late running event', async () => {
  const progress: ConferenceProgress[] = []
  let resolveDispatch!: (sessionId: string) => void
  const dispatchPending = new Promise<string>(resolve => { resolveDispatch = resolve })
  const run = startConference({
    concurrency: 1,
    dispatch: () => dispatchPending,
    conversationFeed: () => undefined,
    sessionFace: () => undefined,
    emit: event => progress.push(event),
  }, { text: '共同回答', targets: [target(1), target(2)] })

  await until(() => progress.some(event => event.phase === 'dispatching'))
  run.cancel()
  await Promise.race([
    run.completed,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('cancelled conference did not settle')), 50)
    }),
  ])

  resolveDispatch('session-late')
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.equal(progress.some(event => event.phase === 'running'), false)
  assert.deepEqual(
    progress.filter(event => event.phase === 'failed').map(event => event.skillName).sort(),
    [target(1), target(2)].map(item => item.skillName).sort(),
  )
})

test('startConference rejects invalid input before dispatching', () => {
  let calls = 0
  const deps = {
    dispatch: async () => { calls += 1; return 'session-never' },
    conversationFeed: () => undefined,
    sessionFace: () => undefined,
    emit: () => {},
  }
  assert.throws(() => startConference(deps, { text: ' ', targets: [target(1)] }), /会议问题为空/u)
  assert.throws(() => startConference(deps, { text: '问题', targets: [] }), /没有已部署/u)
  assert.equal(calls, 0)
})
