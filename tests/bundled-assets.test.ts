import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { bundleArtwork, validateBundledAssets } from '../scripts/bundled-assets.mjs'
import { stageResourcePack } from '../scripts/package-with-assets.mjs'
import { assetsInventory } from '../src/host/assets-check.ts'
import { HERO_VISUALS, GLOBAL_WALLPAPERS, CHIMERA_STICKERS } from '../src/shared/heroes.ts'

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])
const WEBP = Buffer.from('RIFF\x04\x00\x00\x00WEBP')

function put(root: string, path: string, bytes: Buffer | string) {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, bytes)
}

function sourceFixture(root: string) {
  const assets = join(root, 'originals')
  const cache = join(root, 'cache')
  const inventory = assetsInventory()
  const images = [...inventory.required, ...inventory.optional].filter(item => !item.segments.at(-1)!.endsWith('.zip'))
  for (const image of images) put(assets, image.segments.join('/'), PNG)
  for (const hero of HERO_VISUALS) {
    for (const name of ['cover-34', 'cover-169', 'card', 'chronicle', 'sticker']) put(cache, `${hero.heroId}/${name}.webp`, WEBP)
  }
  for (let i = 0; i < GLOBAL_WALLPAPERS.length; i += 1) put(cache, `_global/wallpaper-${i}.webp`, WEBP)
  put(cache, '_global/sticker-brand.webp', WEBP)
  for (let i = 0; i < CHIMERA_STICKERS.length; i += 1) put(cache, `_global/sticker-chimera-${String(i + 1).padStart(2, '0')}.webp`, WEBP)
  put(cache, 'cyrene/home-00.webp', WEBP)
  put(assets, '黄金裔杂志_13册分册压缩包/private.zip', 'not included')
  put(assets, 'skills/SKILL.md', 'not included')
  put(cache, 'cyrene/private.webp', WEBP)
  put(cache, 'storages/amphoreus.json', '{"private":"not included"}')
  return { assets, cache, originals: images.length, derived: HERO_VISUALS.length * 5 + GLOBAL_WALLPAPERS.length + CHIMERA_STICKERS.length + 2 }
}

test('artwork staging copies only the declared images and notice and is consumable by ordinary plugin packaging', async () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-artwork-'))
  try {
    const input = sourceFixture(root)
    const output = join(root, 'artwork')
    const result = await bundleArtwork(input.assets, input.cache, output)
    assert.equal(result.originals, input.originals)
    assert.equal(result.derived, input.derived)
    const manifest = validateBundledAssets(output)!
    assert.equal(manifest.files.length, result.originals + result.derived + 1)
    assert.equal(existsSync(join(output, 'assets-preferences.json')), false)
    assert.equal(manifest.files.some(file => /SKILL|\.zip$|private|storages/u.test(file.path)), false)
    assert.ok(readFileSync(join(output, 'ASSETS-NOTICE.txt'), 'utf8').includes('本素材包'))
    const staged = await stageResourcePack(output, join(root, 'plugin-resources'))
    assert.equal(staged.originals, result.originals)
    assert.equal(staged.derived, result.derived)
    await assert.rejects(bundleArtwork(input.assets, input.cache, output), /Refusing to replace/u)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('artwork validation rejects altered image bytes and invalid file classes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-artwork-integrity-'))
  try {
    const input = sourceFixture(root)
    const output = join(root, 'artwork')
    await bundleArtwork(input.assets, input.cache, output)
    const manifest = validateBundledAssets(output)!
    put(output, 'assets-cache/cyrene/cover-34.webp', 'changed bytes')
    assert.throws(() => validateBundledAssets(output), /integrity mismatch/u)
    for (const path of ['assets/../../settings.yaml', 'assets-preferences.json', 'assets/skills/SKILL.md']) {
      writeFileSync(join(output, 'bundled-assets.json'), JSON.stringify({ ...manifest, files: [{ ...manifest.files[0], path }, ...manifest.files.slice(1)] }))
      assert.throws(() => validateBundledAssets(output), /Invalid bundled resource path|Unexpected bundled resource/u)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('artwork staging requires both source roots and rejects non-image source bytes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-artwork-input-'))
  try {
    const input = sourceFixture(root)
    const first = assetsInventory().required[0]!
    put(input.assets, first.segments.join('/'), 'not an image')
    await assert.rejects(bundleArtwork(input.assets, input.cache, join(root, 'invalid')), /Unsupported bundled image bytes/u)
    await assert.rejects(bundleArtwork(input.assets, undefined, join(root, 'missing')), /requires/u)
    assert.equal(validateBundledAssets(join(root, 'absent')), undefined)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
