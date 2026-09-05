import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import {
  LANDSCAPE_RATIO,
  MAX_HOME_WALLPAPERS,
  deriveAssets,
  selectHomeWallpapers,
  derivedHomeWallpaperPath,
  listHomeWallpapers,
  resolveGlobalWallpaperDir,
  type DeriveRuntime,
} from '../src/host/derive.ts'
import { homeWallpaperKeys, seatWallpaperCandidates } from '../src/client/seat-wallpaper.ts'
import {
  GLOBAL_HOME_DIR,
  GLOBAL_WALLPAPERS,
  HERO_VISUALS,
  HOME_WALLPAPER_ROOT,
  heroVisualById,
  homeWallpaperFile,
  homeWallpaperIndex,
  seatWallpaperUrl,
} from '../src/shared/heroes.ts'

function fakeRuntime(trace: string[]): DeriveRuntime {
  return {
    probe: async () => 'Version: synthetic',
    convert: async (_magick, _args, input) => {
      trace.push(input.toString('utf8'))
      const output = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from('x')])
      output.writeUInt32LE(output.length - 8, 4)
      return output
    },
  }
}

async function put(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value)
}

test('every seat names a distinct home wallpaper folder and file names are fixed two-digit webp', () => {
  const dirs = HERO_VISUALS.map(hero => hero.assets.homeWallpaperDir)
  assert.equal(new Set(dirs).size, 13)
  for (const dir of dirs) assert.match(dir, /壁纸$/u)
  assert.equal(homeWallpaperFile(0), 'home-00.webp')
  assert.equal(homeWallpaperFile(11), 'home-11.webp')
  assert.throws(() => homeWallpaperFile(-1), RangeError)
  assert.equal(homeWallpaperIndex(undefined, 5), 0)
  assert.equal(homeWallpaperIndex('', 5), 0)
  assert.equal(homeWallpaperIndex('session-a', 0), 0)
  const pick = homeWallpaperIndex('session-a', 4)
  assert.ok(pick >= 0 && pick < 4)
  assert.equal(homeWallpaperIndex('session-a', 4), pick, 'stable per seed')
  assert.match(derivedHomeWallpaperPath('X:/c', 'aglaea', 3), /aglaea[\\/]home-03\.webp$/u)
  assert.match(derivedHomeWallpaperPath('X:/c', '_global', 0), /_global[\\/]home-00\.webp$/u)
  assert.throws(() => derivedHomeWallpaperPath('X:/c', '../x', 0), /invalid hero id/u)
  assert.throws(() => derivedHomeWallpaperPath('X:/c', 'aglaea', MAX_HOME_WALLPAPERS), /invalid home wallpaper index/u)
})

test('home derivation scans folders by extension, sorts, caps, drops stale extras, and finds the relocated global folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-home-'))
  try {
    const assetsRoot = join(root, 'assets')
    const cacheDir = join(root, 'cache')
    const cerydra = heroVisualById('cerydra')!
    const folder = join(assetsRoot, HOME_WALLPAPER_ROOT, cerydra.assets.homeWallpaperDir)
    await put(join(folder, 'ケリュドラ_135150897.jpg'), 'k')
    await put(join(folder, 'Image_2.PNG'), 'p')
    await put(join(folder, 'notes.txt'), 'ignored')
    await put(join(folder, 'nested', 'deep.jpg'), 'ignored')
    await put(join(assetsRoot, HOME_WALLPAPER_ROOT, GLOBAL_HOME_DIR, 'group.jpeg'), 'g')
    // Relocated global wallpaper folder: 13黄金裔壁纸/昔涟壁纸 wins over the flat legacy path.
    for (const file of GLOBAL_WALLPAPERS) await put(join(assetsRoot, HOME_WALLPAPER_ROOT, '昔涟壁纸', file), `w:${file}`)

    assert.deepEqual(await listHomeWallpapers(assetsRoot, cerydra.assets.homeWallpaperDir), ['Image_2.PNG', 'ケリュドラ_135150897.jpg'])
    assert.deepEqual(await listHomeWallpapers(assetsRoot, '不存在的目录'), [])
    assert.deepEqual(await resolveGlobalWallpaperDir(assetsRoot), [HOME_WALLPAPER_ROOT, '昔涟壁纸'])
    assert.deepEqual(await resolveGlobalWallpaperDir(root), ['昔涟壁纸'], 'no folder at all → legacy flat path')

    // A stale extra from an earlier, larger folder must disappear.
    await put(join(cacheDir, 'cerydra', 'home-05.webp'), 'stale')

    const trace: string[] = []
    const progress: { kind: string; done: number; total: number; current: string }[] = []
    const result = await deriveAssets({
      assetsRoot, cacheDir, magick: 'synthetic', only: ['home', 'wallpapers'],
      onProgress: value => progress.push({ kind: value.kind, done: value.done, total: value.total, current: value.current }),
    }, fakeRuntime(trace))
    assert.equal(result.failed.length, 0)
    // cerydra ×2 + _global ×1 + cyrene ×6 (her home folder IS the relocated 昔涟壁纸) + 6 global wallpapers.
    assert.equal(result.written, 3 + GLOBAL_WALLPAPERS.length + GLOBAL_WALLPAPERS.length)
    const homeCurrents = progress.filter(item => item.kind === 'home').map(item => item.current)
    assert.deepEqual(homeCurrents.filter(item => !item.startsWith('cyrene ')),
      ['cerydra home-00.webp', 'cerydra home-01.webp', '_global home-00.webp'])
    assert.equal(homeCurrents.filter(item => item.startsWith('cyrene ')).length, GLOBAL_WALLPAPERS.length)
    assert.deepEqual(progress.filter(item => item.kind === 'wallpapers').at(-1), { kind: 'wallpapers', done: 6, total: 6, current: '_global wallpaper-5.webp' })
    assert.deepEqual((await readdir(join(cacheDir, 'cerydra'))).sort(), ['home-00.webp', 'home-01.webp'])
    assert.ok(trace.includes('w:' + GLOBAL_WALLPAPERS[0]))

    const again = await deriveAssets({ assetsRoot, cacheDir, magick: 'synthetic', only: ['home'] }, fakeRuntime(trace))
    assert.deepEqual({ written: again.written, skipped: again.skipped }, { written: 0, skipped: 3 + GLOBAL_WALLPAPERS.length })

    // Cap: 14 files → 12 derived.
    const hyacine = heroVisualById('hyacine')!
    for (let index = 0; index < 14; index += 1) {
      await put(join(assetsRoot, HOME_WALLPAPER_ROOT, hyacine.assets.homeWallpaperDir, `img-${String(index).padStart(2, '0')}.png`), 'h')
    }
    assert.equal((await listHomeWallpapers(assetsRoot, hyacine.assets.homeWallpaperDir)).length, MAX_HOME_WALLPAPERS)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('seat wallpaper candidates prefer a seeded home wallpaper, then the wide cover, then the calendar', () => {
  const anaxa = heroVisualById('anaxa')!
  const derived = ['anaxa/home-00.webp', 'anaxa/home-01.webp', 'anaxa/cover-169.webp', 'aglaea/home-00.webp', 'anaxa/card.webp']
  assert.deepEqual(homeWallpaperKeys(derived, 'anaxa'), ['anaxa/home-00.webp', 'anaxa/home-01.webp'])
  assert.deepEqual(homeWallpaperKeys(derived, 'cipher'), [])
  const noSeed = seatWallpaperCandidates(anaxa, { derived, assetsConfigured: true, derivedVersion: 7 })
  assert.deepEqual(noSeed, ['/amphoreus/derived/anaxa/home-00.webp?v=7', '/amphoreus/derived/anaxa/cover-169.webp?v=7', seatWallpaperUrl(anaxa)])
  const seeded = seatWallpaperCandidates(anaxa, { derived, assetsConfigured: false, homeSeed: 'session-xyz' })
  assert.equal(seeded.length, 2)
  assert.match(seeded[0]!, /^\/amphoreus\/derived\/anaxa\/home-0[01]\.webp$/u)
  assert.equal(seeded[0], `/amphoreus/derived/anaxa/home-${String(homeWallpaperIndex('session-xyz', 2)).padStart(2, '0')}.webp`)
  assert.deepEqual(seatWallpaperCandidates(anaxa, { derived: ['anaxa/cover-169.webp'], assetsConfigured: false }), ['/amphoreus/derived/anaxa/cover-169.webp'])
})

test('home wallpaper selection prefers every landscape (widest first) and falls back to portraits only when none exist', () => {
  assert.ok(LANDSCAPE_RATIO > 1)
  const mixed = [
    { name: 'b-portrait.jpg', width: 1000, height: 2000 },
    { name: 'a-wide.jpg', width: 3840, height: 2160 },
    { name: 'c-ultrawide.png', width: 4500, height: 2250 },
    { name: 'd-unknown.png' },
  ]
  assert.deepEqual(selectHomeWallpapers(mixed), ['c-ultrawide.png', 'a-wide.jpg'])
  assert.deepEqual(selectHomeWallpapers([{ name: 'z.png', width: 1000, height: 1800 }, { name: 'y.png', width: 700, height: 980 }]), ['y.png', 'z.png'])
  assert.deepEqual(selectHomeWallpapers([{ name: 'square.png', width: 1000, height: 1000 }]), ['square.png'], 'square counts as portrait but is the only option')
  assert.deepEqual(selectHomeWallpapers([]), [])
  // Pinned file leads regardless of shape; portraits still drop out when a landscape exists.
  assert.deepEqual(selectHomeWallpapers(mixed, 'b-portrait.jpg'), ['b-portrait.jpg', 'c-ultrawide.png', 'a-wide.jpg'])
  assert.deepEqual(selectHomeWallpapers([{ name: 'p1.jpg', width: 1, height: 2 }, { name: 'p2.jpg', width: 1, height: 2 }], 'p2.jpg'), ['p2.jpg'])
  assert.deepEqual(selectHomeWallpapers(mixed, 'missing.jpg'), ['c-ultrawide.png', 'a-wide.jpg'], 'absent pin is ignored')
  const march = heroVisualById('march7th')!
  assert.equal(march.assets.homeWallpaperPin, 'Image_1788603038879_823.jpg')
})
