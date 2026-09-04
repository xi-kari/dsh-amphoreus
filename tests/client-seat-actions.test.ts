import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { deleteBinding, putBinding, startSeatSession, type SeatActionDeps } from '../src/client/seat-actions.ts'

const NONCE = 'seat-action-nonce'
const SKILL = 'amphoreus-aglaea'
const DIR = 'D:/fixture/aglaea'
const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

interface FetchCall {
  readonly input: string | URL | Request
  readonly init?: RequestInit
}

async function withFetch<T>(
  implementation: typeof fetch,
  callback: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = implementation
  try {
    return await callback()
  } finally {
    globalThis.fetch = original
  }
}

function ok(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function deps(overrides: Partial<SeatActionDeps> = {}): SeatActionDeps {
  return {
    nonce: () => NONCE,
    seatDirOf: () => DIR,
    sessions: {
      create: async options => options.sessionId!,
      open: () => {},
    },
    ...overrides,
  }
}

test('startSeatSession performs PUT then create then open with one preallocated id and seat cwd', async () => {
  const order: string[] = []
  const calls: FetchCall[] = []
  let createOptions: { cwd?: string; sessionId?: string } | undefined
  const fixture = deps({
    sessions: {
      create: async options => {
        order.push('create')
        createOptions = options
        return options.sessionId!
      },
      open: id => {
        order.push('open')
        assert.equal(id, createOptions?.sessionId)
      },
    },
  })

  const id = await withFetch(async (input, init) => {
    order.push(String(init?.method))
    calls.push({ input, init })
    return ok({ binding: {} })
  }, () => startSeatSession(fixture, SKILL))

  assert.deepEqual(order, ['PUT', 'create', 'open'])
  assert.match(id, SESSION_ID)
  assert.deepEqual(createOptions, { sessionId: id, cwd: DIR })
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.input, `/amphoreus/api/bindings/${encodeURIComponent(id)}`)
  assert.equal(calls[0]?.init?.credentials, 'include')
  assert.deepEqual(calls[0]?.init?.headers, {
    'content-type': 'application/json',
    'x-amphoreus-nonce': NONCE,
  })
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { skill: SKILL, boundBy: 'seat-new' })
})

test('create failure deletes the prebinding, preserves the original error, and never opens', async () => {
  const failure = new Error('create failed')
  const order: string[] = []
  const calls: FetchCall[] = []
  const fixture = deps({
    sessions: {
      create: async () => {
        order.push('create')
        throw failure
      },
      open: () => { order.push('open') },
    },
  })

  await withFetch(async (input, init) => {
    order.push(String(init?.method))
    calls.push({ input, init })
    return init?.method === 'DELETE'
      ? new Response(JSON.stringify({ error: 'rollback failed' }), { status: 500 })
      : ok({ binding: {} })
  }, async () => {
    await assert.rejects(startSeatSession(fixture, SKILL), error => error === failure)
  })

  assert.deepEqual(order, ['PUT', 'create', 'DELETE'])
  assert.equal(calls[1]?.init?.credentials, 'include')
  assert.deepEqual(calls[1]?.init?.headers, { 'x-amphoreus-nonce': NONCE })
  assert.equal(calls[1]?.init?.body, undefined)
})

test('a mismatched host id and an open failure both delete the binding and throw', async () => {
  for (const mode of ['mismatch', 'open'] as const) {
    const order: string[] = []
    const openFailure = new Error('open failed')
    const fixture = deps({
      sessions: {
        create: async options => {
          order.push('create')
          return mode === 'mismatch' ? 'session-ffffffff-ffff-ffff-ffff-ffffffffffff' : options.sessionId!
        },
        open: () => {
          order.push('open')
          throw openFailure
        },
      },
    })
    await withFetch(async (_input, init) => {
      order.push(String(init?.method))
      return ok()
    }, async () => {
      if (mode === 'mismatch') {
        await assert.rejects(startSeatSession(fixture, SKILL), /宿主返回了不同的会话 id/)
        assert.deepEqual(order, ['PUT', 'create', 'DELETE'])
      } else {
        await assert.rejects(startSeatSession(fixture, SKILL), error => error === openFailure)
        assert.deepEqual(order, ['PUT', 'create', 'open', 'DELETE'])
      }
    })
  }
})

test('binding errors stay visible and prevent create, while DELETE treats 404 as success', async () => {
  let creates = 0
  const fixture = deps({
    sessions: {
      create: async options => {
        creates += 1
        return options.sessionId!
      },
      open: () => {},
    },
  })
  await withFetch(async (_input, init) => {
    if (init?.method === 'DELETE') return new Response('{}', { status: 404 })
    return new Response(JSON.stringify({ error: 'invalid amphoreus nonce' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    await assert.rejects(
      startSeatSession(fixture, SKILL),
      /席位绑定失败（HTTP 403）：invalid amphoreus nonce/,
    )
    assert.equal(creates, 0)
    await assert.doesNotReject(deleteBinding(fixture, 'session-00000000-0000-0000-0000-000000000001'))
  })
})

test('nonce absence fails before fetch and open:false leaves the matching created session closed', async () => {
  let fetches = 0
  let opens = 0
  await withFetch(async () => {
    fetches += 1
    return ok()
  }, async () => {
    await assert.rejects(startSeatSession(deps({ nonce: () => undefined }), SKILL), /nonce 未就绪/)
    const id = await startSeatSession(deps({
      sessions: {
        create: async options => options.sessionId!,
        open: () => { opens += 1 },
      },
    }), SKILL, { open: false })
    assert.match(id, SESSION_ID)
  })
  assert.equal(fetches, 1)
  assert.equal(opens, 0)
})

test('dispatch options override cwd, preserve face, and keep the prebound session closed', async () => {
  const calls: FetchCall[] = []
  const customDir = 'D:/fixture/source-project'
  let createOptions: { cwd?: string; sessionId?: string } | undefined
  let opens = 0
  const fixture = deps({
    sessions: {
      create: async options => {
        createOptions = options
        return options.sessionId!
      },
      open: () => { opens += 1 },
    },
  })

  const id = await withFetch(async (input, init) => {
    calls.push({ input, init })
    return ok()
  }, () => startSeatSession(fixture, SKILL, {
    open: false,
    boundBy: 'dispatch',
    cwd: customDir,
    face: '夜星',
  }))

  assert.deepEqual(createOptions, { sessionId: id, cwd: customDir })
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    skill: SKILL,
    boundBy: 'dispatch',
    face: '夜星',
  })
  assert.equal(opens, 0)
})

test('putBinding includes face and reports an empty detail for a non-object error body', async () => {
  const sessionId = 'session-00000000-0000-0000-0000-000000000001'
  const calls: FetchCall[] = []
  await withFetch(async (input, init) => {
    calls.push({ input, init })
    return new Response('null', { status: 500, headers: { 'content-type': 'application/json' } })
  }, async () => {
    await assert.rejects(
      putBinding(deps(), sessionId, { skill: SKILL, boundBy: 'seat-enter', face: 'analysis' }),
      /席位绑定失败（HTTP 500）：$/,
    )
  })
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    skill: SKILL,
    boundBy: 'seat-enter',
    face: 'analysis',
  })
})

test('putBinding carries handoff lineage without rewriting it in the caller', async () => {
  const sessionId = 'session-00000000-0000-4000-8000-000000000002'
  const parentId = 'session-00000000-0000-4000-8000-000000000001'
  let body: unknown
  await withFetch(async (_input, init) => {
    body = JSON.parse(String(init?.body))
    return ok()
  }, () => putBinding(deps(), sessionId, {
    skill: SKILL,
    boundBy: 'handoff-fork',
    face: '夜星',
    fromSessionId: parentId,
    fromSeq: 17,
  }))
  assert.deepEqual(body, {
    skill: SKILL,
    boundBy: 'handoff-fork',
    face: '夜星',
    fromSessionId: parentId,
    fromSeq: 17,
  })
})

test('workbench and client injection use only the shared skillName seat-session surface', () => {
  const index = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  const workbench = readFileSync(new URL('../src/client/workbench.tsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')
  const combined = `${index}\n${workbench}\n${app}`
  assert.doesNotMatch(combined, /\b(?:seatHeroId|bindSeat|seatSkillOf)\b/)
  assert.match(index, /const seatDeps: HandoffDeps/)
  assert.match(index, /startSeatSession: skillName => startSeatSession\(seatDeps, skillName, \{ open: false \}\)/)
  assert.ok((index.match(/\bseatDeps,?/g) ?? []).length >= 4)
  assert.match(workbench, /if \(typeof data\.skillName === 'string' && data\.skillName !== ''\)/)
  assert.match(workbench, /const id = await startSeatSession\(data\.skillName\)/)
  assert.match(app, /skillName: seatSkill\?\.skillName/)
  assert.match(app, /state\.sessionsById\.get\(state\.currentSessionId\)\?\.cwd/)
  const draftStart = app.indexOf("if (draft.kind === 'new')")
  const canvasFlush = app.indexOf('await flushCanvasSaves()', draftStart)
  const bridgeCreate = app.indexOf("dshRpc('amphoreus:create-session'", draftStart)
  assert.ok(draftStart >= 0 && draftStart < canvasFlush && canvasFlush < bridgeCreate)
  const genericCreate = workbench.indexOf('const id = await sessions.create')
  const genericReply = workbench.indexOf("type: 'amphoreus:created-session'", genericCreate)
  assert.ok(genericCreate >= 0 && genericCreate < genericReply)
  assert.doesNotMatch(workbench.slice(genericCreate, genericReply), /sessions\.open\(/)
  const bridgeReply = app.indexOf("dshRpc('amphoreus:create-session'", draftStart)
  const deferredActivation = app.indexOf("post('amphoreus:activate-session'", bridgeReply)
  const admittedSend = app.indexOf("dshRpc('amphoreus:send-message'", deferredActivation)
  assert.ok(bridgeReply < deferredActivation && deferredActivation < admittedSend)
})
