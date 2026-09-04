import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { promptWithDeferredActivation, type PromptAdmission } from '../src/client/activation-bridge.ts'

const app = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')
const bridge = readFileSync(new URL('../src/client/workbench.tsx', import.meta.url), 'utf8')

test('non-current prompts defer activation and mark the following send atomically', () => {
  const sendMessage = app.slice(app.indexOf('async function sendMessage'), app.indexOf('async function submitDraft'))
  assert.match(sendMessage, /post\('amphoreus:activate-session', \{ sessionId: thread\.dshSessionId, defer: true \}\)[\s\S]*dshRpc\('amphoreus:send-message', \{ sessionId: thread\.dshSessionId, text, activate \}\)/)

  const submitDraft = app.slice(app.indexOf('async function submitDraft'), app.indexOf('function threadsById'))
  assert.equal((submitDraft.match(/defer: true/g) ?? []).length, 2)
  assert.equal((submitDraft.match(/activate: true/g) ?? []).length, 2)
})

test('bridge records deferred intent and delegates authority to the parent session snapshot', () => {
  assert.match(bridge, /defer\?: boolean/)
  assert.match(bridge, /activate\?: boolean/)

  const sendCase = bridge.slice(bridge.indexOf("case 'amphoreus:send-message'"), bridge.indexOf("case 'amphoreus:fork-session'"))
  assert.match(sendCase, /promptWithDeferredActivation\([\s\S]*requestedActivation: data\.activate === true/)
  assert.match(sendCase, /currentSession: \(\) => sessions\.list\.getSnapshot\(\)\.current/)
  assert.match(sendCase, /reply: \(\) => reply\([\s\S]*open: id => sessions\.open\(id\)/)

  const activateCase = bridge.slice(bridge.indexOf("case 'amphoreus:activate-session'"), bridge.indexOf("case 'amphoreus:close'"))
  assert.match(activateCase, /data\.defer === true[\s\S]*deferredActivationsRef\.current\.add\(data\.sessionId\)[\s\S]*return/)
  assert.ok(activateCase.indexOf('deferredActivationsRef.current.add') < activateCase.indexOf('sessions.open(data.sessionId)'))
})

function delivery(options: {
  current: string
  requestedActivation: boolean
  withIntent: boolean
  result: PromptAdmission
}) {
  const sessionId = 'target-session'
  const trace: string[] = []
  const deferredActivations = new Set(options.withIntent ? [sessionId] : [])
  const operation = promptWithDeferredActivation({
    sessionId,
    text: 'question',
    requestedActivation: options.requestedActivation,
    deferredActivations,
    currentSession: () => options.current,
    binding: () => ({
      session: {
        prompt: async () => {
          trace.push('prompt')
          return options.result
        },
      },
    }),
    reply: () => trace.push('reply'),
    open: () => trace.push('open'),
  })
  return { operation, trace, deferredActivations }
}

test('parent current is authoritative and stale activate=false fails closed without intent', async () => {
  const attempt = delivery({ current: 'another-session', requestedActivation: false, withIntent: false, result: { ok: true } })
  await assert.rejects(attempt.operation, /缺少延迟激活意图/)
  assert.deepEqual(attempt.trace, [])

  const unprovenRequest = delivery({ current: 'target-session', requestedActivation: true, withIntent: false, result: { ok: true } })
  await assert.rejects(unprovenRequest.operation, /缺少延迟激活意图/)
  assert.deepEqual(unprovenRequest.trace, [])
})

test('failed prompt admission leaves the current session untouched', async () => {
  const attempt = delivery({ current: 'another-session', requestedActivation: false, withIntent: true, result: { ok: false, error: { message: 'rejected' } } })
  await assert.rejects(attempt.operation, /rejected/)
  assert.deepEqual(attempt.trace, ['prompt'])
  assert.equal(attempt.deferredActivations.size, 0)
})

test('successful admission replies before opening the target session', async () => {
  const attempt = delivery({ current: 'another-session', requestedActivation: true, withIntent: true, result: { ok: true } })
  await attempt.operation
  assert.deepEqual(attempt.trace, ['prompt', 'reply', 'open'])
  assert.equal(attempt.deferredActivations.size, 0)
})

test('current-session prompts need no deferred activation and do not reopen', async () => {
  const attempt = delivery({ current: 'target-session', requestedActivation: false, withIntent: false, result: { ok: true } })
  await attempt.operation
  assert.deepEqual(attempt.trace, ['prompt', 'reply'])
})
