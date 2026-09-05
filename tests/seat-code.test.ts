import assert from 'node:assert/strict'
import { test } from 'node:test'
import { seatCodeTokens } from '../src/client/seat-theme.ts'
import { BLACK, WHITE, composite, contrast, mix, parseHex } from '../src/shared/color.ts'
import { HERO_VISUALS } from '../src/shared/heroes.ts'
import { SHIKI_TOKEN_NAMES, rotateHue, seatCodePalette, seatUserBubble } from '../src/shared/seat-code.ts'

function rgbOf(value: string): readonly [number, number, number] {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/u.exec(value)
  assert.ok(match, value)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

test('every seat gets a nine-token code palette readable on its own code-block ground in both schemes', () => {
  for (const hero of HERO_VISUALS) {
    for (const dark of [false, true]) {
      const palette = seatCodePalette(hero.palette, dark)
      assert.deepEqual(Object.keys(palette).sort(), [...SHIKI_TOKEN_NAMES].sort())
      const base = parseHex(dark ? hero.palette.darkBase : hero.palette.lightBase)
      const ground = composite(mix(base, dark ? BLACK : WHITE, dark ? 0.25 : 0.7), 0.7, base)
      for (const name of SHIKI_TOKEN_NAMES) {
        const ratio = contrast(rgbOf(palette[name]), ground)
        const min = name === '--shiki-token-comment' ? 3.5 : 4.5
        assert.ok(ratio >= min - 0.01, `${hero.heroId} ${dark ? 'dark' : 'light'} ${name}: ${ratio.toFixed(2)} < ${min}`)
      }
      // Keyword and function must differ so code does not collapse into one hue.
      assert.notEqual(palette['--shiki-token-keyword'], palette['--shiki-token-function'], hero.heroId)
    }
  }
})

test('user bubble tints follow the seat accent2 and stay distinct per seat', () => {
  const lights = new Set(HERO_VISUALS.map(hero => seatUserBubble(hero.palette, false).fill))
  assert.ok(lights.size >= 12, 'at least twelve distinct light bubble fills')
  const aglaea = HERO_VISUALS.find(hero => hero.heroId === 'aglaea')!
  const bubble = seatUserBubble(aglaea.palette, false)
  assert.match(bubble.fill, /^rgb\(/u)
  assert.notEqual(bubble.fill, bubble.highlight)
})

test('seatCodeTokens yields light/dark pairs for the shiki tokens plus the two bubble tokens', () => {
  const hero = HERO_VISUALS.find(item => item.heroId === 'cerydra')!
  const tokens = seatCodeTokens(hero)
  assert.equal(Object.keys(tokens).length, SHIKI_TOKEN_NAMES.length + 2)
  for (const [name, value] of Object.entries(tokens)) {
    assert.match(name, /^--(?:shiki-token-|dsw-specific-bubble)/u)
    assert.equal(typeof value.light, 'string')
    assert.equal(typeof value.dark, 'string')
    assert.notEqual(value.light, value.dark, name)
  }
})

test('rotateHue keeps lightness roughly and wraps around', () => {
  const red = rotateHue([200, 40, 40], 120)
  assert.ok(red[1] > red[0] && red[1] > red[2], 'rotating red by 120° lands on green')
  assert.deepEqual(rotateHue([10, 20, 30], 360), rotateHue([10, 20, 30], 0))
})
