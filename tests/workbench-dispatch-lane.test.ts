import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')

function functionSource(name: string): string {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `${name} must exist`)
  const next = source.indexOf('\nfunction ', start + marker.length)
  return source.slice(start, next === -1 ? undefined : next)
}

test('dispatch lane tolerates a null amph state and renders only for the all workspace', () => {
  const state = { amph: null, seatId: 'seat:anaxa', dispatchLaneCollapsed: false }
  const context = { state, globalThis: {} as Record<string, unknown> }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${functionSource('dispatchRecords')}\n${functionSource('renderDispatchLane')}\nglobalThis.records = dispatchRecords; globalThis.lane = renderDispatchLane`, context)
  const records = context.globalThis.records as () => unknown[]
  const lane = context.globalThis.lane as () => string

  assert.deepEqual([...records()], [])
  assert.equal(lane(), '')
  state.seatId = 'all'
  assert.match(lane(), /<aside class="dispatch-lane" aria-label="派发泳道">/u)
  assert.match(lane(), /<small>0 次派发<\/small>/u)
})

test('archived dispatches and handoff targets disappear without dropping pending live dispatches', () => {
  const state = {
    archivedSessionIds: new Set(['archived']),
    amph: { observations: [
      { kind: 'dispatch', sessionId: 'archived', parsedAt: 3 },
      { kind: 'dispatch', sessionId: 'pending', parsedAt: 2 },
      { kind: 'dispatch', sessionId: 'active', parsedAt: 1 },
      { kind: 'handoff', sessionId: 'active', status: 'accepted', acceptedSessionId: 'archived' },
      { kind: 'handoff', sessionId: 'archived', status: 'accepted', acceptedSessionId: 'downstream' },
      { kind: 'handoff', sessionId: 'archived', status: 'open', seq: 5 },
    ] },
  }
  const context = { state, globalThis: {} as Record<string, unknown> }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${functionSource('dispatchRecords')}\n${functionSource('handoffChain')}\n${functionSource('openHandoffOf')}\nglobalThis.records = dispatchRecords; globalThis.chain = handoffChain; globalThis.openHandoff = openHandoffOf`, context)
  const records = context.globalThis.records as () => { sessionId: string }[]
  const chain = context.globalThis.chain as (sessionId: string) => string[]
  const openHandoff = context.globalThis.openHandoff as (sessionId: string) => unknown

  assert.deepEqual([...records()].map(record => record.sessionId), ['pending', 'active'])
  assert.deepEqual([...chain('active')], ['active'])
  assert.deepEqual([...chain('archived')], [])
  assert.equal(openHandoff('archived'), undefined)

  state.archivedSessionIds.clear()
  assert.deepEqual([...records()].map(record => record.sessionId), ['archived', 'pending', 'active'])
  assert.deepEqual([...chain('active')], ['active', 'archived', 'downstream'])
  assert.notEqual(openHandoff('archived'), undefined)
})

test('dispatch status has exactly the three public words and never exposes the forbidden process word', () => {
  const state = {
    amph: { observations: [] as { kind: string; sessionId: string }[] },
    pendingReplies: new Map<string, unknown>(),
    liveReplies: new Map<string, unknown>(),
    sessionsById: new Map<string, { running: boolean }>(),
  }
  const context = { state, globalThis: {} as Record<string, unknown> }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${functionSource('statusOf')}\nglobalThis.statusOf = statusOf`, context)
  const statusOf = context.globalThis.statusOf as (observation: { sessionId: string }) => string
  const observation = { sessionId: 'session-a' }

  assert.equal(statusOf(observation), '已派发')
  state.pendingReplies.set(observation.sessionId, {})
  assert.equal(statusOf(observation), '进行中')
  state.pendingReplies.clear()
  state.liveReplies.set(observation.sessionId, {})
  assert.equal(statusOf(observation), '进行中')
  state.liveReplies.clear()
  state.sessionsById.set(observation.sessionId, { running: true })
  assert.equal(statusOf(observation), '进行中')
  state.sessionsById.clear()
  state.amph.observations.push({ kind: 'receipt', sessionId: observation.sessionId })
  assert.equal(statusOf(observation), '已回应')

  const statuses = new Set(['已派发', '进行中', '已回应'])
  assert.deepEqual(new Set([statusOf({ sessionId: 'other' }), statusOf(observation), '进行中']), statuses)
  assert.doesNotMatch(functionSource('statusOf'), /回执/u)
})

test('standby stations mark unresolved skills as undeployed and preserve deployed progress', () => {
  const state = {
    amph: {
      pipelines: [{
        name: '逐火线',
        stations: [
          { text: '未知站' },
          { text: '晨星', skill: 'amphoreus-testcard-a' },
        ],
      }],
    },
  }
  const context = {
    state,
    handoffChain: () => ['session-root'],
    deployedSkill: (skill: string) => skill === 'amphoreus-testcard-a',
    escapeHtml: (value: unknown) => String(value),
    globalThis: {} as Record<string, unknown>,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${functionSource('renderStandby')}\nglobalThis.renderStandby = renderStandby`, context)
  const renderStandby = context.globalThis.renderStandby as (observation: Record<string, unknown>) => string
  const html = renderStandby({ sessionId: 'session-root', pipeline: '逐火线', station: 0 })

  assert.match(html, /class="station done undeployed" title="已接通（未部署）">未知站<\/span>/u)
  assert.match(html, /class="station standby" title="待命">晨星<\/span>/u)
})

test('connectorCurve uses point coordinates without card-size offsets', () => {
  const context = { globalThis: {} as Record<string, unknown> }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${functionSource('connectorCurve')}\nglobalThis.connectorCurve = connectorCurve`, context)
  const connectorCurve = context.globalThis.connectorCurve as (fromX: number, fromY: number, toX: number, toY: number) => string

  assert.equal(connectorCurve(10, 20, 100, 80), 'M 10 20 C 46 20, 64 80, 100 80')
  assert.doesNotMatch(functionSource('connectorCurve'), /CARD_WIDTH|CARD_HEIGHT/u)
  assert.match(functionSource('connectorPath'), /connectorCurve\(\s*fromPosition\.x \+ CARD_WIDTH,/u)
})

test('dispatch edge observer has one owner and disconnects before replacement', () => {
  assert.equal(source.match(/let dispatchLaneResizeObserver\b/gu)?.length, 1)
  const disconnect = functionSource('disconnectDispatchLaneEdges')
  const install = functionSource('installDispatchLaneEdges')
  assert.match(disconnect, /dispatchLaneResizeObserver\?\.disconnect\(\)/u)
  assert.match(disconnect, /dispatchLaneResizeObserver = null/u)
  assert.ok(install.indexOf('disconnectDispatchLaneEdges()') < install.indexOf('new ResizeObserver('))
  assert.match(functionSource('render'), /disconnectDispatchLaneEdges\(\)/u)
})

test('only the first card of a dispatched session gets the dispatch badge', () => {
  const card = functionSource('conversationCard')
  assert.match(card, /card\.turnIndex === 0/u)
  assert.match(card, /observation\?\.kind === 'dispatch'/u)
  assert.match(card, /observation\.sessionId === cardThread\.dshSessionId/u)
  assert.match(card, /class="card-dispatched" title="由全体会议派发">派发<\/span>/u)
})
