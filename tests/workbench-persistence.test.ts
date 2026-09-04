import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')

function probe(initialStorage: Record<string, string> = {}) {
  const storage = new Map(Object.entries(initialStorage))
  const requests: Array<{ path: string; body: unknown }> = []
  const canvasRevisions: number[] = []
  const failures: string[] = []
  let activeRequests = 0
  let maxActiveRequests = 0
  const app = { querySelector: () => null, querySelectorAll: () => [] }
  const context = {
    console,
    history: {},
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    document: { querySelector: (selector: string) => selector === '#app' ? app : null },
    window: { parent: null as unknown, location: { origin: 'http://localhost' }, setTimeout: () => 1, clearTimeout: () => {} },
    fetch: async (path: string, options: { body?: string; headers?: Record<string, string> }) => {
      requests.push({ path, body: options.body === undefined ? undefined : JSON.parse(options.body) })
      const revision = options.headers?.['x-amphoreus-canvas-revision']
      if (revision !== undefined) canvasRevisions.push(Number(revision))
      activeRequests += 1
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      await Promise.resolve()
      activeRequests -= 1
      const error = failures.shift()
      return error === undefined
        ? { ok: true, status: 200, json: async () => ({ prefs: { quickPhrases: [], quickPhrasesInitialized: true } }) }
        : { ok: false, status: 500, json: async () => ({ error }) }
    },
    globalThis: {} as Record<string, unknown>,
  }
  context.window.parent = context.window
  context.globalThis = context
  vm.createContext(context)
  const prefix = source.slice(0, source.indexOf('\nlet selectionFollowup = null'))
  vm.runInContext(`${prefix}\nrender = () => {}; globalThis.__probe = { state, hydrateBootState, canvasRecordFor, resetCardPositions, canvasDirty, rememberBranchAnchor, flushCanvasSaves, persistCardPositions, persistQuickPhrases, conversationCards }`, context)
  return {
    storage,
    requests,
    canvasRevisions,
    failNext: (message = 'write failed') => failures.push(message),
    maxActiveRequests: () => maxActiveRequests,
    workbench: context.globalThis.__probe as {
      state: {
        cardPositions: Map<string, { x: number; y: number }>
        legacyPositionKeys: Set<string>
        collapsedCardIds: Set<string>
        branchAnchors: Map<string, string>
        quickPhrases: string[]
        persistenceHydrated: boolean
        historyBySession: Map<string, unknown[]>
        historyCompleteBySession: Map<string, boolean>
        pendingReplies: Map<string, { text: string; at: number }>
        index: Map<string, { cards: unknown[] }>
      }
      hydrateBootState(value: unknown): Promise<void>
      canvasRecordFor(sessionId: string): unknown
      resetCardPositions(): void
      canvasDirty: Set<string>
      rememberBranchAnchor(sessionId: string, cardId: string): void
      flushCanvasSaves(): Promise<void>
      persistCardPositions(cardIds?: string[]): void
      persistQuickPhrases(): Promise<unknown>
      conversationCards(threads: unknown[]): Array<{ id: string; positionKey: string }>
    },
  }
}

test('boot hydration rebuilds canvas state and only preserves canonical or migrated position keys', async () => {
  const { workbench } = probe()
  const sessionId = 'session-00000000-0000-0000-0000-000000000010'
  const parentId = 'session-00000000-0000-0000-0000-000000000009'
  const canonical = `${sessionId}:turn:4`
  const migratedAlias = `${sessionId}:turn-index:0`
  await workbench.hydrateBootState({
    canvas: [{
      sessionId,
      value: {
        positions: { [canonical]: { x: 10, y: 20 }, [migratedAlias]: { x: 30, y: 40 } },
        collapsed: [canonical],
        branchAnchors: { [parentId]: 3 },
      },
    }],
    prefs: { quickPhrases: ['服务端词'], quickPhrasesInitialized: true },
  })
  const transientAlias = `${sessionId}:turn-index:1`
  const emptyCard = `${sessionId}:turn:empty`
  workbench.state.cardPositions.set(transientAlias, { x: 50, y: 60 })
  workbench.state.cardPositions.set(emptyCard, { x: 70, y: 80 })

  assert.equal(workbench.state.legacyPositionKeys.has(migratedAlias), true)
  assert.equal(workbench.state.branchAnchors.get(sessionId), `${parentId}:turn:3`)
  assert.deepEqual(Array.from(workbench.state.quickPhrases), ['服务端词'])
  assert.deepEqual(JSON.parse(JSON.stringify(workbench.canvasRecordFor(sessionId))), {
    positions: { [canonical]: { x: 10, y: 20 }, [migratedAlias]: { x: 30, y: 40 } },
    collapsed: [canonical],
    branchAnchors: { [parentId]: 3 },
  })

  workbench.resetCardPositions()
  assert.equal(workbench.state.cardPositions.size, 0)
  assert.equal(workbench.state.legacyPositionKeys.size, 0)
  assert.equal(workbench.canvasDirty.has(sessionId), true)
})

test('quick phrase migration skips a broken preferred candidate and removes both keys after success', async () => {
  const { workbench, storage, requests } = probe({
    'dsh-amphoreus:quick-phrases:v1': '{broken',
    'dsh-synapse:quick-phrases:v1': JSON.stringify(['  旧快捷词  ', '旧快捷词']),
  })
  await workbench.hydrateBootState({ canvas: [], prefs: { quickPhrases: [] } })

  assert.deepEqual(Array.from(workbench.state.quickPhrases), ['旧快捷词'])
  assert.equal(storage.has('dsh-amphoreus:quick-phrases:v1'), false)
  assert.equal(storage.has('dsh-synapse:quick-phrases:v1'), false)
  assert.deepEqual(requests, [{ path: '/amphoreus/api/prefs', body: { quickPhrases: ['旧快捷词'] } }])
})

test('a valid empty preferred legacy value is authoritative and initializes an empty preference', async () => {
  const { workbench, storage, requests } = probe({
    'dsh-amphoreus:quick-phrases:v1': '[]',
    'dsh-synapse:quick-phrases:v1': JSON.stringify(['不得回退到这里']),
  })
  await workbench.hydrateBootState({ canvas: [], prefs: { quickPhrases: [], quickPhrasesInitialized: false } })

  assert.deepEqual(Array.from(workbench.state.quickPhrases), [])
  assert.equal(storage.size, 0)
  assert.deepEqual(requests, [{ path: '/amphoreus/api/prefs', body: { quickPhrases: [] } }])
})

test('initialized empty server preferences stay empty and never consult legacy values', async () => {
  const { workbench, storage, requests } = probe({
    'dsh-amphoreus:quick-phrases:v1': JSON.stringify(['旧值']),
  })
  await workbench.hydrateBootState({ canvas: [], prefs: { quickPhrases: [], quickPhrasesInitialized: true } })

  assert.deepEqual(Array.from(workbench.state.quickPhrases), [])
  assert.equal(storage.has('dsh-amphoreus:quick-phrases:v1'), true)
  assert.deepEqual(requests, [])
})

test('pre-sentinel nonempty server preferences win and survive sentinel-upgrade failure', async () => {
  const { workbench, storage, requests, failNext } = probe({
    'dsh-amphoreus:quick-phrases:v1': JSON.stringify(['不得覆盖服务端']),
  })
  failNext('upgrade failed')
  await workbench.hydrateBootState({ canvas: [], prefs: { quickPhrases: ['升级前服务端值'], quickPhrasesInitialized: false } })

  assert.deepEqual(Array.from(workbench.state.quickPhrases), ['升级前服务端值'])
  assert.equal(storage.has('dsh-amphoreus:quick-phrases:v1'), true)
  assert.deepEqual(requests, [{ path: '/amphoreus/api/prefs', body: { quickPhrases: ['升级前服务端值'] } }])
})

test('branch anchors flush before a remount and failed canvas writes remain retryable', async () => {
  const first = probe()
  first.workbench.state.persistenceHydrated = true
  const childId = 'session-00000000-0000-0000-0000-000000000012'
  const parentId = 'session-00000000-0000-0000-0000-000000000011'
  first.workbench.rememberBranchAnchor(childId, `${parentId}:turn:8`)
  assert.equal(first.requests.length, 0)
  await first.workbench.flushCanvasSaves()
  assert.deepEqual(first.requests, [{
    path: `/amphoreus/api/canvas/${childId}`,
    body: { positions: {}, collapsed: [], branchAnchors: { [parentId]: 8 } },
  }])

  const retry = probe()
  retry.workbench.state.persistenceHydrated = true
  const cardId = `${childId}:turn:9`
  retry.workbench.state.cardPositions.set(cardId, { x: 1, y: 2 })
  retry.workbench.persistCardPositions([cardId])
  retry.failNext()
  await assert.rejects(retry.workbench.flushCanvasSaves(), /write failed/)
  assert.equal(retry.workbench.canvasDirty.has(childId), true)
  await retry.workbench.flushCanvasSaves()
  assert.equal(retry.workbench.canvasDirty.has(childId), false)
})

test('canvas and quick phrase generations are serialized in user order', async () => {
  const canvas = probe()
  canvas.workbench.state.persistenceHydrated = true
  const sessionId = 'session-00000000-0000-0000-0000-000000000013'
  const cardId = `${sessionId}:turn:1`
  canvas.workbench.state.cardPositions.set(cardId, { x: 10, y: 10 })
  canvas.workbench.persistCardPositions([cardId])
  const first = canvas.workbench.flushCanvasSaves()
  canvas.workbench.state.cardPositions.set(cardId, { x: 20, y: 20 })
  canvas.workbench.persistCardPositions([cardId])
  const second = canvas.workbench.flushCanvasSaves()
  await Promise.all([first, second])
  assert.deepEqual(canvas.requests.map(request => (request.body as { positions: Record<string, { x: number }> }).positions[cardId]?.x), [10, 20])
  assert.equal(canvas.canvasRevisions.every(revision => Number.isSafeInteger(revision) && revision >= 0), true)
  assert.ok(canvas.canvasRevisions[0]! < canvas.canvasRevisions[1]!)
  assert.equal(canvas.maxActiveRequests(), 1)

  const phrases = probe()
  phrases.workbench.state.persistenceHydrated = true
  phrases.workbench.state.quickPhrases = ['第一代']
  const saveFirst = phrases.workbench.persistQuickPhrases()
  phrases.workbench.state.quickPhrases = ['第二代']
  const saveSecond = phrases.workbench.persistQuickPhrases()
  await Promise.all([saveFirst, saveSecond])
  assert.deepEqual(phrases.requests.map(request => request.body), [
    { quickPhrases: ['第一代'] },
    { quickPhrases: ['第二代'] },
  ])
  assert.equal(phrases.maxActiveRequests(), 1)
})

test('pending cards use noncanonical ids and promote their position when a real seq arrives', () => {
  const { workbench } = probe()
  workbench.state.persistenceHydrated = true
  const sessionId = 'session-00000000-0000-0000-0000-000000000014'
  const thread = { id: sessionId, dshSessionId: sessionId, title: 'Pending', dshSessionTitle: 'Pending', parentId: null, sourceSeedLength: null, cards: [] }
  workbench.state.historyBySession.set(sessionId, [])
  workbench.state.historyCompleteBySession.set(sessionId, true)
  workbench.state.pendingReplies.set(sessionId, { text: 'question', at: 100 })
  const pending = workbench.conversationCards([thread])[0]!
  assert.equal(pending.id, `${sessionId}:pending:0`)
  workbench.state.cardPositions.set(pending.id, { x: 70, y: 80 })
  workbench.state.cardPositions.set(pending.positionKey, { x: 70, y: 80 })
  workbench.persistCardPositions([pending.id, pending.positionKey])
  assert.equal(workbench.canvasDirty.has(sessionId), false)

  workbench.state.pendingReplies.delete(sessionId)
  workbench.state.historyBySession.set(sessionId, [
    { kind: 'user', text: 'question', sourceSeq: 21, at: 100, turn: null },
    { kind: 'assistant', text: 'answer', sourceSeq: 22, at: 101, turn: 1 },
  ])
  const resolved = workbench.conversationCards([thread])[0]!
  const canonical = `${sessionId}:turn:21`
  assert.equal(resolved.id, canonical)
  assert.deepEqual(workbench.state.cardPositions.get(canonical), { x: 70, y: 80 })
  assert.equal(workbench.state.cardPositions.has(pending.id), false)
  assert.equal(workbench.canvasDirty.has(sessionId), true)
})

test('canvas persistence is batched and pointer movement performs no write', () => {
  assert.match(source, /canvasTimer = window\.setTimeout\(\(\) => \{[\s\S]*flushCanvasSaves\(\)[\s\S]*\}, 400\)/)
  assert.match(source, /canvasWrite\(sessionId, payload\.body, payload\.revision, true\)\.catch/)
  assert.match(source, /window\.addEventListener\('pagehide', flushCanvasKeepalive\)/)
  const move = source.slice(source.indexOf('const move = moveEvent =>'), source.indexOf('const stop = () =>', source.indexOf('const move = moveEvent =>')))
  assert.equal(/scheduleCanvasSave|amphoreus\/api\/canvas|\bapi\(/.test(move), false)
})

test('classic bootstrap hydrates server state before index and SSE startup', () => {
  const start = source.indexOf('async function bootWorkbench()')
  const boot = source.slice(start, source.indexOf('\nvoid bootWorkbench()', start))
  const stateRequest = boot.indexOf("api('/amphoreus/api/state')")
  const hydrate = boot.indexOf('hydrateBootState(bootState)')
  const index = boot.indexOf('refreshIndex()')
  const events = boot.indexOf('connectEvents()')
  assert.ok(stateRequest >= 0 && stateRequest < hydrate)
  assert.ok(hydrate < index && index < events)
  assert.equal(/^await /mu.test(source), false)
  assert.match(source, /void bootWorkbench\(\)/)
})
