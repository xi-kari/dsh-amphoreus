import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { AmphoreusState } from '../src/shared/api.ts'
import type { SuiteLevel } from '../src/host/suite/types.ts'
import type { AmphoreusClientSnapshot } from '../src/client/state.ts'
import { en, zh } from '../src/client/locales.ts'
import {
  classifySuiteChange,
  countStaleSessions,
  createSuiteNoticeStore,
  SUITE_NOTICE_STORAGE_KEY,
  suiteHasNoWatcher,
  type SuiteNoticeStorage,
} from '../src/client/suite-notice-store.ts'

const bannerSource = readFileSync(new URL('../src/client/suite-notice.tsx', import.meta.url), 'utf8')
const storeSource = readFileSync(new URL('../src/client/suite-notice-store.ts', import.meta.url), 'utf8')
const bannerCss = readFileSync(new URL('../src/client/suite-notice.module.css', import.meta.url), 'utf8')
const clientSource = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')

const FIREWALL_WORDS = [
  '回执', '档位', '读取：', '逐字', '锚点', 'pageid', 'revid', 'content_sha256', 'voice_id', '缺答',
  '完成数', '证据回查', 'module_unavailable', '移交物', '风格税', '深度门', '升档', '降档', '盲评', 'rubric',
]

interface StateOptions {
  readonly sha?: string | undefined
  readonly level?: SuiteLevel
  readonly generation?: number
  readonly parsedAt?: number
  readonly diagnostics?: number
  /** Diagnostic code for every generated diagnostic (default router-missing). */
  readonly diagnosticCode?: 'router-missing' | 'root-missing' | 'parse-exception'
  readonly label?: string
  readonly bindings?: readonly {
    readonly state: 'pending' | 'done' | 'skipped' | 'failed'
    readonly boundAt: number
    readonly at?: number
    readonly sessionId?: string
  }[]
  readonly suite?: boolean
}

function stateOf(options: StateOptions = {}): AmphoreusState {
  const generation = options.generation ?? 1
  const level = options.level ?? 'L0'
  const parsedAt = options.parsedAt ?? 1_000
  const suite = options.suite === false ? undefined : {
    parserVersion: 'test',
    parsedAt,
    generation,
    level,
    features: {} as never,
    roots: [],
    ...(options.sha === undefined ? {} : {
      fingerprint: { manifestSha256: options.sha, label: options.label ?? `label-${options.sha}`, fileCount: 3, computedAt: parsedAt },
    }),
    cards: [],
    dispatch: [],
    pipelines: [],
    diagnostics: Array.from({ length: options.diagnostics ?? 0 }, (_, index) => ({
      code: (options.diagnosticCode ?? 'router-missing') as never,
      severity: 'warn' as const,
      detail: `d${index}`,
    })),
  }
  return {
    revision: generation,
    nonce: 'n',
    suite,
    seats: [],
    seatDirs: [],
    bindings: (options.bindings ?? []).map((binding, index) => ({
      sessionId: binding.sessionId ?? `s${index}`,
      skillName: 'amphoreus-anaxa',
      boundAt: binding.boundAt,
      source: 'seat-new',
      injection: binding.at === undefined ? { state: binding.state } : { state: binding.state, at: binding.at },
    })),
    memory: [],
    observations: [],
    prefs: {} as never,
    suiteEvents: [],
    canvas: [],
    assets: {} as never,
    customWallpapers: [],
    workbench: { status: { kind: 'ready' }, unprojectable: [] },
    effectiveConfig: {} as never,
  }
}

function fakeModel(initial: AmphoreusClientSnapshot = { phase: 'loading', refreshing: false }) {
  const listeners = new Set<() => void>()
  let snapshot = initial
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish(next: AmphoreusClientSnapshot) {
      snapshot = next
      for (const listener of listeners) listener()
    },
    ready(state: AmphoreusState) {
      this.publish({ phase: 'ready', state, refreshing: false })
    },
    listenerCount: () => listeners.size,
  }
}

function fakeStorage(seed: Record<string, string> = {}): SuiteNoticeStorage & { readonly data: Map<string, string> } {
  const data = new Map(Object.entries(seed))
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) },
  }
}

test('classifySuiteChange maps level transitions to the four truthful kinds', () => {
  assert.equal(classifySuiteChange('L0', 'L0'), 'updated')
  assert.equal(classifySuiteChange('L0', 'L1'), 'degraded')
  assert.equal(classifySuiteChange('L0', 'L2'), 'degraded')
  assert.equal(classifySuiteChange('L0', 'L3'), 'missing')
  assert.equal(classifySuiteChange('L2', 'L0'), 'recovered')
  assert.equal(classifySuiteChange('L3', 'L0'), 'recovered')
  assert.equal(classifySuiteChange('L3', 'L1'), 'degraded')
})

test('no notice while loading, and the first ready state is the baseline (not an update)', () => {
  const model = fakeModel()
  const store = createSuiteNoticeStore({ model, boot: { revision: 1, level: 'L0' } })
  assert.deepEqual(store.getSnapshot(), { notices: [], active: undefined, startedMissing: false })
  model.publish({ phase: 'error', refreshing: false, error: 'x' })
  assert.equal(store.getSnapshot().active, undefined)
  model.ready(stateOf({ sha: 'aaa' }))
  assert.equal(store.getSnapshot().active, undefined)
  assert.equal(store.getSnapshot().notices.length, 0)
  // A refresh with the same state (refreshing flag flips) stays silent.
  model.publish({ phase: 'ready', state: stateOf({ sha: 'aaa' }), refreshing: true })
  assert.equal(store.getSnapshot().active, undefined)
  store.dispose()
})

test('a manifest sha change emits one updated notice with label, generation and diagnostics', () => {
  const model = fakeModel()
  const store = createSuiteNoticeStore({ model, boot: { revision: 1, level: 'L0' } })
  let changes = 0
  store.subscribe(() => { changes += 1 })
  model.ready(stateOf({ sha: 'aaa', generation: 1 }))
  assert.equal(changes, 0)
  model.ready(stateOf({ sha: 'bbb', generation: 2, label: 'abc1234 (v1.7)', parsedAt: 5_000, diagnostics: 1 }))
  assert.equal(changes, 1)
  const active = store.getSnapshot().active
  assert.ok(active !== undefined)
  assert.equal(active.kind, 'updated')
  assert.equal(active.label, 'abc1234 (v1.7)')
  assert.equal(active.generation, 2)
  assert.equal(active.level, 'L0')
  assert.equal(active.diagnosticsCount, 1)
  assert.equal(active.at, 5_000)
  assert.equal(active.id, 'updated:L0:bbb:2')
  assert.equal(store.getSnapshot().notices.length, 1)
  store.dispose()
})

test('a forced reparse with identical sha (generation bump only) is silent', () => {
  const model = fakeModel()
  const store = createSuiteNoticeStore({ model, boot: { revision: 1, level: 'L0' } })
  model.ready(stateOf({ sha: 'aaa', generation: 1 }))
  model.ready(stateOf({ sha: 'aaa', generation: 2, parsedAt: 9_000 }))
  model.ready(stateOf({ sha: 'aaa', generation: 3, parsedAt: 10_000 }))
  assert.equal(store.getSnapshot().active, undefined)
  assert.equal(store.getSnapshot().notices.length, 0)
  store.dispose()
})

test('degraded, missing and recovered transitions each emit their own kind', () => {
  const model = fakeModel()
  const store = createSuiteNoticeStore({ model, boot: { revision: 1, level: 'L0' } })
  model.ready(stateOf({ sha: 'aaa' }))

  model.ready(stateOf({ sha: 'bbb', level: 'L2', generation: 2, diagnostics: 3 }))
  assert.equal(store.getSnapshot().active?.kind, 'degraded')
  assert.equal(store.getSnapshot().active?.diagnosticsCount, 3)

  // Same sha, level flips to L3 (root vanished): level alone is a change.
  model.ready(stateOf({ sha: undefined, level: 'L3', generation: 3, suite: true }))
  assert.equal(store.getSnapshot().active?.kind, 'missing')
  assert.equal(store.getSnapshot().active?.id, 'missing:L3:none:3')
  assert.equal(store.getSnapshot().startedMissing, false, 'a root that vanished at runtime still has a watcher')

  // suite undefined entirely is treated as L3 too and is not a new notice.
  model.ready(stateOf({ suite: false, generation: 4 }))
  assert.equal(store.getSnapshot().active?.kind, 'missing')
  assert.equal(store.getSnapshot().notices.length, 2)

  model.ready(stateOf({ sha: 'ccc', level: 'L0', generation: 5, label: 'back' }))
  assert.equal(store.getSnapshot().active?.kind, 'recovered')
  assert.equal(store.getSnapshot().active?.label, 'back')
  assert.equal(store.getSnapshot().notices.length, 3)
  assert.deepEqual(store.getSnapshot().notices.map(notice => notice.kind), ['recovered', 'missing', 'degraded'])
  store.dispose()
})

test('root missing at startup: the first L3 state seeds a missing notice with a stable id, stays silent afterwards, and dismissal survives reload', () => {
  const storage = fakeStorage()
  const model = fakeModel()
  const store = createSuiteNoticeStore({ model, boot: { revision: 0, level: 'L3' }, storage })
  assert.equal(store.getSnapshot().startedMissing, true, 'boot L3 is the pre-fetch signal')
  let changes = 0
  store.subscribe(() => { changes += 1 })
  const missing = stateOf({ level: 'L3', generation: 0, diagnostics: 1, diagnosticCode: 'root-missing' })
  model.ready(missing)
  const active = store.getSnapshot().active
  assert.ok(active !== undefined, 'the only genuine-restart case must render')
  assert.equal(active.kind, 'missing')
  assert.equal(active.id, 'missing:L3:none:0')
  assert.equal(active.staleSessions, 0)
  assert.equal(store.getSnapshot().startedMissing, true, 'root-missing diagnostic confirms there is no watcher')
  assert.equal(changes, 1)
  // Without a watcher the state never changes; refreshes republish the same thing.
  model.publish({ phase: 'ready', state: missing, refreshing: true })
  model.ready(stateOf({ level: 'L3', generation: 0, diagnostics: 1, diagnosticCode: 'root-missing' }))
  assert.equal(changes, 1)
  assert.equal(store.getSnapshot().notices.length, 1)
  store.dismiss(active.id)
  assert.equal(store.getSnapshot().active, undefined)
  store.dispose()

  // Reload of the same process: identical id, still dismissed.
  const reloaded = fakeModel()
  const store2 = createSuiteNoticeStore({ model: reloaded, boot: { revision: 0, level: 'L3' }, storage })
  reloaded.ready(stateOf({ level: 'L3', generation: 0, diagnostics: 1, diagnosticCode: 'root-missing' }))
  assert.equal(store2.getSnapshot().active, undefined)
  assert.equal(store2.getSnapshot().notices.length, 1)
  store2.dispose()

  // suite undefined entirely (host store failed) with boot L3 is the same case.
  const noSuite = fakeModel()
  const store3 = createSuiteNoticeStore({ model: noSuite, boot: { revision: 0, level: 'L3' } })
  noSuite.ready(stateOf({ suite: false, generation: 0 }))
  assert.equal(store3.getSnapshot().active?.kind, 'missing')
  assert.equal(store3.getSnapshot().startedMissing, true)
  store3.dispose()
})

test('a page served after a runtime parse-exception boots L3 but keeps the watcher: startedMissing clears, reparse stays possible', () => {
  const model = fakeModel()
  const store = createSuiteNoticeStore({ model, boot: { revision: 4, level: 'L3' } })
  assert.equal(store.getSnapshot().startedMissing, true)
  const broken = stateOf({ sha: 'aaa', level: 'L3', generation: 4, diagnostics: 1, diagnosticCode: 'parse-exception' })
  model.ready(broken)
  assert.equal(store.getSnapshot().active?.kind, 'missing')
  assert.equal(store.getSnapshot().startedMissing, false, 'parse-exception is not root-missing')
  assert.equal(suiteHasNoWatcher(broken, 'L3'), false)
  assert.equal(suiteHasNoWatcher(stateOf({ level: 'L3', diagnostics: 1, diagnosticCode: 'root-missing' }), 'L0'), true)
  assert.equal(suiteHasNoWatcher(stateOf({ suite: false }), 'L3'), true)
  assert.equal(suiteHasNoWatcher(stateOf({ suite: false }), 'L0'), false)
  store.dispose()
})

test('boot level contributes to the baseline: L3 boot then L0 first fetch is a recovery; startedMissing follows the fetched state', () => {
  const model = fakeModel()
  const store = createSuiteNoticeStore({ model, boot: { revision: 1, level: 'L3' } })
  assert.equal(store.getSnapshot().startedMissing, true)
  model.ready(stateOf({ sha: 'aaa', level: 'L0' }))
  assert.equal(store.getSnapshot().active?.kind, 'recovered')
  assert.equal(store.getSnapshot().startedMissing, false)
  store.dispose()

  const loadingBoot = fakeModel()
  const store2 = createSuiteNoticeStore({ model: loadingBoot, boot: { revision: 0, level: 'loading' } })
  loadingBoot.ready(stateOf({ sha: 'aaa', level: 'L2' }))
  assert.equal(store2.getSnapshot().active, undefined, 'a loading boot level is not a baseline')
  assert.equal(store2.getSnapshot().startedMissing, false)
  store2.dispose()

  const noBoot = fakeModel({ phase: 'ready', state: stateOf({ sha: 'aaa' }), refreshing: false })
  const store3 = createSuiteNoticeStore({ model: noBoot })
  assert.equal(store3.getSnapshot().active, undefined, 'an already-ready model at creation is the baseline')
  noBoot.ready(stateOf({ sha: 'bbb', generation: 2 }))
  assert.equal(store3.getSnapshot().active?.kind, 'updated')
  store3.dispose()
})

test('dismiss hides the active notice, persists by id in storage, and survives a new store', () => {
  const storage = fakeStorage()
  const model = fakeModel()
  const store = createSuiteNoticeStore({ model, boot: { revision: 1, level: 'L0' }, storage })
  model.ready(stateOf({ sha: 'aaa' }))
  model.ready(stateOf({ sha: 'bbb', generation: 2 }))
  const id = store.getSnapshot().active?.id
  assert.equal(id, 'updated:L0:bbb:2')
  let changes = 0
  store.subscribe(() => { changes += 1 })
  store.dismiss(id!)
  assert.equal(changes, 1)
  assert.equal(store.getSnapshot().active, undefined)
  assert.equal(store.getSnapshot().notices.length, 1, 'dismissed notices stay in history')
  store.dismiss(id!)
  assert.equal(changes, 1, 'dismiss is idempotent')
  assert.deepEqual(JSON.parse(storage.data.get(SUITE_NOTICE_STORAGE_KEY)!), ['updated:L0:bbb:2'])

  // A later different sha shows again, and a revert to a dismissed sha is a fresh event (distinct generation).
  model.ready(stateOf({ sha: 'ccc', generation: 3 }))
  assert.equal(store.getSnapshot().active?.id, 'updated:L0:ccc:3')
  model.ready(stateOf({ sha: 'bbb', generation: 4 }))
  assert.equal(store.getSnapshot().active?.id, 'updated:L0:bbb:4', 'a revert is a real change and must show')
  store.dispose()

  // Page reload: same storage, fresh store; the earlier dismissal only covers its own emission.
  const reloaded = fakeModel()
  const store2 = createSuiteNoticeStore({ model: reloaded, boot: { revision: 4, level: 'L0' }, storage })
  reloaded.ready(stateOf({ sha: 'bbb', generation: 4 }))
  assert.equal(store2.getSnapshot().active, undefined, 'first ready is the baseline')
  reloaded.ready(stateOf({ sha: 'ccc', generation: 5 }))
  assert.equal(store2.getSnapshot().active?.id, 'updated:L0:ccc:5')
  store2.dismiss('updated:L0:ccc:5')
  assert.deepEqual(JSON.parse(storage.data.get(SUITE_NOTICE_STORAGE_KEY)!), ['updated:L0:bbb:2', 'updated:L0:ccc:5'])
  store2.dispose()
})

test('dismissing an updated notice never hides a later recovered notice at the same sha', () => {
  const model = fakeModel()
  const store = createSuiteNoticeStore({ model, boot: { revision: 1, level: 'L0' } })
  model.ready(stateOf({ sha: 'aaa' }))
  model.ready(stateOf({ sha: 'ccc', generation: 2 }))
  store.dismiss(store.getSnapshot().active!.id)
  model.ready(stateOf({ sha: 'ccc', level: 'L1', generation: 3, diagnostics: 1 }))
  assert.equal(store.getSnapshot().active?.kind, 'degraded')
  model.ready(stateOf({ sha: 'ccc', level: 'L0', generation: 4 }))
  assert.equal(store.getSnapshot().active?.kind, 'recovered', 'recovery confirmation must be visible')
  assert.equal(store.getSnapshot().active?.id, 'recovered:L0:ccc:4')
  store.dispose()
})

test('corrupt or throwing storage degrades to in-memory dismissal', () => {
  const corrupt = fakeStorage({ [SUITE_NOTICE_STORAGE_KEY]: '{not json' })
  const model = fakeModel()
  const store = createSuiteNoticeStore({ model, boot: { revision: 1, level: 'L0' }, storage: corrupt })
  model.ready(stateOf({ sha: 'aaa' }))
  model.ready(stateOf({ sha: 'bbb', generation: 2 }))
  assert.equal(store.getSnapshot().active?.id, 'updated:L0:bbb:2')
  store.dispose()

  const throwing: SuiteNoticeStorage = {
    getItem: () => { throw new Error('denied') },
    setItem: () => { throw new Error('denied') },
  }
  const model2 = fakeModel()
  const store2 = createSuiteNoticeStore({ model: model2, boot: { revision: 1, level: 'L0' }, storage: throwing })
  model2.ready(stateOf({ sha: 'aaa' }))
  model2.ready(stateOf({ sha: 'bbb', generation: 2 }))
  store2.dismiss('updated:L0:bbb:2')
  assert.equal(store2.getSnapshot().active, undefined)
  store2.dispose()
})

test('staleSessions counts done injections written before the parse, by injection time, excluding archived sessions', () => {
  const state = stateOf({
    sha: 'bbb',
    parsedAt: 5_000,
    bindings: [
      { state: 'done', boundAt: 1_000, at: 1_500 },
      { state: 'done', boundAt: 1_000 }, // legacy record without injection.at falls back to boundAt
      { state: 'done', boundAt: 4_999, at: 4_999 },
      { state: 'done', boundAt: 5_000, at: 5_000 },
      { state: 'done', boundAt: 6_000, at: 6_000 },
      // Opened before the parse, first message after it: the injector wrote the NEW card.
      { state: 'done', boundAt: 1_000, at: 6_000 },
      { state: 'pending', boundAt: 1_000 },
      { state: 'skipped', boundAt: 1_000, at: 1_000 },
      { state: 'failed', boundAt: 1_000, at: 1_000 },
      { state: 'done', boundAt: 1_000, at: 1_000, sessionId: 'archived-1' },
    ],
  })
  assert.equal(countStaleSessions(state), 4)
  assert.equal(countStaleSessions(state, new Set(['archived-1'])), 3)
  assert.equal(countStaleSessions(stateOf({ suite: false })), 0)

  const model = fakeModel()
  let archived: readonly string[] = []
  const store = createSuiteNoticeStore({ model, boot: { revision: 1, level: 'L0' }, archivedSessionIds: () => archived })
  model.ready(stateOf({ sha: 'aaa' }))
  model.ready(state)
  assert.equal(store.getSnapshot().active?.staleSessions, 4)
  archived = ['archived-1', 's0']
  model.ready({ ...state, suite: { ...state.suite!, generation: 3, fingerprint: { ...state.suite!.fingerprint!, manifestSha256: 'ccc' } } })
  assert.equal(store.getSnapshot().active?.staleSessions, 2, 'archived ids are read at emission time')
  store.dispose()
})

test('dispose unsubscribes from the model and drops listeners', () => {
  const model = fakeModel()
  const store = createSuiteNoticeStore({ model, boot: { revision: 1, level: 'L0' } })
  assert.equal(model.listenerCount(), 1)
  let changes = 0
  store.subscribe(() => { changes += 1 })
  model.ready(stateOf({ sha: 'aaa' }))
  store.dispose()
  assert.equal(model.listenerCount(), 0)
  model.ready(stateOf({ sha: 'bbb', generation: 2 }))
  assert.equal(changes, 0)
  assert.equal(store.getSnapshot().active, undefined)
  store.dispose()
})

test('banner source: role=status, polite live region, portal gate, no ctx/fetch/DOM escape, no firewall words', () => {
  assert.match(bannerSource, /role="status"/)
  assert.match(bannerSource, /aria-live="polite"/)
  assert.match(bannerSource, /useSyncExternalStore\(store\.subscribe, store\.getSnapshot\)/)
  assert.match(bannerSource, /useSyncExternalStore\(subscribePortal, portalOpen\)/)
  // The setup wizard is an aria-modal sibling in shell.overlay: the banner yields to it exactly like to the portal.
  assert.match(bannerSource, /useSyncExternalStore\(subscribeSetup, setupOpen\)/)
  assert.match(bannerSource, /if \(notice === undefined \|\| portalIsOpen \|\| setupIsOpen\) return null/)
  assert.match(bannerSource, /store\.dismiss\(notice\.id\)/)
  assert.match(bannerSource, /model\.reparse\(\)/)
  assert.match(bannerSource, /snapshot\.startedMissing && <span[^>]*>\{t\('suite\.restartHint'\)\}/)
  assert.match(bannerSource, /!snapshot\.startedMissing/, 'reparse is hidden when the host has no watcher')
  // A reparse failure is keyed to the notice it belongs to and never lingers under the next notice.
  assert.match(bannerSource, /setError\(\{ id: notice\.id, message: errorMessage\(reparseError\) \}\)/)
  assert.match(bannerSource, /const errorText = error\?\.id === notice\.id \? error\.message : undefined/)
  assert.match(bannerSource, /\{errorText === undefined \? null : <span className=\{css\.error\}>\{errorText\}<\/span>\}/)
  assert.doesNotMatch(bannerSource, /\bctx\b|fetch\(|appendChild|localStorage|sessionStorage|EventSource/)
  assert.doesNotMatch(storeSource, /new EventSource|fetch\(|document\./)
  for (const word of FIREWALL_WORDS) {
    assert.equal(bannerSource.includes(word), false, word)
    assert.equal(storeSource.includes(word), false, word)
  }
  for (const key of ['suite.updated', 'suite.sessionsStale', 'suite.degraded', 'suite.missing', 'suite.recovered', 'suite.restartHint', 'suite.reparse', 'suite.reparsing', 'suite.dismiss'] as const) {
    assert.equal(typeof zh[key], 'string', key)
    assert.equal(typeof en[key], 'string', key)
    assert.match(bannerSource, new RegExp(`t\\('${key.replace('.', '\\.')}'`), key)
  }
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  assert.equal(zh['suite.updated'], '技能套件已更新至 {label}，已重新解析')
  assert.equal(zh['suite.restartHint'], '启动时未找到技能根，恢复后需重启本地服务（web 进程）')
  // Brand test forbids the vendor name in locale copy; the restart hint must stay vendor-free.
  assert.doesNotMatch(zh['suite.restartHint'], /\bDSH\b/iu)
})

test('banner CSS positions absolute top-center above the portal panel using only DSW tokens', () => {
  assert.doesNotMatch(bannerCss, /#[0-9a-f]{3,8}\b/iu)
  assert.doesNotMatch(bannerCss, /rgba?\(/u)
  assert.match(bannerCss, /\.banner \{[^}]*position: absolute;[^}]*left: 50%;[^}]*z-index: 5;[^}]*pointer-events: auto;/su)
  assert.match(bannerCss, /transform: translateX\(-50%\)/)
  for (const token of bannerCss.matchAll(/var\((--[a-z0-9-]+)\)/gu)) {
    assert.match(token[1]!, /^--dsw-alias-/, token[1])
  }
})

test('index wires the store once at client-services and registers the banner inside the single shell.overlay callback', () => {
  assert.equal((clientSource.match(/const suiteNotice = createSuiteNoticeStore\(/g) ?? []).length, 1)
  assert.equal((clientSource.match(/ctx\.slots\.inject\('shell\.overlay'/g) ?? []).length, 1)
  // The list slot accepts further entries from other features; only our own registration is pinned.
  assert.ok((clientSource.match(/name: 'shell\.overlay'/g) ?? []).length >= 2)
  assert.equal((clientSource.match(/id: 'amphoreus-suite-notice'/g) ?? []).length, 1)
  const overlay = clientSource.indexOf("ctx.slots.inject('shell.overlay'")
  const view = clientSource.indexOf("ctx.slots.inject('conversation.view'")
  const block = clientSource.slice(overlay, view)
  assert.match(block, /id: 'amphoreus-suite-notice',\s*order: 10,\s*locale: NS/)
  assert.match(block, /portalOpen: \(\) => portal\.getSnapshot\(\)\.open/)
  assert.match(block, /subscribePortal: portal\.subscribe/)
  assert.match(block, /setupOpen: \(\) => setup\.getSnapshot\(\)\.open/)
  assert.match(block, /subscribeSetup: listener => setup\.subscribe\(listener\)/)
  assert.match(block, /\}, SuiteNoticeBanner\),/)
  const store = clientSource.indexOf('const suiteNotice = createSuiteNoticeStore(')
  assert.ok(store > clientSource.indexOf('const portal = createPortalStore()') && store < overlay)
  assert.match(clientSource, /boot: window\.__AMPHOREUS_BOOT__,/)
  assert.match(clientSource, /storage: safeSessionStorage\(\),/)
  assert.match(clientSource, /archivedSessionIds: \(\) => ctx\.workspaces\.list\.getSnapshot\(\)\.archivedSessionIds,/)
  assert.match(clientSource, /ctx\.effect\(\(\) => \(\) => suiteNotice\.dispose\(\), 'amphoreus: suite notice'\)/)
  assert.doesNotMatch(clientSource, /new EventSource/)
})

test('a ready state with suite undefined before the first parse (webapi answers before bridge.start) is neither missing nor a baseline', () => {
  // Host window: /amphoreus/api/state is registered before `await bridge.start()` resolves, so the first
  // fetch can carry `suite: undefined` while firstframe served `level: 'loading'`.
  const model = fakeModel()
  const store = createSuiteNoticeStore({ model, boot: { revision: 0, level: 'loading' } })
  model.ready(stateOf({ suite: false, generation: 0 }))
  assert.equal(store.getSnapshot().active, undefined, 'nothing is missing yet')
  assert.equal(store.getSnapshot().notices.length, 0)
  assert.equal(store.getSnapshot().startedMissing, false)
  // The parsed state that follows becomes the baseline: no spurious "recovered".
  model.ready(stateOf({ sha: 'aaa', level: 'L0', generation: 1 }))
  assert.equal(store.getSnapshot().active, undefined)
  assert.equal(store.getSnapshot().notices.length, 0)
  // …and real changes after that baseline still notify.
  model.ready(stateOf({ sha: 'bbb', level: 'L0', generation: 2 }))
  assert.equal(store.getSnapshot().active?.kind, 'updated')
  store.dispose()

  // Same first fetch with no boot payload at all (or an L0 boot) is treated the same way.
  const noBoot = fakeModel()
  const store2 = createSuiteNoticeStore({ model: noBoot })
  noBoot.ready(stateOf({ suite: false, generation: 0 }))
  assert.equal(store2.getSnapshot().notices.length, 0)
  noBoot.ready(stateOf({ sha: 'aaa', level: 'L0', generation: 1 }))
  assert.equal(store2.getSnapshot().notices.length, 0)
  store2.dispose()

  // Boot L3 + suite undefined is still the genuine "no root at startup" case (covered above) — unchanged.
  const missing = fakeModel()
  const store3 = createSuiteNoticeStore({ model: missing, boot: { revision: 0, level: 'L3' } })
  missing.ready(stateOf({ suite: false, generation: 0 }))
  assert.equal(store3.getSnapshot().active?.kind, 'missing')
  store3.dispose()
})

test('banner yields to the setup wizard (aria-modal sibling in shell.overlay) exactly like to the portal', () => {
  const wizardCss = readFileSync(new URL('../src/client/setup-wizard.module.css', import.meta.url), 'utf8')
  const scrimZ = Number(/\.scrim \{[^}]*z-index: (\d+);/su.exec(wizardCss)?.[1])
  const bannerZ = Number(/\.banner \{[^}]*z-index: (\d+);/su.exec(bannerCss)?.[1])
  assert.ok(Number.isFinite(scrimZ) && Number.isFinite(bannerZ))
  // The banner paints above the wizard scrim by z-index, so the pair may never be mounted together:
  // the banner returns null while the setup store reports open, and index injects that gate.
  assert.ok(bannerZ > scrimZ, 'if this flips, the setupIsOpen gate below is what keeps the wizard usable')
  assert.match(bannerSource, /readonly setupOpen: \(\) => boolean/)
  assert.match(bannerSource, /readonly subscribeSetup: \(listener: \(\) => void\) => \(\) => void/)
  assert.match(bannerSource, /portalIsOpen \|\| setupIsOpen\) return null/)
  assert.match(clientSource, /setupOpen: \(\) => setup\.getSnapshot\(\)\.open/)
  assert.match(clientSource, /subscribeSetup: listener => setup\.subscribe\(listener\)/)
})
