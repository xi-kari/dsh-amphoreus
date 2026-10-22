import assert from 'node:assert/strict'
import test from 'node:test'
import { GRAMMAR_DEFAULTS } from '../src/shared/api.ts'
import { seatGrammarOf } from '../src/shared/grammar.ts'
import { GRAMMAR_WRITTEN_VARIABLES, grammarVariablesFor } from '../src/client/grammar-vars.ts'

test('switching wallpaper off and on restores the material state without retaining transparent values', () => {
  const input = { heroId: 'aglaea', dark: true, grammar: seatGrammarOf('aglaea'), prefs: GRAMMAR_DEFAULTS }
  const none = grammarVariablesFor({ ...input, wallpaperActive: false })
  const preset = grammarVariablesFor({ ...input, wallpaperActive: true })
  assert.match(none['--amph-material-ground']!, /^rgb\(/)
  assert.equal(preset['--amph-material-ground'], 'transparent')
  assert.ok(Number(none['--amph-material-pane-alpha']) > Number(preset['--amph-material-pane-alpha']))
  assert.ok(Number(none['--amph-material-input-alpha']) >= .97)
  assert.deepEqual(grammarVariablesFor({ ...input, wallpaperActive: false }), none)
  for (const name of Object.keys(none)) assert.ok(GRAMMAR_WRITTEN_VARIABLES.includes(name), `${name} is owned and disposable`)
})

test('zero blur reaches both final filters and every material colour is an opaque RGB base', () => {
  const values = grammarVariablesFor({ heroId: 'castorice', dark: false, grammar: seatGrammarOf('castorice'),
    prefs: { ...GRAMMAR_DEFAULTS, blurScale: 0 }, wallpaperActive: true, surfaceAlpha: { light: .1, dark: .7 } })
  assert.equal(values['--amph-material-filter'], 'none')
  assert.equal(values['--amph-material-dialog-filter'], 'none')
  for (const name of ['base', 'ink', 'primary', 'secondary']) assert.match(values[`--amph-material-${name}`]!, /^rgb\(/)
})

test('code alone gets readable glass over a solid ground and wallpaper remains independently transparent', () => {
  const input = { heroId: 'cerydra', dark: true, grammar: seatGrammarOf('cerydra'), prefs: GRAMMAR_DEFAULTS }
  const plain = grammarVariablesFor(input)
  const codeOnly = grammarVariablesFor({ ...input, codeBackgroundActive: true, wallpaperActive: false })
  const together = grammarVariablesFor({ ...input, codeBackgroundActive: true, wallpaperActive: true })
  assert.equal(codeOnly['--amph-material-ground'], plain['--amph-material-ground'])
  assert.equal(together['--amph-material-ground'], 'transparent')
  assert.ok(Number(codeOnly['--amph-material-pane-alpha']) < Number(plain['--amph-material-pane-alpha']))
  assert.equal(codeOnly['--amph-material-content-alpha'], together['--amph-material-content-alpha'])
  assert.deepEqual(grammarVariablesFor({ ...input, codeBackgroundActive: false, wallpaperActive: false }), plain)
})

test('liquid shell variables have independent ink, opaque fallback and complete cleanup ownership', () => {
  const input = { heroId: 'aglaea', dark: true, grammar: seatGrammarOf('aglaea'), prefs: GRAMMAR_DEFAULTS }
  const plain = grammarVariablesFor(input)
  const backdrop = grammarVariablesFor({ ...input, wallpaperActive: true })
  for (const name of ['base', 'primary', 'secondary']) {
    const key = `--amph-liquid-${name}`
    assert.match(backdrop[key]!, /^rgb\(/)
    assert.ok(GRAMMAR_WRITTEN_VARIABLES.includes(key), `${key}: removed on dispose`)
  }
  for (const name of ['pane', 'input', 'dialog']) {
    const key = `--amph-liquid-${name}-alpha`
    assert.equal(plain[key], '1')
    assert.ok(Number(backdrop[key]) > 0 && Number(backdrop[key]) < .8)
    assert.ok(GRAMMAR_WRITTEN_VARIABLES.includes(key), `${key}: removed on dispose`)
  }
  assert.notEqual(backdrop['--amph-liquid-secondary'], backdrop['--amph-material-secondary'])
  assert.ok(Number(backdrop['--amph-liquid-input-alpha']) < Number(backdrop['--amph-material-input-alpha']))
  assert.equal(new Set(GRAMMAR_WRITTEN_VARIABLES).size, GRAMMAR_WRITTEN_VARIABLES.length)
})
