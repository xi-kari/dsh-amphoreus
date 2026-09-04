import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HERO_VISUALS } from '../src/shared/heroes.ts'
import { MOTIFS, motifDataUri, motifSvg } from '../src/shared/motifs.ts'

const motifNames = [...new Set(HERO_VISUALS.map(hero => hero.motif))].sort()

test('motif registry exactly covers every hero motif', () => {
  assert.equal(motifNames.length, 13)
  assert.deepEqual(Object.keys(MOTIFS).sort(), motifNames)
  assert.equal(Object.isFrozen(MOTIFS), true)
})

test('all motifs generate complete inert SVG tiles and CSS data URIs', () => {
  for (const motif of motifNames) {
    const svg = motifSvg(motif, { color: '#a1b2c3' })
    assert.equal(svg.startsWith('<svg'), true, motif)
    assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u, motif)
    assert.match(svg, /width="64" height="64"/u, motif)
    assert.match(svg, /viewBox="0 0 64 64"/u, motif)
    assert.match(svg, /shape-rendering="geometricPrecision"/u, motif)
    assert.match(svg, /<g stroke="#a1b2c3" fill="#a1b2c3" opacity="0\.12">/u, motif)
    assert.equal(svg.includes('<script'), false, motif)
    assert.equal(svg.includes('<foreignObject'), false, motif)
    assert.equal(/\s(?:href|src)=/iu.test(svg), false, motif)

    const uri = motifDataUri(motif, { color: '#a1b2c3' })
    assert.equal(uri.startsWith('url("data:image/svg+xml;utf8,'), true, motif)
    assert.equal(uri.endsWith('")'), true, motif)
    const decoded = decodeURIComponent(uri.slice('url("data:image/svg+xml;utf8,'.length, -2))
    assert.equal(decoded, svg, motif)
  }
})

test('motif options control tile size and opacity', () => {
  const svg = motifSvg('astrolabe', { color: '#23664d', opacity: 0.16, size: 96 })
  assert.match(svg, /width="96" height="96"/u)
  assert.match(svg, /viewBox="0 0 64 64"/u)
  assert.match(svg, /opacity="0\.16"/u)
  assert.equal((svg.match(/transform="rotate\(/gu) ?? []).length, 12)
})

test('motif inputs reject unsafe or non-finite option values', () => {
  assert.throws(() => motifSvg('stars', { color: 'red' }), /six-digit hex color/u)
  assert.throws(() => motifSvg('stars', { color: '#fff' }), /six-digit hex color/u)
  assert.throws(() => motifSvg('stars', { color: '#112233" onload="alert(1)' }), /six-digit hex color/u)
  assert.throws(() => motifSvg('stars', { color: '#112233', opacity: -0.01 }), /opacity/u)
  assert.throws(() => motifSvg('stars', { color: '#112233', opacity: Number.NaN }), /opacity/u)
  assert.throws(() => motifSvg('stars', { color: '#112233', size: 0 }), /size/u)
  assert.throws(() => motifSvg('stars', { color: '#112233', size: Number.POSITIVE_INFINITY }), /size/u)
  assert.throws(() => motifSvg('not-a-motif' as never, { color: '#112233' }), /unknown motif/u)
})
