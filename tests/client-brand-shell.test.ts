import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BRAND_ICON_DATA_URL, BRAND_ICON_SVG, BRAND_MANIFEST, BRAND_MANIFEST_DATA_URL } from '../src/client/brand-icon.ts'
import { rebrandTitle } from '../src/client/brand-shell.ts'
import { en, zh } from '../src/client/locales.ts'

test('rebrandTitle replaces the official product title in both locales and leaves foreign titles alone', () => {
  assert.equal(rebrandTitle('DSH 本地构建', 'δ-me13'), 'δ-me13')
  assert.equal(rebrandTitle('DSH Local Build', 'δ-me13'), 'δ-me13')
  assert.equal(rebrandTitle('圆桌闲谈 — DSH 本地构建', 'δ-me13'), '圆桌闲谈 — δ-me13')
  assert.equal(rebrandTitle('Some session — DSH Local Build', 'δ-me13'), 'Some session — δ-me13')
  assert.equal(rebrandTitle('圆桌闲谈 — δ-me13', 'δ-me13'), '圆桌闲谈 — δ-me13')
  assert.equal(rebrandTitle('Unrelated Page', 'δ-me13'), 'Unrelated Page')
  assert.equal(rebrandTitle('', 'δ-me13'), '')
})

test('brand copy is δ-me13 everywhere and the icon/manifest carry no vendor residue', () => {
  assert.equal(zh['brand.name'], 'δ-me13')
  assert.equal(en['brand.name'], 'δ-me13')
  for (const dict of [zh, en]) {
    for (const [key, value] of Object.entries(dict)) {
      if (key.startsWith('settings.credit')) continue
      assert.doesNotMatch(value, /deepseek|\bDSH\b/iu, `${key}: ${value}`)
    }
  }
  assert.match(BRAND_ICON_SVG, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u)
  assert.doesNotMatch(BRAND_ICON_SVG, /deepseek|whale|dsh/iu)
  assert.ok(BRAND_ICON_DATA_URL.startsWith('data:image/svg+xml;utf8,'))
  assert.equal(BRAND_MANIFEST.name, 'δ-me13')
  assert.equal(BRAND_MANIFEST.icons[0].src, BRAND_ICON_DATA_URL)
  assert.ok(BRAND_MANIFEST_DATA_URL.startsWith('data:application/manifest+json,'))
  assert.deepEqual(JSON.parse(decodeURIComponent(BRAND_MANIFEST_DATA_URL.slice('data:application/manifest+json,'.length))), BRAND_MANIFEST)
})
