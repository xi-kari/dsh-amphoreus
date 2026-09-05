import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { GRAMMAR_DEFAULTS } from '../src/shared/api.ts'
import { GLOBAL_GRAMMAR, GRAMMAR_VARIABLE_NAMES, SEAT_GRAMMARS, grammarVariables, seatGrammarOf } from '../src/shared/grammar.ts'
import { HERO_VISUALS, HOME_WALLPAPER_PARKED, heroVisualById } from '../src/shared/heroes.ts'
import { GRAMMAR_WRITTEN_VARIABLES, grammarVariablesFor } from '../src/client/grammar-vars.ts'
import { seatWallpaperCandidates } from '../src/client/seat-wallpaper.ts'
import { GRAMMAR_SEAMS } from '../src/client/grammar-seams.ts'

const css = readFileSync(new URL('../src/client/grammar.css', import.meta.url), 'utf8')
const ambient = readFileSync(new URL('../src/client/grammar-ambient.css', import.meta.url), 'utf8')

test('twelve seats carry a grammar distinct from the global one; Cyrene is the global grammar', () => {
  const seats = HERO_VISUALS.filter(hero => hero.heroId !== 'cyrene')
  assert.equal(Object.keys(SEAT_GRAMMARS).length, 12)
  for (const hero of seats) {
    const grammar = seatGrammarOf(hero.heroId)
    assert.notEqual(grammar, GLOBAL_GRAMMAR, hero.heroId)
    assert.ok(grammar.styleName.length >= 2 && grammar.styleName.length <= 4, `${hero.heroId}: ${grammar.styleName}`)
    assert.match(grammar.masthead, /^CHRYSOS · No\.\d{2}$/u, hero.heroId)
    assert.equal(grammar.masthead.endsWith(String(hero.volume).padStart(2, '0')), true, `${hero.heroId} masthead volume`)
    assert.ok(grammar.glass.frost >= 0.58 && grammar.glass.frost <= 0.94, `${hero.heroId} frost ${grammar.glass.frost}`)
    assert.ok(grammar.glass.blurPx >= 0 && grammar.glass.blurPx <= 30, hero.heroId)
    assert.ok(grammar.wallpaper.dim >= 0 && grammar.wallpaper.dim <= 0.5, hero.heroId)
    assert.notEqual(grammar.ambient, 'none', hero.heroId)
  }
  assert.equal(seatGrammarOf('cyrene'), GLOBAL_GRAMMAR)
  assert.equal(seatGrammarOf(null), GLOBAL_GRAMMAR)
  assert.equal(seatGrammarOf('nobody'), GLOBAL_GRAMMAR)
})

test('the seven dimensions spread: radii, ambients, edge signatures and style names are pairwise distinct enough', () => {
  const all = [GLOBAL_GRAMMAR, ...Object.values(SEAT_GRAMMARS)]
  assert.equal(new Set(all.map(g => g.styleName)).size, all.length, 'style names unique')
  assert.equal(new Set(all.map(g => g.ambient)).size, all.length, 'ambient unique per seat')
  assert.equal(new Set(all.map(g => g.edgeLight)).size, all.length, 'edge signatures unique')
  assert.ok(new Set(all.map(g => g.radiusPx)).size >= 9, 'radius scale actually spreads')
  assert.ok(all.some(g => g.radiusPx === 0) && all.some(g => g.radiusPx >= 22))
  assert.ok(all.some(g => g.glass.rimStyle === 'dashed') && all.some(g => g.glass.rimStyle === 'double') && all.some(g => g.glass.rimStyle === 'none'))
  assert.equal(all.filter(g => g.feather).length, 1)
  assert.equal(all.filter(g => g.clip !== undefined).length, 2)
  for (const g of all) {
    assert.match(g.ink.light, /^#[0-9a-f]{6}$/u)
    assert.match(g.ink.dark, /^#[0-9a-f]{6}$/u)
    assert.notEqual(g.ink.light, g.ink.dark)
    assert.notEqual(g.composer.tintLight, g.composer.tintDark)
  }
  assert.equal(new Set(all.map(g => g.composer.tintLight)).size, all.length, 'composer paper differs per seat')
})

test('grammar variables are all --amph-*, scheme-aware, and the layer scales them by prefs with a frost floor', () => {
  for (const name of GRAMMAR_VARIABLE_NAMES) assert.match(name, /^--amph-[a-z0-9-]+$/u)
  const light = grammarVariables(GLOBAL_GRAMMAR, false, '#111111', '#222222')
  const dark = grammarVariables(GLOBAL_GRAMMAR, true, '#111111', '#222222')
  assert.notEqual(light['--amph-glass-tint'], dark['--amph-glass-tint'])
  assert.equal(light['--amph-accent'], '#111111')
  assert.equal(light['--amph-masthead'], '"CHRYSOS · No.13"')
  const castorice = seatGrammarOf('castorice')
  assert.equal(grammarVariables(castorice, false, '#000000', '#000000')['--amph-rim-width'], '0px')
  const mydei = grammarVariables(seatGrammarOf('mydei'), false, '#000000', '#000000')
  assert.match(mydei['--amph-clip']!, /^polygon\(/u)
  assert.equal(mydei['--amph-rim-style'], 'dashed')

  const scaled = grammarVariablesFor({
    heroId: 'castorice', dark: false, grammar: castorice,
    prefs: { ...GRAMMAR_DEFAULTS, frostScale: 0.6, blurScale: 2, motifScale: 0 },
  })
  assert.equal(scaled['--amph-glass-frost'], '0.42', 'frost floor holds at .42')
  assert.equal(scaled['--amph-glass-blur'], '52px')
  assert.equal(scaled['--amph-motif-url'], 'none')
  assert.equal(scaled['--amph-motif-opacity'], '0')
  for (const name of Object.keys(scaled)) assert.ok(GRAMMAR_WRITTEN_VARIABLES.includes(name), `${name} must be cleaned up on dispose`)
})

test('grammar.css is fully gated, never blurs bubbles, and every ambient name has a recipe', () => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//gu, '')
  const rules = stripped.split('}').map(chunk => chunk.trim()).filter(chunk => chunk.includes('{'))
  for (const rule of rules) {
    const selector = rule.slice(0, rule.indexOf('{')).trim()
    if (selector.startsWith('@') || selector === '') continue
    for (const part of selector.split(',')) {
      const piece = part.trim()
      if (piece === '') continue
      assert.match(piece, /^\[data-amph-grammar/u, `ungated selector: ${piece}`)
    }
  }
  const bubbleStart = stripped.indexOf('[data-amph-grammar] [data-amph-bubble] {')
  const bubble = stripped.slice(bubbleStart, stripped.indexOf('}', bubbleStart))
  assert.doesNotMatch(bubble, /backdrop-filter/u, 'bubbles must not blur (one layer per message)')
  assert.doesNotMatch(css, /#[0-9a-f]{6}\b/iu, 'grammar.css must not hardcode seat colours')
  assert.match(css, /prefers-reduced-motion: reduce/u)
  assert.match(css, /@supports not \(\(backdrop-filter/u)
  for (const grammar of [GLOBAL_GRAMMAR, ...Object.values(SEAT_GRAMMARS)]) {
    assert.match(ambient, new RegExp(`\\[data-amph-ambient='${grammar.ambient}'\\]`, 'u'), `ambient recipe missing: ${grammar.ambient}`)
  }
  assert.doesNotMatch(ambient, /backdrop-filter/u)
  for (const seam of GRAMMAR_SEAMS) assert.match(seam.attribute, /^data-amph-[a-z-]+$/u)
})

test('parked seats skip home wallpapers but keep the cover fallback; stickers stay on the heroes.ts table', () => {
  assert.deepEqual([...HOME_WALLPAPER_PARKED].sort(), ['cipher', 'mydei', 'phainon'])
  for (const heroId of HOME_WALLPAPER_PARKED) {
    const hero = heroVisualById(heroId)!
    const candidates = seatWallpaperCandidates(hero, { derived: [`${heroId}/home-00.webp`, `${heroId}/cover-169.webp`], assetsConfigured: true })
    assert.equal(candidates[0], `/amphoreus/derived/${heroId}/cover-169.webp`, heroId)
    assert.equal(candidates.some(url => url.includes('home-')), false, heroId)
  }
  const anaxa = heroVisualById('anaxa')!
  assert.match(seatWallpaperCandidates(anaxa, { derived: ['anaxa/home-00.webp'], assetsConfigured: false })[0]!, /home-00/u)
})
