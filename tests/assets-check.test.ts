import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { assetsInventory, canonicalizeForContainment, checkAssets, looksLikeAssetPack, summarizeAssetsCheck } from '../src/host/assets-check.ts'
import { checkAssets as checkFromDerive } from '../src/host/derive.ts'
import { BRAND_STICKER, GLOBAL_WALLPAPERS, HERO_VISUALS, HOME_WALLPAPER_ROOT } from '../src/shared/heroes.ts'

async function put(path: string, value: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value)
}

test('inventory mirrors scripts/check-assets.mjs: 58 required, 32 optional, 14 home folders', () => {
  const inventory = assetsInventory()
  assert.equal(inventory.required.length, GLOBAL_WALLPAPERS.length + HERO_VISUALS.length * 4)
  assert.equal(inventory.required.length, 58)
  assert.equal(inventory.optional.length, 32)
  assert.equal(inventory.home.length, HERO_VISUALS.length + 1)
  assert.equal(new Set([...inventory.required, ...inventory.optional].map(entry => entry.key)).size, 90)
  assert.equal(checkFromDerive, checkAssets)
})

test('an empty, missing, or file root yields ok:false with an error and a full missing inventory', async () => {
  const empty = await checkAssets('   ')
  assert.equal(empty.ok, false)
  assert.equal(empty.error, 'assetsRoot is empty')
  assert.equal(empty.required.length, 58)
  assert.ok(empty.required.every(item => item.status === 'missing'))
  assert.ok(empty.optional.every(item => item.status === 'optional-missing'))
  assert.ok(empty.home.every(folder => folder.count === -1))
  assert.equal(summarizeAssetsCheck(empty), 'assets: assetsRoot is empty')

  const root = await mkdtemp(join(tmpdir(), 'amphoreus-check-'))
  try {
    const missing = await checkAssets(join(root, 'nope'))
    assert.equal(missing.error, 'assetsRoot does not exist')
    await put(join(root, 'file.txt'), 'x')
    const file = await checkAssets(join(root, 'file.txt'))
    assert.equal(file.error, 'assetsRoot is not a directory')
    assert.equal(file.canonical, undefined)
    const bare = await checkAssets(root)
    assert.equal(bare.error, undefined)
    assert.equal(looksLikeAssetPack(bare), false, 'a directory with no known file is not a pack')
    assert.equal(looksLikeAssetPack(file), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a populated root counts required/optional/home statuses, prefers the nested wallpaper folder, and flags large files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-check-ok-'))
  try {
    for (const name of GLOBAL_WALLPAPERS) await put(join(root, HOME_WALLPAPER_ROOT, '昔涟壁纸', name), 'w')
    const [first, ...rest] = HERO_VISUALS
    await put(join(root, '翁法罗斯英雄纪', first!.assets.chronicle), Buffer.alloc(9 * 1024 * 1024))
    await put(join(root, '翁法罗斯如我所书卡牌', first!.assets.card), 'c')
    await put(join(root, '翁法罗斯日历', first!.assets.calendar), 'c')
    await put(join(root, '表情包', first!.assets.sticker), 's')
    await put(join(root, '表情包', BRAND_STICKER), 's')
    await mkdir(join(root, '表情包', rest[0]!.assets.sticker), { recursive: true })
    // cyrene's home folder doubles as the nested global wallpaper folder, so use another seat for the home count.
    const homeSeat = rest[1]!
    await put(join(root, HOME_WALLPAPER_ROOT, homeSeat.assets.homeWallpaperDir, 'a.PNG'), 'p')
    await put(join(root, HOME_WALLPAPER_ROOT, homeSeat.assets.homeWallpaperDir, 'b.jpg'), 'p')
    await put(join(root, HOME_WALLPAPER_ROOT, homeSeat.assets.homeWallpaperDir, 'notes.txt'), 'p')
    await mkdir(join(root, HOME_WALLPAPER_ROOT, rest[0]!.assets.homeWallpaperDir), { recursive: true })

    const report = await checkAssets(root)
    assert.equal(report.error, undefined)
    assert.equal(looksLikeAssetPack(report), true)
    assert.equal(typeof report.canonical, 'string')
    assert.equal(report.ok, false)
    assert.equal(report.summary.requiredTotal, 58)
    assert.equal(report.summary.requiredOk, GLOBAL_WALLPAPERS.length + 4)
    assert.equal(report.summary.large, 1)
    assert.equal(report.summary.optionalOk, 1)
    assert.equal(report.summary.homePopulated, 2, 'cyrene folder (6 wallpapers) + the seeded seat folder')
    assert.equal(report.summary.homeTotal, 14)
    const wallpaper = report.required.find(item => item.key === 'wallpaper:0')
    assert.equal(wallpaper?.status, 'ok')
    assert.equal(wallpaper?.path, `${HOME_WALLPAPER_ROOT}/昔涟壁纸/${GLOBAL_WALLPAPERS[0]}`)
    assert.equal(report.required.find(item => item.key === `chronicle:${first!.heroId}`)?.status, 'large')
    assert.equal(report.required.find(item => item.key === `sticker:${rest[0]!.heroId}`)?.status, 'missing')
    assert.equal(report.optional.find(item => item.key === 'sticker:brand')?.status, 'ok')
    assert.equal(report.home.find(folder => folder.owner === first!.heroId)?.count, GLOBAL_WALLPAPERS.length)
    assert.equal(report.home.find(folder => folder.owner === homeSeat.heroId)?.count, 2)
    assert.equal(report.home.find(folder => folder.owner === rest[0]!.heroId)?.count, 0)
    assert.equal(report.home.find(folder => folder.owner === '_global')?.count, -1)
    assert.doesNotMatch(JSON.stringify(report), /notes\.txt|\\u0000/u)
    assert.match(summarizeAssetsCheck(report), /^assets: required 10\/58 ok, optional 1\/32 ok, large 1, home folders 2\/14 populated$/u)

    const smallLimit = await checkAssets(root, { largeBytes: 0 })
    assert.equal(smallLimit.summary.large, GLOBAL_WALLPAPERS.length + 4)
    assert.equal(smallLimit.summary.requiredOk, GLOBAL_WALLPAPERS.length + 4)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('roots overlapping the derived cache are refused in both directions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-check-cache-'))
  try {
    const cache = join(root, 'assets-cache')
    await mkdir(join(cache, 'inner'), { recursive: true })
    const inside = await checkAssets(join(cache, 'inner'), { cacheDir: cache })
    assert.equal(inside.error, 'assetsRoot must not overlap the derived cache')
    assert.equal(typeof inside.canonical, 'string')
    const outer = await checkAssets(root, { cacheDir: cache })
    assert.equal(outer.error, 'assetsRoot must not overlap the derived cache')
    const sibling = await checkAssets(root, { cacheDir: join(root, '..', 'elsewhere-cache') })
    assert.equal(sibling.error, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the cache-overlap guard canonicalises cacheDir (junction alias, missing tail) and inaccessible roots are reported, not thrown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-check-canon-'))
  try {
    const cache = join(root, 'assets-cache')
    await mkdir(cache, { recursive: true })
    const alias = join(root, 'cache-alias')
    let linked = true
    try {
      await symlink(cache, alias, 'junction')
    } catch {
      linked = false // no link privilege on this machine: skip only the alias half
    }
    if (linked) {
      const viaAlias = await checkAssets(cache, { cacheDir: alias })
      assert.equal(viaAlias.error, 'assetsRoot must not overlap the derived cache', 'an alias of the cache still overlaps after realpath')
      const aliasAsRoot = await checkAssets(alias, { cacheDir: join(cache, 'not-yet-created') })
      assert.equal(aliasAsRoot.error, 'assetsRoot must not overlap the derived cache', 'a not-yet-existing cache tail is canonicalised through its existing ancestor')
    }
    assert.equal(await canonicalizeForContainment(join(cache, 'missing', 'tail')), join(await realpath(cache), 'missing', 'tail'))

    const invalid = await checkAssets(`${root}\u0000x`)
    assert.equal(invalid.error, 'assetsRoot is not accessible')
    assert.equal(invalid.ok, false)
    assert.equal(invalid.canonical, undefined)
    assert.equal(looksLikeAssetPack(invalid), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
