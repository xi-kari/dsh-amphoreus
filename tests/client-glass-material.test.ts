import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deriveGlassMaterial, deriveLiquidShellMaterial, type GlassMaterialInput } from '../src/client/glass-material.ts'
import { globalThemeTokens } from '../src/client/theme.ts'
import { seatThemeTokens } from '../src/client/seat-theme.ts'
import { BLACK, WHITE, composite, contrast, mix, parseHex, type Rgb } from '../src/shared/color.ts'
import { GLOBAL_GRAMMAR, seatGrammarOf } from '../src/shared/grammar.ts'
import { HERO_VISUALS } from '../src/shared/heroes.ts'

const backdrops: readonly Rgb[] = [BLACK, WHITE, [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255], [127, 127, 127]]
const alphas = ['paneAlpha', 'contentAlpha', 'inputAlpha', 'dialogAlpha'] as const
const inks = ['primary', 'secondary', 'body'] as const

function cssRgb(value: string): Rgb {
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/u.exec(value)
  assert.ok(match, value)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function themeInputs() {
  return [
    { name: 'global', tokens: globalThemeTokens(), grammar: GLOBAL_GRAMMAR },
    ...HERO_VISUALS.map(hero => ({ name: hero.heroId, tokens: seatThemeTokens(hero, { light: 0.22, dark: 0.4 }), grammar: seatGrammarOf(hero.heroId) })),
  ].flatMap(({ name, tokens, grammar }) => [false, true].map(dark => {
    const mode = dark ? 'dark' : 'light'
    const primary = cssRgb(tokens['--dsw-alias-label-primary']![mode])
    return { name: `${name}/${mode}`, input: {
      base: cssRgb(tokens['--dsw-alias-bg-layer-1']![mode]), primary,
      secondary: cssRgb(tokens['--dsw-alias-label-secondary']![mode]),
      body: mix(parseHex(grammar.ink[mode]), primary, 0.2), dark,
      frost: grammar.glass.frost, blur: grammar.glass.blurPx, wallpaper: true,
    } satisfies GlassMaterialInput }
  }))
}

test('all thirteen seats and global use actual primary, secondary and blended body ink over hostile backdrops', () => {
  const themes = themeInputs()
  assert.equal(themes.length, 28)
  for (const { name, input } of themes) {
    for (const wallpaper of [true, false]) for (const frost of [0.42, input.frost, 1]) {
      const result = deriveGlassMaterial({ ...input, wallpaper, frost })
      assert.deepEqual(result.base, input.base, `${name}: valid theme base must keep its colour`)
      assert.ok(result.floor >= (wallpaper ? input.dark ? 0.64 : 0.56 : 0.92))
      assert.ok(Math.abs(result.floor * 1000 - Math.round(result.floor * 1000)) < 1e-9)
      for (const ink of inks) {
        assert.ok(contrast(result[ink], result.base) >= 4.6, `${name}/${ink}: opaque`)
        for (const backdrop of backdrops) {
          assert.ok(contrast(result[ink], composite(result.base, result.floor, backdrop)) >= 4.6, `${name}/${ink}: floor over ${backdrop}`)
          for (const alpha of alphas) {
            const ratio = contrast(result[ink], composite(result.base, result[alpha], backdrop))
            assert.ok(ratio >= 4.6, `${name}/${wallpaper}/${frost}/${ink}/${alpha}/${backdrop}: ${ratio}`)
          }
        }
      }
    }
  }
})

test('floor is the conservative three-decimal boundary rather than an arbitrary opaque fill', () => {
  for (const { name, input } of themeInputs()) {
    const result = deriveGlassMaterial(input)
    const minimum = input.dark ? 0.64 : 0.56
    if (result.floor <= minimum) continue
    const previous = result.floor - 0.001
    assert.ok(inks.some(ink => [BLACK, WHITE].some(backdrop => contrast(result[ink], composite(result.base, previous, backdrop)) < 4.6)), `${name}: floor can be reduced`)
  }
})

test('surface hierarchy and coverage rise monotonically with frost in both wallpaper modes', () => {
  for (const { name, input } of themeInputs()) for (const wallpaper of [true, false]) {
    let previous = deriveGlassMaterial({ ...input, wallpaper, frost: 0.42 })
    for (let step = 1; step <= 20; step++) {
      const next = deriveGlassMaterial({ ...input, wallpaper, frost: 0.42 + 0.58 * step / 20 })
      assert.equal(next.floor, previous.floor)
      for (const alpha of alphas) assert.ok(next[alpha] >= previous[alpha] && next[alpha] <= 1, `${name}/${wallpaper}/${alpha}`)
      assert.ok(next.contentAlpha >= next.paneAlpha && next.inputAlpha >= next.contentAlpha)
      assert.ok(next.dialogAlpha >= next.paneAlpha)
      previous = next
    }
    const low = deriveGlassMaterial({ ...input, wallpaper, frost: 0.42 })
    assert.ok(previous.paneAlpha > low.paneAlpha, `${name}: pane responds`)
    if (!wallpaper) for (const alpha of alphas) assert.ok(previous[alpha] > low[alpha], `${name}: none ${alpha} responds`)
  }
})

test('wallpaper surfaces follow the glaze curve and none uses a stronger responsive floor', () => {
  const input = themeInputs()[0]!.input
  const glazed = deriveGlassMaterial({ ...input, frost: 0.42 })
  assert.ok(Math.abs(glazed.paneAlpha - (glazed.floor + (1 - glazed.floor) * 0.06)) < 1e-12)
  assert.equal(glazed.contentAlpha, Math.max(glazed.paneAlpha, 0.84))
  assert.equal(glazed.inputAlpha, Math.max(glazed.contentAlpha, 0.9))
  assert.equal(glazed.dialogAlpha, Math.max(glazed.paneAlpha, 0.88))
  const none = deriveGlassMaterial({ ...input, frost: 0.42, wallpaper: false })
  assert.ok(none.floor >= 0.92 && none.contentAlpha >= 0.96 && none.inputAlpha >= 0.97 && none.dialogAlpha >= 0.97)
  for (const alpha of alphas) assert.ok(none[alpha] >= glazed[alpha])
})

test('zero blur disables both filters and radius is finite and capped independently of readability', () => {
  const input = themeInputs()[0]!.input
  for (const [value, expected, dialog] of [[0, 0, 0], [-20, 0, 0], [12.5, 12.5, 16.5], [35, 35, 36], [100, 36, 36]]) {
    const result = deriveGlassMaterial({ ...input, blur: value! })
    assert.equal(result.blur, expected)
    assert.equal(result.dialogBlur, dialog)
    assert.equal(result.floor, deriveGlassMaterial(input).floor)
  }
})

test('invalid numbers and RGB input have deterministic finite fallbacks without mutating inputs', () => {
  const input = themeInputs()[0]!.input
  const stable = deriveGlassMaterial({ ...input, frost: 0.78, blur: 14 })
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, '0.9', {}]) {
    const result = deriveGlassMaterial({ ...input, frost: bad, blur: bad } as unknown as GlassMaterialInput)
    assert.deepEqual(result, stable)
  }
  const malformed = deriveGlassMaterial({ base: [NaN, -30, 600], primary: null, secondary: [Infinity, 2, 3], body: ['x'], dark: true, frost: NaN, blur: NaN, wallpaper: false } as unknown as GlassMaterialInput)
  for (const value of Object.values(malformed)) {
    if (Array.isArray(value)) assert.ok(value.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 255))
    else assert.ok(typeof value === 'number' && Number.isFinite(value))
  }
  const frozen = Object.freeze({ ...input, base: Object.freeze([...input.base]) as Rgb })
  const before = JSON.stringify(frozen)
  deriveGlassMaterial(frozen)
  assert.equal(JSON.stringify(frozen), before)
  assert.deepEqual(deriveGlassMaterial({ ...input, frost: -2 }), deriveGlassMaterial({ ...input, frost: 0.42 }))
  assert.deepEqual(deriveGlassMaterial({ ...input, frost: 5 }), deriveGlassMaterial({ ...input, frost: 1 }))
})

test('opposite and marginal RGB inputs still produce readable opaque colours and a valid floor', () => {
  for (const base of [[117, 118, 116], [255, 255, 255], [0, 0, 0], [255, 0, 255]] as const) for (const dark of [false, true]) {
    const result = deriveGlassMaterial({ base, primary: base, secondary: base, body: base, dark, frost: 0.42, blur: 14, wallpaper: true })
    assert.ok(result.floor >= 0 && result.floor <= 1)
    for (const ink of inks) for (const backdrop of backdrops) assert.ok(contrast(result[ink], composite(result.base, result.floor, backdrop)) >= 4.6)
  }
})

test('the white specular sheen preserves actual ink contrast without changing the surface coverage', () => {
  for (const { name, input } of themeInputs()) for (const wallpaper of [false, true]) for (const frost of [.42, input.frost, 1]) {
    const result = deriveGlassMaterial({ ...input, wallpaper, frost })
    assert.ok(Number.isFinite(result.sheenAlpha) && result.sheenAlpha >= 0 && result.sheenAlpha <= (input.dark ? .055 : .12), name)
    for (const alpha of alphas) for (const backdrop of backdrops) for (const weight of [0, .25, .45, 1]) {
      const surface = composite(WHITE, result.sheenAlpha * weight, composite(result.base, result[alpha], backdrop))
      for (const ink of inks) assert.ok(contrast(result[ink], surface) >= 4.6, `${name}/${wallpaper}/${frost}/${alpha}/${ink}/sheen${weight}`)
    }
    assert.deepEqual(result.base, input.base)
  }
})

test('the sheen remains finite for marginal theme colours and is lower in dark glass', () => {
  const light = deriveGlassMaterial(themeInputs().find(item => item.name === 'aglaea/light')!.input)
  const dark = deriveGlassMaterial(themeInputs().find(item => item.name === 'aglaea/dark')!.input)
  assert.ok(light.sheenAlpha > dark.sheenAlpha)
  assert.ok(dark.sheenAlpha > 0)
  for (const base of [[117, 118, 116], [255, 255, 255], [0, 0, 0], [255, 0, 255]] as const) {
    const result = deriveGlassMaterial({ base, primary: base, secondary: base, body: base, dark: true, frost: .42, blur: 0, wallpaper: true })
    assert.ok(Number.isFinite(result.sheenAlpha))
    for (const backdrop of backdrops) for (const ink of inks) {
      assert.ok(contrast(result[ink], composite(WHITE, result.sheenAlpha, composite(result.base, result.paneAlpha, backdrop))) >= 4.6)
    }
  }
})

test('clear shells use stronger local ink and readable thin glass for every seat and scheme', () => {
  for (const { name, input } of themeInputs()) {
    const old = deriveGlassMaterial(input)
    const shell = deriveLiquidShellMaterial(input)
    assert.deepEqual(shell.base, input.base, `${name}: retain valid base colour`)
    assert.ok(contrast(shell.primary, shell.base) >= 10, `${name}: primary strength`)
    assert.ok(contrast(shell.secondary, shell.base) >= 8.5, `${name}: secondary strength`)
    assert.ok(shell.paneAlpha < old.paneAlpha, `${name}: visibly thinner than the reading material`)
    assert.ok(shell.paneAlpha <= (input.dark ? .77 : .72), `${name}: ${shell.paneAlpha}`)
    for (const alpha of [shell.floor, shell.paneAlpha, shell.inputAlpha, shell.dialogAlpha]) {
      for (const backdrop of backdrops) for (const sheen of [0, shell.sheenAlpha / 2, shell.sheenAlpha]) {
        const surface = composite(WHITE, sheen, composite(shell.base, alpha, backdrop))
        for (const ink of [shell.primary, shell.secondary]) assert.ok(contrast(ink, surface) >= 4.6, `${name}/${alpha}/${sheen}/${backdrop}`)
      }
    }
    assert.deepEqual(deriveGlassMaterial(input), old, `${name}: separate reading material`)
  }
})

test('clear shell coverage is the safe minimum plus a small user-controlled glaze', () => {
  for (const { name, input } of themeInputs()) {
    const low = deriveLiquidShellMaterial({ ...input, frost: .42 })
    const high = deriveLiquidShellMaterial({ ...input, frost: 1 })
    assert.equal(high.floor, low.floor)
    assert.ok(Math.abs(low.floor * 1000 - Math.round(low.floor * 1000)) < 1e-9)
    const unsafe = low.floor - .001
    assert.ok([BLACK, WHITE].some(backdrop => [0, low.sheenAlpha].some(sheen => {
      const surface = composite(WHITE, sheen, composite(low.base, unsafe, backdrop))
      return [low.primary, low.secondary].some(ink => contrast(ink, surface) < 4.6)
    })), `${name}: unnecessary coverage`)
    for (const key of ['paneAlpha', 'inputAlpha', 'dialogAlpha'] as const) {
      assert.ok(high[key] > low[key] && high[key] - low[key] < .03, `${name}/${key}: small responsive glaze`)
      assert.equal(deriveLiquidShellMaterial({ ...input, wallpaper: false })[key], 1, `${name}/${key}: opaque without a backdrop`)
    }
    assert.ok(low.paneAlpha <= low.inputAlpha && low.inputAlpha <= low.dialogAlpha)
  }
})

test('clear shells sanitize malformed colours and scales without mutating input', () => {
  const input = themeInputs()[0]!.input
  const stable = deriveLiquidShellMaterial({ ...input, frost: .78 })
  for (const frost of [NaN, Infinity, -Infinity, null, undefined, '1', {}]) {
    assert.deepEqual(deriveLiquidShellMaterial({ ...input, frost } as unknown as GlassMaterialInput), stable)
  }
  const malformed = [null, undefined, {},
    { base: [NaN, -30, 600], primary: null, secondary: [Infinity, 2, 3], body: ['x'], dark: true, frost: NaN },
    ...[[117, 118, 116], [255, 255, 255], [0, 0, 0], [255, 0, 255]].map(base => ({ base, primary: base, secondary: base, body: base })),
  ]
  for (const source of malformed) for (const dark of [false, true]) for (const wallpaper of [false, true]) {
    const value = source == null ? source : { ...source, dark, wallpaper }
    const result = deriveLiquidShellMaterial(value as unknown as GlassMaterialInput)
    for (const field of Object.values(result)) {
      if (Array.isArray(field)) assert.ok(field.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 255))
      else assert.ok(typeof field === 'number' && Number.isFinite(field) && field >= 0 && field <= 1)
    }
    for (const backdrop of backdrops) for (const sheen of [0, result.sheenAlpha]) {
      const surface = composite(WHITE, sheen, composite(result.base, result.paneAlpha, backdrop))
      for (const ink of [result.primary, result.secondary]) assert.ok(contrast(ink, surface) >= 4.6)
    }
  }
  const frozen = Object.freeze({ ...input, base: Object.freeze([...input.base]) as Rgb })
  const before = JSON.stringify(frozen)
  deriveLiquidShellMaterial(frozen)
  assert.equal(JSON.stringify(frozen), before)
  assert.deepEqual(deriveLiquidShellMaterial({ ...input, frost: -2 }), deriveLiquidShellMaterial({ ...input, frost: .42 }))
  assert.deepEqual(deriveLiquidShellMaterial({ ...input, frost: 4 }), deriveLiquidShellMaterial({ ...input, frost: 1 }))
})

test('stronger shell ink keeps a warm or cool hue instead of replacing it with neutral text', () => {
  const hue = (value: Rgb): number => {
    const [r, g, b] = value
    const spread = Math.max(...value) - Math.min(...value)
    assert.ok(spread > 8, 'source colour stays chromatic')
    const sector = Math.max(...value) === r ? (g - b) / spread : Math.max(...value) === g ? (b - r) / spread + 2 : (r - g) / spread + 4
    return (sector * 60 + 360) % 360
  }
  for (const sample of [
    { dark: false, base: [247, 242, 237] as const, ink: [125, 76, 38] as const },
    { dark: true, base: [18, 22, 30] as const, ink: [131, 181, 224] as const },
  ]) {
    const result = deriveLiquidShellMaterial({ ...sample, primary: sample.ink, secondary: sample.ink, body: sample.ink, frost: .78, blur: 12, wallpaper: true })
    for (const ink of [result.primary, result.secondary]) {
      const distance = Math.abs(hue(ink) - hue(sample.ink))
      assert.ok(Math.min(distance, 360 - distance) < 3)
    }
  }
})
