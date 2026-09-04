import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  contentText,
  feedFromChat,
  HARD_TEXT_CAP,
  liveTextOf,
} from '../src/client/conversation-feed.ts'

const oversized = '界'.repeat(HARD_TEXT_CAP + 17)

test('feedFromChat projects visible messages, pairs tool results, and skips control nodes', () => {
  const chat = snapshot([
    { kind: 'user', seq: 1, time: 10, content: [{ type: 'text', text: '问题' }, { type: 'reasoning', text: '用户隐藏推理' }], source: {} },
    {
      kind: 'assistant',
      seq: 2,
      time: 20,
      turn: 1,
      step: 1,
      blocks: [
        { kind: 'reasoning', text: '助手隐藏推理' },
        { kind: 'text', text: '第一段' },
        { kind: 'tool-call', callId: 'call-ok', name: 'lookup', argsRaw: oversized },
        { kind: 'text', text: '第二段' },
      ],
    },
    {
      kind: 'tool-result',
      seq: 3,
      time: 30,
      callId: 'call-ok',
      call: { name: 'lookup', argsRaw: oversized },
      callTime: 21,
      content: [{ type: 'text', text: oversized }, { type: 'reasoning', text: '结果隐藏推理' }],
      isError: false,
      subCalls: [],
    },
    {
      kind: 'assistant',
      seq: 4,
      time: 40,
      turn: 1,
      step: 2,
      blocks: [{ kind: 'tool-call', callId: 'call-fail', name: 'write', argsRaw: '{}' }],
    },
    {
      kind: 'tool-result',
      seq: 5,
      time: 50,
      callId: 'call-fail',
      call: { name: 'write', argsRaw: '{}' },
      callTime: 41,
      content: [{ type: 'text', text: oversized }],
      isError: true,
      error: { name: 'WriteError', code: 'E_WRITE' },
      subCalls: [],
    },
    { kind: 'turn-error', seq: 6, time: 60, turn: 1, step: 2, message: oversized },
    { kind: 'context', seq: 7, time: 70, content: [{ type: 'text', text: '<skill_content>secret</skill_content>' }] },
    { kind: 'compaction', seq: 8, time: 80 },
    { kind: 'command', seq: 9, time: 90 },
    { kind: 'model-retry', seq: 10, time: 100 },
    { kind: 'turn-max-tokens', seq: 11, time: 110, turn: 1, step: 2 },
    { kind: 'unknown', seq: 12, time: 120, type: 'future/event', data: {} },
    { kind: 'steering', seq: 13, time: 130, content: [{ type: 'text', text: '补充' }], source: {} },
  ], [
    { anchorSeq: 1, key: 'anchor-user' },
    { anchorSeq: 2, key: 'anchor-answer' },
    { anchorSeq: 6, key: 'anchor-error' },
  ])

  const payload = feedFromChat('session-fixture', chat, 7, true)
  assert.equal(payload.sessionId, 'session-fixture')
  assert.equal(payload.revision, 7)
  assert.equal(payload.complete, false)
  assert.deepEqual(payload.messages.map(message => message.kind), ['user', 'assistant', 'assistant', 'error', 'user'])

  const user = payload.messages[0]!
  assert.equal(user.text, '问题')
  assert.equal(user.anchorKey, 'anchor-user')
  assert.equal(Object.hasOwn(user, 'process'), false)

  const answer = payload.messages[1]!
  assert.equal(answer.text, '第一段\n第二段')
  assert.equal(answer.text.includes('助手隐藏推理'), false)
  assert.equal(answer.anchorKey, 'anchor-answer')
  assert.equal(answer.process?.[0]?.arguments?.length, HARD_TEXT_CAP)
  assert.equal(answer.process?.[0]?.result?.length, HARD_TEXT_CAP)
  assert.equal(answer.process?.[0]?.error, null)

  const failed = payload.messages[2]!
  assert.equal(failed.process?.[0]?.result, null)
  assert.equal(failed.process?.[0]?.error?.length, HARD_TEXT_CAP)

  const error = payload.messages[3]!
  assert.equal(error.text.length, HARD_TEXT_CAP)
  assert.equal(error.anchorKey, 'anchor-error')
  assert.equal(JSON.stringify(payload).includes('<skill_content>'), false)
  assert.equal(payload.messages[4]?.text, '补充')
})

test('feedFromChat marks an exhausted window complete and uses tool error metadata when text is absent', () => {
  const chat = snapshot([
    {
      kind: 'assistant', seq: 1, time: 1, turn: 1, step: 1,
      blocks: [{ kind: 'tool-call', callId: 'call-empty', name: 'probe', argsRaw: '' }],
    },
    {
      kind: 'tool-result', seq: 2, time: 2, callId: 'call-empty',
      call: { name: 'probe', argsRaw: '' }, callTime: 1, content: [], isError: true,
      error: { name: 'ProbeError', code: 'E_PROBE' }, subCalls: [],
    },
  ])

  const payload = feedFromChat('session-complete', chat, 1, false)
  assert.equal(payload.complete, true)
  assert.equal(payload.messages[0]?.process?.[0]?.error, 'ProbeError: E_PROBE')
})

test('feedFromChat applies the hard cap to every user and assistant body', () => {
  const chat = snapshot([
    { kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: oversized }], source: {} },
    { kind: 'assistant', seq: 2, time: 2, turn: 1, step: 1, blocks: [{ kind: 'text', text: oversized }] },
    { kind: 'steering', seq: 3, time: 3, content: [{ type: 'text', text: oversized }], source: {} },
  ])

  const payload = feedFromChat('session-bounded', chat, 1, false)
  assert.deepEqual(payload.messages.map(message => message.text.length), [HARD_TEXT_CAP, HARD_TEXT_CAP, HARD_TEXT_CAP])
})

test('liveTextOf joins only text blocks and applies the hard cap', () => {
  const chat = snapshot([], [], {
    turn: 2,
    step: 3,
    blocks: [
      { kind: 'reasoning', text: '隐藏推理' },
      { kind: 'text', text: '开头' },
      { kind: 'tool-call', callId: 'call-live', name: 'noop', argsRaw: '{}' },
      { kind: 'text', text: oversized },
    ],
  })

  const live = liveTextOf(chat)
  assert.equal(live.startsWith('开头'), true)
  assert.equal(live.includes('隐藏推理'), false)
  assert.equal(live.length, HARD_TEXT_CAP)
  assert.equal(liveTextOf(undefined), '')
})

test('contentText mirrors the host projection without exposing reasoning', () => {
  assert.equal(contentText([
    { type: 'text', text: '正文' },
    { type: 'reasoning', text: '隐藏' },
    { type: 'tool-call', name: '工具', arguments: '{"x":1}' },
    { type: 'tool-result', content: [{ type: 'text', text: '结果' }] },
  ]), '正文\n工具\n{"x":1}\n结果')
})

function snapshot(
  legacyNodes: readonly unknown[],
  viewNodes: readonly { anchorSeq: number; key: string }[] = [],
  partial: unknown = null,
): ChatSnapshot {
  return {
    nodes: { values: () => viewNodes },
    legacy: { nodes: legacyNodes, partial },
  } as unknown as ChatSnapshot
}
