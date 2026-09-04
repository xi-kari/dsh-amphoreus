import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BLACK,
  composite,
  contrast,
  ensureContrast,
  luminance,
  mix,
  parseHex,
  rgb,
  rgba,
  toHex,
  WHITE,
} from '../src/shared/color.ts'
import {
  CSS_COLOR_VALUE_RE,
  DSW_ALIAS_TOKENS,
  DSW_BRIDGED_TOKENS,
  DSW_SPECIFIC_TOKENS,
  DSW_TOKEN_NAME_RE,
} from '../src/shared/tokens.ts'

test('bridged token registry has the exact unique allowlisted inventory', () => {
  assert.equal(DSW_ALIAS_TOKENS.length, 77)
  assert.equal(DSW_SPECIFIC_TOKENS.length, 10)
  assert.equal(DSW_BRIDGED_TOKENS.length, 87)
  assert.equal(new Set(DSW_ALIAS_TOKENS).size, DSW_ALIAS_TOKENS.length)
  assert.equal(new Set(DSW_SPECIFIC_TOKENS).size, DSW_SPECIFIC_TOKENS.length)
  assert.equal(new Set(DSW_BRIDGED_TOKENS).size, DSW_BRIDGED_TOKENS.length)
  assert.equal(DSW_BRIDGED_TOKENS.every(token => DSW_TOKEN_NAME_RE.test(token)), true)
  assert.equal(DSW_BRIDGED_TOKENS.includes('--dsw-alias-brand-primary-new-colorprimary-new-color'), false)
  assert.equal(CSS_COLOR_VALUE_RE.test('rgba(1, 2, 3, 0.25)'), true)
  assert.equal(CSS_COLOR_VALUE_RE.test('red;position:fixed'), false)
})

test('hex parsing and CSS serialization are deterministic', () => {
  assert.deepEqual(parseHex('#abc'), [170, 187, 204])
  assert.deepEqual(parseHex('#DeB462'), [222, 180, 98])
  assert.throws(() => parseHex('deb462'), /invalid hex color/)
  assert.throws(() => parseHex('#abcd'), /invalid hex color/)
  assert.equal(toHex([222, 180, 98]), '#deb462')
  assert.equal(toHex([300, -1, 15.6]), '#ff0010')
  assert.equal(rgb([1, 2, 3]), 'rgb(1, 2, 3)')
  assert.equal(rgba([1, 2, 3], 2), 'rgba(1, 2, 3, 1)')
  assert.equal(rgba([1, 2, 3], 0.126), 'rgba(1, 2, 3, 0.13)')
})

test('mixing and compositing follow direct linear channel interpolation', () => {
  assert.deepEqual(mix([0, 10, 20], [10, 20, 30], 0.45), [5, 15, 25])
  assert.deepEqual(composite(WHITE, 0.5, BLACK), [128, 128, 128])
})

test('WCAG luminance and contrast match reference values', () => {
  assert.equal(luminance(BLACK), 0)
  assert.equal(luminance(WHITE), 1)
  assert.ok(contrast(WHITE, BLACK) >= 20.9 && contrast(WHITE, BLACK) <= 21.1)
  const grayContrast = contrast(parseHex('#777777'), WHITE)
  assert.ok(grayContrast >= 4.47 && grayContrast <= 4.49)
})

test('ensureContrast moves from the original foreground and preserves an already valid color', () => {
  const adjusted = ensureContrast(parseHex('#deb462'), WHITE, 4.5, BLACK)
  assert.ok(contrast(adjusted, WHITE) >= 4.5)
  const unchanged = ensureContrast(BLACK, WHITE, 4.5, BLACK)
  assert.equal(unchanged, BLACK)
  assert.deepEqual(unchanged, [0, 0, 0])
  assert.deepEqual(ensureContrast(WHITE, WHITE, 30, BLACK, 0.08, 1), mix(WHITE, BLACK, 0.08))
})
