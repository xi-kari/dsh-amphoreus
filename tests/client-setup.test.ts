import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { en, zh } from '../src/client/locales.ts'
import { chooseFolder, createSetupStore, digestCheck, shouldOfferSetup, watchSetupAutoOpen } from '../src/client/setup-store.ts'
import type { AmphoreusClientSnapshot } from '../src/client/state.ts'
import type { AmphoreusState, AssetsCheckReport } from '../src/shared/api.ts'

const wizardSource = readFileSync(new URL('../src/client/setup-wizard.tsx', import.meta.url), 'utf8')
const panelSource = readFileSync(new URL('../src/client/setup-panel.tsx', import.meta.url), 'utf8')
const storeSource = readFileSync(new URL('../src/client/setup-store.ts', import.meta.url), 'utf8')
const wizardCss = readFileSync(new URL('../src/client/setup-wizard.module.css', import.meta.url), 'utf8')
const clientSource = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/client/settings.tsx', import.meta.url), 'utf8')

function snapshot(options: { phase?: AmphoreusClientSnapshot['phase']; setupNeeded?: boolean; dismissedAt?: number } = {}): AmphoreusClientSnapshot {
  const phase = options.phase ?? 'ready'
  if (phase !== 'ready') return { phase, refreshing: false }
  return {
    phase,
    refreshing: false,
    state: {
      prefs: { ...(options.dismissedAt === undefined ? {} : { setupDismissedAt: options.dismissedAt }) },
      effectiveConfig: { setupNeeded: options.setupNeeded ?? true },
    } as unknown as AmphoreusState,
  }
}

class FakeModel {
  #snapshot: AmphoreusClientSnapshot
  readonly #listeners = new Set<() => void>()
  constructor(initial: AmphoreusClientSnapshot) { this.#snapshot = initial }
  getSnapshot = (): AmphoreusClientSnapshot => this.#snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }
  set(next: AmphoreusClientSnapshot): void {
    this.#snapshot = next
    for (const listener of this.#listeners) listener()
  }
}

test('setup store: stable snapshots, explicit open restarts, offer fires at most once per page', () => {
  const store = createSetupStore()
  const initial = store.getSnapshot()
  assert.deepEqual(initial, { open: false, step: 'root', offered: false })
  let changes = 0
  const dispose = store.subscribe(() => { changes += 1 })
  store.close()
  assert.equal(changes, 0, 'closing a closed store is a no-op')
  assert.equal(store.offer(), true)
  assert.deepEqual(store.getSnapshot(), { open: true, step: 'root', offered: true })
  assert.equal(store.offer(), false, 'never re-offers while open')
  store.setStep('check')
  assert.equal(store.getSnapshot().step, 'check')
  store.setStep('check')
  assert.equal(changes, 2)
  store.close()
  assert.deepEqual(store.getSnapshot(), { open: false, step: 'check', offered: true })
  assert.equal(store.offer(), false, 'never re-offers after the user closed it')
  store.open()
  assert.deepEqual(store.getSnapshot(), { open: true, step: 'root', offered: true }, 'explicit open always works and restarts')
  store.open('derive')
  assert.equal(store.getSnapshot().step, 'derive')
  dispose()
  store.close()
  assert.equal(store.getSnapshot().open, false)
})

test('auto-open gate: only ready + setupNeeded + never dismissed, and only once', () => {
  assert.equal(shouldOfferSetup(snapshot({ phase: 'loading' })), false)
  assert.equal(shouldOfferSetup(snapshot({ phase: 'error' })), false)
  assert.equal(shouldOfferSetup(snapshot({ setupNeeded: false })), false)
  assert.equal(shouldOfferSetup(snapshot({ dismissedAt: 1 })), false)
  assert.equal(shouldOfferSetup(snapshot()), true)

  const model = new FakeModel(snapshot({ phase: 'loading' }))
  const store = createSetupStore()
  const dispose = watchSetupAutoOpen(model, store)
  assert.equal(store.getSnapshot().open, false, 'nothing opens before the state is ready')
  model.set(snapshot({ setupNeeded: false }))
  assert.equal(store.getSnapshot().open, false)
  model.set(snapshot())
  assert.equal(store.getSnapshot().open, true)
  store.close()
  model.set(snapshot())
  assert.equal(store.getSnapshot().open, false, 'a later refresh never re-opens in the same page')
  dispose()

  const dismissedModel = new FakeModel(snapshot({ dismissedAt: 42 }))
  const dismissedStore = createSetupStore()
  watchSetupAutoOpen(dismissedModel, dismissedStore)()
  assert.equal(dismissedStore.getSnapshot().open, false)
  assert.equal(dismissedStore.getSnapshot().offered, false)
})

test('folder chooser degrades pick → browse → manual and forwards the start path', async () => {
  const native = await chooseFolder({ pickDirectory: async () => 'D:/assets', listDirectory: async () => { throw new Error('unused') } })
  assert.deepEqual(native, { mode: 'native', path: 'D:/assets' })
  const cancelled = await chooseFolder({ pickDirectory: async () => null, listDirectory: async () => { throw new Error('unused') } })
  assert.deepEqual(cancelled, { mode: 'native', path: null })

  const listed: (string | undefined)[] = []
  const listing = { path: '/home/me', home: '/home/me', crumbs: [{ name: '/', path: '/', hidden: false }], entries: [], truncated: false }
  const browse = await chooseFolder({
    pickDirectory: async () => { throw new Error('directory picker failed: directory-picker/unavailable') },
    listDirectory: async path => { listed.push(path); return listing },
  }, '  ')
  assert.deepEqual(browse, { mode: 'browse', listing })
  assert.deepEqual(listed, [undefined])
  await chooseFolder({ pickDirectory: async () => { throw new Error('x') }, listDirectory: async path => { listed.push(path); return listing } }, '/srv/assets')
  assert.deepEqual(listed, [undefined, '/srv/assets'])

  const manual = await chooseFolder({
    pickDirectory: async () => { throw new Error('picker down') },
    listDirectory: async () => { throw new Error('browser down') },
  })
  assert.equal(manual.mode, 'manual')
  assert.equal(manual.mode === 'manual' ? manual.reason : '', 'picker down; browser down')
})

test('check digest keeps counts and only the first missing required paths', () => {
  const report: AssetsCheckReport = {
    root: 'X:/a',
    ok: false,
    required: [
      { key: 'a', path: 'dir/a', status: 'missing' },
      { key: 'b', path: 'dir/b', status: 'ok' },
      { key: 'c', path: 'dir/c', status: 'missing' },
      { key: 'd', path: 'dir/d', status: 'large' },
      { key: 'e', path: 'dir/e', status: 'missing' },
    ],
    optional: [{ key: 'o', path: 'dir/o', status: 'optional-missing' }],
    home: [{ owner: 'x', path: 'h/x', count: 3 }, { owner: 'y', path: 'h/y', count: -1 }],
    summary: { requiredOk: 2, requiredTotal: 5, optionalOk: 0, optionalTotal: 1, large: 1, homePopulated: 1, homeTotal: 2 },
    checkedAt: 1,
  }
  assert.deepEqual(digestCheck(report, 2), {
    requiredOk: 2, requiredTotal: 5, optionalOk: 0, optionalTotal: 1, homePopulated: 1, homeTotal: 2, large: 1,
    missingRequired: ['dir/a', 'dir/c'], complete: false,
  })
  assert.deepEqual(digestCheck({ ...report, ok: true }).missingRequired, ['dir/a', 'dir/c', 'dir/e'])
  assert.equal(digestCheck({ ...report, ok: true }).complete, true)
})

test('wizard and panel are ctx-free dialogs registered inside the single shell.overlay callback', () => {
  assert.match(wizardSource, /role="dialog"/u)
  assert.match(wizardSource, /aria-modal="true"/u)
  assert.match(wizardSource, /event\.key !== 'Escape'/u)
  assert.match(wizardSource, /event\.target === event\.currentTarget\) setup\.close\(\)/u)
  assert.match(wizardSource, /if \(!open\) return null/u)
  assert.match(wizardSource, /id: 'amphoreus-setup', order: -10/u)
  assert.match(wizardSource, /model\.checkAssets\(root\)/u)
  assert.match(wizardSource, /model\.setAssetsRoot\(root\)/u)
  assert.match(wizardSource, /model\.deriveAssets\(false\)/u)
  assert.match(wizardSource, /model\.dismissSetup\(\)/u)
  assert.match(wizardSource, /assets\.magick === null/u)
  for (const source of [wizardSource, panelSource, storeSource]) {
    assert.doesNotMatch(source, /\bctx\b|fetch\(|appendChild|localStorage|EventSource/u)
  }

  const overlayStart = clientSource.indexOf("ctx.slots.inject('shell.overlay'")
  const viewStart = clientSource.indexOf("ctx.slots.inject('conversation.view'")
  const overlayBlock = clientSource.slice(overlayStart, viewStart)
  assert.match(overlayBlock, /registerSetupOverlay\(ctx\.slots/u)
  assert.match(overlayBlock, /pickDirectory: \(\) => ctx\.uiWorkspace\.pickDirectory\(\)/u)
  assert.match(overlayBlock, /listDirectory: path => ctx\.uiWorkspace\.listDirectory\(path\)/u)
  assert.equal((clientSource.match(/name: 'shell\.overlay'/g) ?? []).length, 1)
  assert.equal((clientSource.match(/const setup = createSetupStore\(\)/g) ?? []).length, 1)
  assert.match(clientSource, /watchSetupAutoOpen\(model, setup\)/u)

  const visual = settingsSource.indexOf('aria-labelledby="amphoreus-visual"')
  const workbench = settingsSource.indexOf('aria-labelledby="amphoreus-workbench"')
  const setupPanel = settingsSource.indexOf('<SetupPanel')
  assert.ok(visual < setupPanel && setupPanel < workbench)
  assert.match(settingsSource, /onRecheck=\{async \(\) => \{ await model\.checkAssets\(\) \}\}/u)
  assert.match(settingsSource, /onResetRoot=\{\(\) => model\.setAssetsRoot\(null\)\}/u)
  assert.match(panelSource, /aria-labelledby="amphoreus-setup"/u)
  assert.doesNotMatch(panelSource, /<input|<textarea/u)
})

test('setup locale keys are balanced and the wizard CSS uses only DSW tokens', () => {
  const setupKeys = Object.keys(zh).filter(key => key.startsWith('setup.'))
  assert.ok(setupKeys.length >= 40)
  for (const key of setupKeys) {
    assert.equal(typeof en[key as keyof typeof en], 'string', key)
    assert.notEqual(en[key as keyof typeof en], '')
  }
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  for (const key of [...wizardSource.matchAll(/t\('(setup\.[a-zA-Z]+)'/gu)].map(match => match[1]!)) {
    assert.ok(key in zh, key)
  }
  for (const key of [...panelSource.matchAll(/t\('(setup\.[a-zA-Z]+)'/gu)].map(match => match[1]!)) {
    assert.ok(key in zh, key)
  }
  assert.doesNotMatch(wizardCss, /#[0-9a-f]{3,8}\b|rgba?\(/iu)
  for (const declaration of wizardCss.matchAll(/(?:color|background|border-color|outline):\s*([^;]+);/gu)) {
    assert.match(declaration[1]!, /var\(--dsw-|transparent|^0$/u, declaration[0])
  }
  assert.match(wizardCss, /\.scrim \{[^}]*position: absolute;[^}]*inset: 0;[^}]*pointer-events: auto;/su)
})
