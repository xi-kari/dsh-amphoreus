import assert from 'node:assert/strict'
import { test } from 'node:test'
import { en, zh } from '../src/client/locales.ts'
import { globalThemeTokens } from '../src/client/theme.ts'

test('global meeting palette uses only DSW tokens and supplies light/dark modes for every token', () => {
  const tokens = globalThemeTokens(0.22, 0.4)
  assert.ok(Object.keys(tokens).length >= 25)
  for (const [name, value] of Object.entries(tokens)) {
    assert.match(name, /^--dsw-(?:alias|specific)-/)
    assert.equal(typeof value.light, 'string')
    assert.equal(typeof value.dark, 'string')
    assert.notEqual(value.light, '')
    assert.notEqual(value.dark, '')
  }
  assert.equal(tokens['--dsw-alias-bg-base']?.light, 'rgba(244, 242, 248, 0.22)')
  assert.equal(tokens['--dsw-alias-bg-base']?.dark, 'rgba(26, 22, 49, 0.4)')
  assert.equal(tokens['--dsw-alias-label-primary']?.light, 'rgb(55, 48, 94)')
  assert.equal(tokens['--dsw-alias-brand-primary']?.light, 'rgb(138, 104, 28)')
  assert.equal(tokens['--dsw-specific-sidebar-fill']?.light, 'rgba(244, 242, 248, 0.1)')
  assert.notEqual(tokens['--dsw-alias-brand-primary']?.light, tokens['--dsw-alias-brand-primary']?.dark)
})

test('theme surface alpha is clamped and settings dictionaries remain balanced', () => {
  const tokens = globalThemeTokens(2, -1)
  assert.equal(tokens['--dsw-alias-bg-base']?.light, 'rgba(244, 242, 248, 1)')
  assert.equal(tokens['--dsw-alias-bg-base']?.dark, 'rgba(26, 22, 49, 0)')
  assert.equal(tokens['--dsw-specific-sidebar-fill']?.dark, 'rgba(26, 22, 49, 0)')
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
})
