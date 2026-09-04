import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { ObservationRecord } from '../src/host/store.ts'
import {
  acceptHandoff,
  dismissHandoff,
  dispatchTask,
  observationKey,
  type HandoffDeps,
} from '../src/client/handoff.ts'

const NONCE = 'handoff-nonce'
const SKILL = 'amphoreus-anaxa'
const FACE = '夜星'
const SEAT_DIR = 'D:/fixture/anaxa'
const SOURCE_DIR = 'D:/fixture/source-project'
const SOURCE_ID = 'session-00000000-0000-4000-8000-000000000001'
const CHILD_ID = 'session-00000000-0000-4000-8000-000000000002'

interface FetchCall {
  readonly input: string | URL | Request
  readonly init?: RequestInit
}

type SessionOverrides = Partial<Pick<
  HandoffDeps['sessions'],
  'create' | 'open' | 'fork' | 'binding'
>>

function deps(sessionOverrides: SessionOverrides = {}): HandoffDeps {
  return {
    nonce: () => NONCE,
    seatDirOf: () => SEAT_DIR,
    sessions: {
      create: async options => options.sessionId!,
      open: () => {},
      fork: async () => CHILD_ID,
      binding: () => ({
        session: {
          prompt: async () => ({ ok: true }),
        },
      }),
      ...sessionOverrides,
    },
  }
}

function response(status = 200, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function withFetch<T>(implementation: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = implementation
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}

function handoff(overrides: Partial<ObservationRecord> = {}): ObservationRecord {
  return {
    sessionId: SOURCE_ID,
    seq: 17,
    kind: 'handoff',
    targetSkillName: SKILL,
    targetDisplayName: '那刻夏',
    targetFace: FACE,
    rawLine: '此事移交那刻夏：<整改单>',
    payload: '<整改单>',
    parsedAt: 1,
    status: 'open',
    ...overrides,
  }
}

test('dispatchTask preserves PUT-create-observation-prompt-open order and all dispatch fields', async () => {
  const order: string[] = []
  const calls: FetchCall[] = []
  let created: { cwd?: string; sessionId?: string } | undefined
  let promptContent: unknown
  let promptMode: unknown
  const fixture = deps({
    create: async options => {
      order.push('create')
      created = options
      return options.sessionId!
    },
    binding: id => {
      order.push('binding')
      assert.equal(id, created?.sessionId)
      return {
        session: {
          prompt: async (content, mode) => {
            order.push('prompt')
            promptContent = content
            promptMode = mode
            return { ok: true }
          },
        },
      }
    },
    open: id => {
      order.push('open')
      assert.equal(id, created?.sessionId)
    },
  })

  const id = await withFetch(async (input, init) => {
    calls.push({ input, init })
    order.push(`${init?.method} ${String(input).includes('/bindings/') ? 'binding' : 'observation'}`)
    return response(init?.method === 'POST' ? 201 : 200)
  }, () => dispatchTask(fixture, {
    skillName: SKILL,
    text: '  评审这段逻辑  ',
    cwd: SOURCE_DIR,
    face: FACE,
    from: 'pipeline',
    pipeline: '逐火线',
    station: 4,
    open: true,
  }))

  assert.equal(id, created?.sessionId)
  assert.deepEqual(order, [
    'PUT binding',
    'create',
    'POST observation',
    'binding',
    'prompt',
    'open',
  ])
  assert.deepEqual(created, { sessionId: id, cwd: SOURCE_DIR })
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    skill: SKILL,
    boundBy: 'dispatch',
    face: FACE,
  })
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
    sessionId: id,
    seq: 0,
    kind: 'dispatch',
    targetSkillName: SKILL,
    payload: '评审这段逻辑',
    dispatchedFrom: 'pipeline',
    pipeline: '逐火线',
    station: 4,
  })
  assert.deepEqual(promptContent, [{ type: 'text', text: '评审这段逻辑' }])
  assert.equal(promptMode, 'queue')
})

test('dispatchTask rejects blank text before any external effect', async () => {
  let touched = false
  const fixture = deps({
    create: async () => { touched = true; return CHILD_ID },
    binding: () => { touched = true; return undefined },
    open: () => { touched = true },
  })
  await withFetch(async () => {
    touched = true
    return response()
  }, async () => {
    await assert.rejects(dispatchTask(fixture, { skillName: SKILL, text: '  ', from: 'panel' }), /任务文本为空/)
  })
  assert.equal(touched, false)
})

test('an observation failure leaves the created binding intact and never prompts or opens', async () => {
  const methods: string[] = []
  let created = false
  let bindings = 0
  let prompts = 0
  let opens = 0
  const fixture = deps({
    create: async options => { created = true; return options.sessionId! },
    binding: () => {
      bindings += 1
      return { session: { prompt: async () => { prompts += 1; return { ok: true } } } }
    },
    open: () => { opens += 1 },
  })

  await withFetch(async (_input, init) => {
    methods.push(String(init?.method))
    return init?.method === 'POST'
      ? response(500, { error: 'observation failed' })
      : response()
  }, async () => {
    await assert.rejects(
      dispatchTask(fixture, { skillName: SKILL, text: '任务', from: 'panel', open: true }),
      /\/amphoreus\/api\/observations HTTP 500: observation failed/,
    )
  })

  assert.equal(created, true)
  assert.deepEqual(methods, ['PUT', 'POST'])
  assert.equal(methods.includes('DELETE'), false)
  assert.equal(bindings, 0)
  assert.equal(prompts, 0)
  assert.equal(opens, 0)
})

test('a delayed client binding is retried before the queued prompt', async () => {
  let reads = 0
  let prompts = 0
  const fixture = deps({
    binding: () => {
      reads += 1
      if (reads === 1) return undefined
      return { session: { prompt: async () => { prompts += 1; return { ok: true } } } }
    },
  })
  await withFetch(async (_input, init) => response(init?.method === 'POST' ? 201 : 200), async () => {
    await dispatchTask(fixture, { skillName: SKILL, text: '任务', from: 'panel' })
  })
  assert.equal(reads, 2)
  assert.equal(prompts, 1)
})

test('a rejected prompt preserves dispatch records and suppresses open or binding rollback', async () => {
  const methods: string[] = []
  let opens = 0
  const fixture = deps({
    binding: () => ({
      session: { prompt: async () => ({ ok: false, error: { message: '队列拒绝' } }) },
    }),
    open: () => { opens += 1 },
  })
  await withFetch(async (_input, init) => {
    methods.push(String(init?.method))
    return response(init?.method === 'POST' ? 201 : 200)
  }, async () => {
    await assert.rejects(
      dispatchTask(fixture, { skillName: SKILL, text: '任务', from: 'panel', open: true }),
      /队列拒绝/,
    )
  })
  assert.deepEqual(methods, ['PUT', 'POST'])
  assert.equal(methods.includes('DELETE'), false)
  assert.equal(opens, 0)
})

test('a final open failure happens after prompt and does not roll durable dispatch state back', async () => {
  const order: string[] = []
  const fixture = deps({
    binding: () => ({ session: { prompt: async () => { order.push('prompt'); return { ok: true } } } }),
    open: () => { order.push('open'); throw new Error('open failed') },
  })
  await withFetch(async (_input, init) => {
    order.push(String(init?.method))
    return response(init?.method === 'POST' ? 201 : 200)
  }, async () => {
    await assert.rejects(
      dispatchTask(fixture, { skillName: SKILL, text: '任务', from: 'rail', open: true }),
      /open failed/,
    )
  })
  assert.deepEqual(order, ['PUT', 'POST', 'prompt', 'open'])
  assert.equal(order.includes('DELETE'), false)
})

test('acceptHandoff forks, binds lineage and face, patches the encoded key, then opens without prompting', async () => {
  const order: string[] = []
  const calls: FetchCall[] = []
  let prompts = 0
  const fixture = deps({
    fork: async options => {
      order.push('fork')
      assert.deepEqual(options, { sessionId: SOURCE_ID, atSeq: 17, increaseTitle: true })
      return CHILD_ID
    },
    binding: () => ({ session: { prompt: async () => { prompts += 1; return { ok: true } } } }),
    open: id => { order.push('open'); assert.equal(id, CHILD_ID) },
  })

  const child = await withFetch(async (input, init) => {
    calls.push({ input, init })
    order.push(String(input).includes('/bindings/') ? 'binding' : 'observation')
    return response()
  }, () => acceptHandoff(fixture, handoff()))

  assert.equal(child, CHILD_ID)
  assert.deepEqual(order, ['fork', 'binding', 'observation', 'open'])
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    skill: SKILL,
    boundBy: 'handoff-fork',
    fromSessionId: SOURCE_ID,
    fromSeq: 17,
    face: FACE,
  })
  assert.equal(
    calls[1]?.input,
    `/amphoreus/api/observations/${encodeURIComponent(`${SOURCE_ID}:17:handoff`)}`,
  )
  assert.match(String(calls[1]?.input), /%3A17%3Ahandoff$/)
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
    status: 'accepted',
    acceptedSessionId: CHILD_ID,
  })
  assert.equal(prompts, 0)
})

test('acceptHandoff rejects invalid records before fork or fetch', async () => {
  let forks = 0
  let fetches = 0
  const fixture = deps({ fork: async () => { forks += 1; return CHILD_ID } })
  await withFetch(async () => { fetches += 1; return response() }, async () => {
    await assert.rejects(acceptHandoff(fixture, handoff({ kind: 'receipt' })), /该移交不可接受/)
    await assert.rejects(acceptHandoff(fixture, handoff({ status: 'accepted' })), /该移交不可接受/)
    await assert.rejects(acceptHandoff(fixture, handoff({ targetSkillName: null })), /移交目标无法解析/)
  })
  assert.equal(forks, 0)
  assert.equal(fetches, 0)
})

test('a fork failure performs no client-side writes', async () => {
  let fetches = 0
  const fixture = deps({ fork: async () => { throw new Error('fork failed') } })
  await withFetch(async () => { fetches += 1; return response() }, async () => {
    await assert.rejects(acceptHandoff(fixture, handoff()), /fork failed/)
  })
  assert.equal(fetches, 0)
})

test('a child binding failure leaves the forked child and open observation without patch or open', async () => {
  const order: string[] = []
  const fixture = deps({
    fork: async () => { order.push('fork'); return CHILD_ID },
    open: () => { order.push('open') },
  })
  await withFetch(async (input) => {
    order.push(String(input).includes('/bindings/') ? 'binding' : 'observation')
    return response(500, { error: 'binding failed' })
  }, async () => {
    await assert.rejects(acceptHandoff(fixture, handoff()), /binding failed/)
  })
  assert.deepEqual(order, ['fork', 'binding'])
})

test('an accepted-status patch failure leaves the downstream child binding and does not open', async () => {
  const order: string[] = []
  const fixture = deps({
    fork: async () => { order.push('fork'); return CHILD_ID },
    open: () => { order.push('open') },
  })
  await withFetch(async (input) => {
    const kind = String(input).includes('/bindings/') ? 'binding' : 'observation'
    order.push(kind)
    return kind === 'observation' ? response(500, { error: 'patch failed' }) : response()
  }, async () => {
    await assert.rejects(acceptHandoff(fixture, handoff()), /patch failed/)
  })
  assert.deepEqual(order, ['fork', 'binding', 'observation'])
})

test('an accept open failure occurs after both durable writes', async () => {
  const order: string[] = []
  const fixture = deps({
    fork: async () => { order.push('fork'); return CHILD_ID },
    open: () => { order.push('open'); throw new Error('open failed') },
  })
  await withFetch(async (input) => {
    order.push(String(input).includes('/bindings/') ? 'binding' : 'observation')
    return response()
  }, async () => {
    await assert.rejects(acceptHandoff(fixture, handoff()), /open failed/)
  })
  assert.deepEqual(order, ['fork', 'binding', 'observation', 'open'])
})

test('dismissHandoff only patches the encoded observation key', async () => {
  const calls: FetchCall[] = []
  await withFetch(async (input, init) => {
    calls.push({ input, init })
    return response()
  }, () => dismissHandoff(deps(), handoff()))
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.init?.method, 'PUT')
  assert.equal(
    calls[0]?.input,
    `/amphoreus/api/observations/${encodeURIComponent(`${SOURCE_ID}:17:handoff`)}`,
  )
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { status: 'dismissed' })
})

test('dismissHandoff rejects stale accepted or dismissed records without a PUT', async () => {
  let fetches = 0
  await withFetch(async () => { fetches += 1; return response() }, async () => {
    await assert.rejects(dismissHandoff(deps(), handoff({ status: 'accepted' })), /该移交不可忽略/)
    await assert.rejects(dismissHandoff(deps(), handoff({ status: 'dismissed' })), /该移交不可忽略/)
  })
  assert.equal(fetches, 0)
})

test('handoff source has one prompt call, reuses seat-actions, and keeps accept prompt-free', () => {
  const source = readFileSync(new URL('../src/client/handoff.ts', import.meta.url), 'utf8')
  assert.equal((source.match(/\.prompt\(/g) ?? []).length, 1)
  assert.match(source, /from '\.\/seat-actions\.ts'/)
  const accept = source.slice(source.indexOf('export async function acceptHandoff'), source.indexOf('export async function dismissHandoff'))
  assert.doesNotMatch(accept, /\.prompt\(/)
  assert.equal(observationKey(handoff()), `${SOURCE_ID}:17:handoff`)
})
