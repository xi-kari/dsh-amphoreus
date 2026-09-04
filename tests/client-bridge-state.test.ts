import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildStateMessage } from '../src/client/bridge-state.ts'
import type { AmphoreusState } from '../src/shared/api.ts'

const effectiveConfig = {
  assetsConfigured: true,
  handoffEnabled: true,
  receiptParsing: true,
  dispatchHints: true,
  pipelinesEnabled: true,
}

function state(suite: object | undefined): AmphoreusState {
  return {
    revision: 7,
    suite,
    seats: [{ skillName: 'amphoreus-test', status: 'deployed' }],
    bindings: [{ sessionId: 'session-a', skillName: 'amphoreus-test' }],
    observations: [{ sessionId: 'session-a', kind: 'dispatch' }],
    memory: [{ skillName: 'amphoreus-test', notes: [] }],
    effectiveConfig,
  } as unknown as AmphoreusState
}

test('buildStateMessage emits a complete degraded-safe payload', () => {
  const message = buildStateMessage(state(undefined))
  assert.equal(message.source, 'dsh-amphoreus')
  assert.equal(message.type, 'amphoreus:state')
  assert.equal(message.revision, 7)
  assert.deepEqual(message.features, {
    provider: false,
    autoInject: false,
    seatSync: false,
    dispatchHints: false,
    pipelines: false,
    handoffButtons: false,
    receiptDetection: false,
    salonHints: false,
  })
  assert.deepEqual(message.dispatch, [])
  assert.deepEqual(message.pipelines, [])
  assert.deepEqual(message.cards, [])
  assert.deepEqual(message.firewallWords, [])
  assert.equal(message.seats.length, 1)
  assert.equal(message.bindings.length, 1)
  assert.equal(message.observations.length, 1)
  assert.equal(message.memory.length, 1)
  assert.equal(message.effectiveConfig, effectiveConfig)
})

test('buildStateMessage exposes only the bounded public card fields', () => {
  const features = {
    provider: true,
    autoInject: true,
    seatSync: true,
    dispatchHints: true,
    pipelines: true,
    handoffButtons: true,
    receiptDetection: true,
    salonHints: true,
  }
  const message = buildStateMessage(state({
    features,
    dispatch: [{ needs: ['代码'], roleText: '测试', skill: 'amphoreus-test', face: '测试面' }],
    pipelines: [{ name: '测试线', source: 'router', stations: [{ text: '测试', skill: 'amphoreus-test' }] }],
    cards: [{
      name: 'amphoreus-test',
      displayName: '测试',
      aliases: ['测试别名'],
      faces: ['测试面'],
      status: 'ok',
      description: 'must stay out of the bridge card',
      duties: ['测试'],
    }],
    contracts: { firewallWords: ['工艺词'] },
  }))
  assert.equal(message.features, features)
  assert.equal(message.dispatch[0]?.face, '测试面')
  assert.equal(message.pipelines[0]?.name, '测试线')
  assert.deepEqual(message.cards, [{
    name: 'amphoreus-test',
    displayName: '测试',
    aliases: ['测试别名'],
    faces: ['测试面'],
    status: 'ok',
  }])
  assert.equal('description' in (message.cards[0] ?? {}), false)
  assert.deepEqual(message.firewallWords, ['工艺词'])
})
