import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { HERO_VISUALS } from '../src/shared/heroes.ts'
import {
  seatContrastReport,
  seatScheme,
  seatThemeTokens,
  shouldApplySeatLayer,
} from '../src/client/seat-theme.ts'
import { createSeatLayer } from '../src/client/theme.ts'
import { parseHex } from '../src/shared/color.ts'
import { DSW_BRIDGED_TOKENS } from '../src/shared/tokens.ts'

const DEFAULT_ALPHA = { light: 0.22, dark: 0.4 } as const
const PAIRS = [
  'label-primary/layer-1',
  'label-secondary/layer-1',
  'foreground/button-primary-fill',
  'brand-primary/layer-1',
] as const

test('all 13 seats produce 38 allowed light/dark tokens and 104 passing contrast rows', () => {
  let contrastRows = 0
  assert.equal(HERO_VISUALS.length, 13)
  for (const hero of HERO_VISUALS) {
    const tokens = seatThemeTokens(hero, DEFAULT_ALPHA)
    assert.equal(Object.keys(tokens).length, 38, hero.heroId)
    for (const [name, value] of Object.entries(tokens)) {
      assert.match(name, /^--dsw-(?:alias|specific)-/, `${hero.heroId}: ${name}`)
      assert.equal(DSW_BRIDGED_TOKENS.includes(name), true, `${hero.heroId}: ${name}`)
      assert.doesNotMatch(name, /^--dsw-alias-(?:state-|scrollbar-|toast-bg$|tooltip-bg$|bg-mask-|bg-skeleton$)/)
      assert.equal(typeof value.light, 'string')
      assert.equal(typeof value.dark, 'string')
      assert.notEqual(value.light, '')
      assert.notEqual(value.dark, '')
    }

    const report = seatContrastReport(hero)
    for (const scheme of [report.light, report.dark]) {
      assert.deepEqual(scheme.map(row => row.pair), PAIRS)
      for (const row of scheme) {
        contrastRows += 1
        assert.equal(row.ok, true, `${hero.heroId}: ${row.pair} = ${row.ratio}`)
        assert.ok(row.ratio >= row.min)
      }
    }
  }
  assert.equal(contrastRows, 104)
})

test('scheme synthesis uses the opposite-polarity base for readable ink', () => {
  const aglaea = HERO_VISUALS.find(hero => hero.heroId === 'aglaea')!
  const light = seatScheme({
    base: parseHex(aglaea.palette.lightBase),
    oppositeBase: parseHex(aglaea.palette.darkBase),
    accent: parseHex(aglaea.palette.accent),
    accent2: parseHex(aglaea.palette.accent2),
    dark: false,
    synthesized: false,
    surfaceAlpha: DEFAULT_ALPHA.light,
  })
  assert.equal(light['--dsw-alias-label-primary'], 'rgb(25, 21, 14)')
  assert.equal(light['--dsw-alias-brand-primary'], 'rgb(169, 137, 74)')

  const tokens = seatThemeTokens(aglaea, DEFAULT_ALPHA)
  assert.equal(tokens['--dsw-alias-bg-base']?.light, 'rgba(246, 241, 227, 0.22)')
  assert.equal(tokens['--dsw-alias-bg-base']?.dark, 'rgba(46, 38, 24, 0.4)')
})

test('seat layer excludes portal, Cyrene, disabled style, and unknown ids', () => {
  assert.equal(shouldApplySeatLayer('cyrene', true), false)
  assert.equal(shouldApplySeatLayer(null, true), false)
  assert.equal(shouldApplySeatLayer('aglaea', false), false)
  assert.equal(shouldApplySeatLayer('unknown', true), false)
  assert.equal(shouldApplySeatLayer('aglaea', true), true)
})

test('seat layer atomically replaces relevant changes and preserves selected intent', () => {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const dataset: Record<string, string> = {}
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { body: { dataset } },
  })
  try {
    const listeners = new Set<() => void>()
    let effectiveConfig = {
      seatStyle: true,
      wallpaper: { surfaceAlpha: { light: 0.22, dark: 0.4 } },
    }
    const model = {
      getSnapshot: () => ({ state: { effectiveConfig } }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    let activeLayer: object | undefined
    const calls: Array<{ source: string; count: number; record: object }> = []
    const ctx = {
      theme: {
        overrideTokens: (source: string, tokens: Record<string, unknown>) => {
          const record = {}
          activeLayer = record
          calls.push({ source, count: Object.keys(tokens).length, record })
          return () => {
            if (activeLayer === record) activeLayer = undefined
          }
        },
      },
    }
    const publish = (): void => {
      for (const listener of listeners) listener()
    }
    const layer = createSeatLayer(ctx as never, model as never)

    layer.apply('aglaea')
    assert.equal(layer.current(), 'aglaea')
    assert.equal(dataset.amphoreusSeat, 'aglaea')
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.source, 'dsh-amphoreus/seat')
    assert.equal(calls[0]?.count, 38)

    publish()
    layer.apply('aglaea')
    assert.equal(calls.length, 1, 'unchanged configuration must not replace the layer')

    effectiveConfig = { ...effectiveConfig, wallpaper: { surfaceAlpha: { light: 0.3, dark: 0.5 } } }
    publish()
    assert.equal(calls.length, 2)
    assert.equal(activeLayer, calls[1]?.record, 'old disposer must not tear down the same-source replacement')

    effectiveConfig = { ...effectiveConfig, seatStyle: false }
    publish()
    assert.equal(layer.current(), 'aglaea')
    assert.equal(activeLayer, undefined)
    assert.equal(dataset.amphoreusSeat, undefined)

    effectiveConfig = { ...effectiveConfig, seatStyle: true }
    publish()
    assert.equal(calls.length, 3)
    assert.equal(dataset.amphoreusSeat, 'aglaea')

    layer.apply('cyrene')
    assert.equal(layer.current(), 'cyrene')
    assert.equal(activeLayer, undefined)
    assert.equal(dataset.amphoreusSeat, undefined)
    assert.equal(listeners.size, 1, 'Cyrene clears only the layer, not the controller subscription')

    layer.apply(null)
    assert.equal(layer.current(), null)
    assert.equal(listeners.size, 1)
    layer.dispose()
    assert.equal(listeners.size, 0)
  } finally {
    if (oldDocument === undefined) Reflect.deleteProperty(globalThis, 'document')
    else Object.defineProperty(globalThis, 'document', oldDocument)
  }
})

test('seat bridge has exactly three iframe posts and one stable host injection', () => {
  const app = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')
  const workbench = readFileSync(new URL('../src/client/workbench.tsx', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  const api = readFileSync(new URL('../src/shared/api.ts', import.meta.url), 'utf8')

  assert.equal(app.match(/post\('amphoreus:seat-changed'/g)?.length, 3)
  assert.match(workbench, /heroId\?: string \| null/)
  assert.match(workbench, /case 'amphoreus:seat-changed':[\s\S]*setSeat\(typeof data\.heroId === 'string'/)
  assert.doesNotMatch(workbench, /setSeat\(null\)/)
  assert.equal(client.match(/const setSeat = seatLayer\.apply\.bind\(seatLayer\)/g)?.length, 1)
  assert.equal(client.match(/setSeat,/g)?.length, 1)
  assert.match(api, /interface SeatChangedMessage[\s\S]*type: 'amphoreus:seat-changed'[\s\S]*heroId: string \| null/)
})
