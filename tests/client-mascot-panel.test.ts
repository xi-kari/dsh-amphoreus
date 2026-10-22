import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { JsxEmit, ModuleKind, transpileModule } from 'typescript'
import { GRAMMAR_DEFAULTS, WIDGET_PREF_DEFAULTS } from '../src/shared/api.ts'
import { seatGrammarOf } from '../src/shared/grammar.ts'
import { heroVisualById, heroVisualOf } from '../src/shared/heroes.ts'
import { mascotUrlFor } from '../src/client/grammar-vars.ts'
import { BRAND_ICON_DATA_URL } from '../src/client/brand-icon.ts'
import { GLOBAL_SEAT_HERO } from '../src/client/seat-model.ts'

function load() {
  const exports: Record<string, any> = {}
  const subscribed: any[] = []
  const code = transpileModule(readFileSync(new URL('../src/client/mascot-panel.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX },
  }).outputText
  const jsx = (type: unknown, props: Record<string, any>, key?: string) => ({ type, props, key })
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name === 'react') return { useSyncExternalStore: (subscribe: any, snapshot: () => any) => { subscribed.push(subscribe); return snapshot() } }
    if (name.endsWith('api.ts')) return { WIDGET_PREF_DEFAULTS }
    if (name.endsWith('heroes.ts')) return { heroVisualById, heroVisualOf }
    if (name.endsWith('seat-model.ts')) return { GLOBAL_SEAT_HERO }
    if (name.endsWith('grammar-vars.ts')) return { mascotUrlFor }
    if (name.endsWith('brand-icon.ts')) return { BRAND_ICON_DATA_URL }
    if (name.endsWith('mascot-widget.tsx')) return { MascotWidget: 'actual-widget' }
    if (name.endsWith('mascot-format.ts')) return { formatMascotData: () => ({ balance: { text: 'sentinel' } }) }
    return {}
  } })
  return { ...exports, subscribed }
}

test('overlay subscribes to all four live sources and displays only the explicitly matching role', async () => {
  const { MascotPanel, subscribed } = load()
  const grammar = { heroId: 'anaxa', dark: true, prefs: { ...GRAMMAR_DEFAULTS }, grammar: seatGrammarOf('anaxa'), assetsConfigured: false }
  const state = { effectiveConfig: { widget: WIDGET_PREF_DEFAULTS }, seats: [{ skillName: 'amphoreus-anaxa', displayName: '那刻夏' }],
    suite: { cards: [] }, bindings: [{ sessionId: 'current', skillName: 'amphoreus-anaxa' }], widget: undefined }
  let portalOpen = false, current = 'current', refreshes = 0
  const source = (snapshot: () => any) => ({ getSnapshot: snapshot, subscribe: () => () => {} })
  const props = {
    grammar: source(() => grammar), model: { ...source(() => ({ state, phase: 'ready', refreshing: false })), refreshWidget: async () => { refreshes++ } },
    sessionList: source(() => ({ current })), portal: source(() => ({ open: portalOpen })), t: (key: string) => key,
  }
  const widget = MascotPanel(props)
  assert.equal(subscribed.length, 4)
  assert.equal(widget.type, 'actual-widget')
  assert.equal(widget.props.heroKey, 'amphoreus-anaxa')
  assert.equal(widget.props.heroLabel, '那刻夏')
  assert.equal(widget.props.imageUrl, BRAND_ICON_DATA_URL)
  assert.equal(widget.props.data, undefined)
  assert.equal(refreshes, 0)
  await widget.props.onRefresh()
  assert.equal(refreshes, 1)
  current = 'ordinary'
  assert.equal(MascotPanel(props), null)
  current = 'current'; portalOpen = true
  assert.equal(MascotPanel(props), null)
  portalOpen = false; grammar.prefs.enabled = false
  assert.equal(MascotPanel(props), null)
  grammar.prefs.enabled = true; grammar.prefs.mascot = 'off'
  assert.equal(MascotPanel(props), null)
})

test('disabled preference and no active role leave the overlay empty; current conversation keys do not replay old turn bubbles', () => {
  const { MascotPanel } = load()
  const source = (value: any) => ({ getSnapshot: () => value, subscribe: () => () => {} })
  const state = { effectiveConfig: { widget: { ...WIDGET_PREF_DEFAULTS, enabled: false } }, seats: [], bindings: [] }
  const grammar = { heroId: 'anaxa', prefs: GRAMMAR_DEFAULTS, grammar: seatGrammarOf('anaxa'), dark: true }
  const props = { grammar: source(grammar), model: { ...source({ state }), refreshWidget: async () => {} }, sessionList: source({ current: undefined }), portal: source({ open: false }), t: (key: string) => key }
  assert.equal(MascotPanel(props), null)
  state.effectiveConfig.widget.enabled = true
  const first = MascotPanel(props)
  const second = MascotPanel({ ...props, sessionList: source({ current: 'next' }), model: source({ state: { ...state, bindings: [{ sessionId: 'next', skillName: 'amphoreus-anaxa' }] } }) })
  assert.notEqual(first.key, second.key)
  assert.equal(MascotPanel({ ...props, grammar: source({ ...grammar, heroId: null }) }), null)
})

test('an explicitly bound global-theme role gets its own mascot without leaking into ordinary global sessions', () => {
  const { MascotPanel } = load()
  const source = (value: any) => ({ getSnapshot: () => value, subscribe: () => () => {} })
  const state = { effectiveConfig: { widget: WIDGET_PREF_DEFAULTS }, seats: [{ skillName: 'amphoreus-cyrene', displayName: '昔涟' }],
    bindings: [{ sessionId: 'cyrene-session', skillName: 'amphoreus-cyrene' }] }
  const visual = { heroId: null, prefs: GRAMMAR_DEFAULTS, grammar: seatGrammarOf(null), dark: true,
    assetsConfigured: true, derived: ['cyrene/sticker.webp'] }
  const props = { grammar: source(visual), model: { ...source({ state }), refreshWidget: async () => {} },
    sessionList: source({ current: 'cyrene-session' }), portal: source({ open: false }), t: (key: string) => key }
  const widget = MascotPanel(props)
  assert.ok(widget)
  assert.equal(widget.props.heroKey, 'amphoreus-cyrene')
  assert.equal(widget.props.heroLabel, '昔涟')
  assert.equal(widget.props.imageUrl, '/amphoreus/derived/cyrene/sticker.webp')
  assert.equal(MascotPanel({ ...props, sessionList: source({ current: 'ordinary' }) }), null)
  assert.equal(MascotPanel({ ...props, sessionList: source({ current: undefined }) }), null)
  assert.equal(MascotPanel({ ...props, portal: source({ open: true }) }), null)
})

test('the global-theme exception does not bypass another role’s visual or binding mismatch', () => {
  const { MascotPanel } = load()
  const source = (value: any) => ({ getSnapshot: () => value, subscribe: () => () => {} })
  const state = { effectiveConfig: { widget: WIDGET_PREF_DEFAULTS }, seats: [], bindings: [{ sessionId: 'current', skillName: 'amphoreus-anaxa' }] }
  const props = { grammar: source({ heroId: null, prefs: GRAMMAR_DEFAULTS, grammar: seatGrammarOf(null), dark: true }),
    model: source({ state }), sessionList: source({ current: 'current' }), portal: source({ open: false }), t: (key: string) => key }
  assert.equal(MascotPanel(props), null)
  assert.equal(MascotPanel({ ...props, grammar: source({ heroId: 'anaxa', prefs: GRAMMAR_DEFAULTS }),
    model: source({ state: { ...state, bindings: [{ sessionId: 'current', skillName: 'amphoreus-cyrene' }] } }) }), null)
})
