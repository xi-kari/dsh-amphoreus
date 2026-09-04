import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import type { AmphoreusState } from '../src/shared/api.ts'
import { HERO_VISUALS } from '../src/shared/heroes.ts'
import { motifDataUri } from '../src/shared/motifs.ts'
import { seatMotifStyle } from '../src/client/motif.ts'
import { createWorkspacesSource } from '../src/client/workspaces-source.ts'

const appSource = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../workbench/styles.css', import.meta.url), 'utf8')

const idleSnapshot = <T>(value: T) => ({
  getSnapshot: () => value,
  subscribe: () => () => {},
})

test('workspace payload and shell helper use the same light and dark motif generator', () => {
  const state = {
    effectiveConfig: { assetsConfigured: false },
    suite: undefined,
    seatDirs: [],
    bindings: [],
    seats: HERO_VISUALS.map(visual => ({
      heroId: visual.heroId,
      skillName: visual.skill,
      hidden: false,
      displayName: visual.heroId,
      duties: [],
      status: 'deployed',
      order: visual.order,
    })),
  } as unknown as AmphoreusState
  const payload = createWorkspacesSource(
    idleSnapshot({ ids: [], byId: {} }),
    idleSnapshot({ state }),
  ).getSnapshot()

  assert.equal(payload.seats.length, 13)
  for (const visual of HERO_VISUALS) {
    const seat = payload.seats.find(candidate => candidate.heroId === visual.heroId)
    assert.equal(seat?.volume, visual.volume)
    assert.deepEqual(seat?.motif, {
      name: visual.motif,
      light: motifDataUri(visual.motif, { color: visual.palette.accent, opacity: 0.12 }),
      dark: motifDataUri(visual.motif, { color: visual.palette.accent2, opacity: 0.16 }),
    })
    assert.deepEqual(seatMotifStyle(visual.heroId, false), {
      '--amphoreus-motif-url': seat?.motif?.light,
    })
    assert.deepEqual(seatMotifStyle(visual.heroId, true), {
      '--amphoreus-motif-url': seat?.motif?.dark,
    })
  }
  assert.equal(seatMotifStyle('not-a-seat', false), undefined)
})

test('current-seat motif update is immediate and rejects non-data-uri payload values', () => {
  const start = appSource.indexOf('function seatForCurrentView()')
  const end = appSource.indexOf('\nfunction currentDshThread', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const properties = new Map<string, string>()
  const stage = { style: { setProperty: (name: string, value: string) => properties.set(name, value) } }
  const context = {
    state: {
      seatId: 'seat:anaxa',
      seats: [{ heroId: 'anaxa', motif: { light: 'url("data:image/svg+xml;utf8,LIGHT")', dark: 'url("data:image/svg+xml;utf8,DARK")' } }],
    },
    document: { querySelector: (selector: string) => selector === '.main-stage' ? stage : null },
    globalThis: {} as Record<string, unknown>,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${appSource.slice(start, end)}\nglobalThis.__motif = { motifUrlForSeat, syncCurrentMotif }`, context)
  const helper = context.globalThis.__motif as {
    motifUrlForSeat(seat: unknown, dark: boolean): string
    syncCurrentMotif(dark: boolean): void
  }

  helper.syncCurrentMotif(false)
  assert.equal(properties.get('--amphoreus-motif-url'), 'url("data:image/svg+xml;utf8,LIGHT")')
  helper.syncCurrentMotif(true)
  assert.equal(properties.get('--amphoreus-motif-url'), 'url("data:image/svg+xml;utf8,DARK")')
  assert.equal(helper.motifUrlForSeat({ motif: { light: 'url(https://example.invalid/x)', dark: 'none' } }, false), 'none')
})

test('main stage escapes the combined inline style and theme switching preserves protected views', () => {
  assert.match(appSource, /const mainStageStyle = `--seat-stage-art:[\s\S]*--amphoreus-motif-url:[\s\S]*--amphoreus-seat-accent:[\s\S]*--amphoreus-seat-accent2:/u)
  assert.match(appSource, /<section class="main-stage" style="\$\{escapeHtml\(mainStageStyle\)\}">/u)
  assert.match(appSource, /if \(!applyThemeTokensMessage\(data\)\) return\s+if \(state\.mode !== 'portal'\) \{\s+syncCurrentMotif\(data\.dark === true\)\s+if \(canReplaceView\(\)\) render\(\)\s+else deferCanvasRefresh\(\)/u)

  const portalStart = appSource.indexOf('function renderPortal()')
  const portalEnd = appSource.indexOf('\nfunction render()', portalStart)
  assert.notEqual(portalStart, -1)
  assert.notEqual(portalEnd, -1)
  assert.equal(appSource.slice(portalStart, portalEnd).includes('--amphoreus-motif-url'), false)
})

test('motif layer is below all four direct stage surfaces and existing card art remains', () => {
  assert.equal((cssSource.match(/\.main-stage::before\s*\{/gu) ?? []).length, 1)
  assert.match(cssSource, /\.main-stage::before \{[^}]*z-index: 0;[^}]*background: var\(--amphoreus-motif-url, none\) 0 0 \/ 64px 64px repeat;[^}]*opacity: \.55;[^}]*mask-image:/u)
  assert.match(cssSource, /\.main-stage > \.canvas-tabs, \.main-stage > \.detail-view, \.main-stage > \.empty-canvas, \.main-stage > \.canvas-view \{ position: relative; z-index: 1; \}/u)
  assert.equal((cssSource.match(/\.main-stage::after\s*\{/gu) ?? []).length, 1)
  assert.match(cssSource, /\.main-stage::after \{[^}]*background: var\(--seat-stage-art, none\) center \/ contain no-repeat;[^}]*transform: rotate\(6deg\); \}/u)
})
