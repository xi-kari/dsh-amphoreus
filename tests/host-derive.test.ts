import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { crc32 } from 'node:zlib'
import {
  deriveAssets,
  derivedGlobalStickerPath,
  derivedPaths,
  derivedWallpaperPath,
  probeMagick,
  type DeriveRuntime,
} from '../src/host/derive.ts'
import { BRAND_STICKER, CHIMERA_STICKERS, GLOBAL_WALLPAPERS, HERO_VISUALS } from '../src/shared/heroes.ts'

async function temporary(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'amphoreus-derive-'))
}

function fakeRuntime(trace: Array<{ args: readonly string[]; input: string }>): DeriveRuntime {
  return {
    probe: async () => 'Version: synthetic-magick 1.0',
    convert: async (_magick, args, input) => {
      const text = input.toString('utf8')
      trace.push({ args, input: text })
      if (text === 'FAIL') throw new Error('magick exited 7: synthetic conversion failure')
      const output = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from('synthetic')])
      output.writeUInt32LE(output.length - 8, 4)
      return output
    },
  }
}

async function seedChronicles(root: string, failedHero?: string): Promise<Map<string, { hash: string; mtimeMs: number }>> {
  const directory = join(root, '翁法罗斯英雄纪')
  await mkdir(directory, { recursive: true })
  const baseline = new Map<string, { hash: string; mtimeMs: number }>()
  for (const hero of HERO_VISUALS) {
    const path = join(directory, hero.assets.chronicle)
    await writeFile(path, hero.heroId === failedHero ? 'FAIL' : `source:${hero.heroId}`)
    const info = await stat(path)
    const hash = createHash('sha256').update(await readFile(path)).digest('hex')
    baseline.set(path, { hash, mtimeMs: info.mtimeMs })
  }
  return baseline
}

async function filesBelow(root: string): Promise<string[]> {
  const output: string[] = []
  const visit = async (directory: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else output.push(path)
    }
  }
  await visit(root)
  return output.sort()
}

function singleEntryZip(name: string, data: Buffer): Buffer {
  const encoded = Buffer.from(name, 'utf8')
  const checksum = crc32(data)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0x800, 6)
  local.writeUInt32LE(checksum, 14)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(encoded.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0x800, 8)
  central.writeUInt32LE(checksum, 16)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(encoded.length, 28)
  const centralOffset = local.length + encoded.length + data.length
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length + encoded.length, 12)
  eocd.writeUInt32LE(centralOffset, 16)
  return Buffer.concat([local, encoded, data, central, encoded, eocd])
}

async function seedFullAssets(root: string): Promise<void> {
  for (const hero of HERO_VISUALS) {
    const sources = [
      ['黄金裔杂志_13册分册压缩包', hero.assets.magazineZip, singleEntryZip('00_封面.jpg', Buffer.from(`cover:${hero.heroId}`))],
      ['翁法罗斯英雄纪', hero.assets.chronicle, Buffer.from(`chronicle:${hero.heroId}`)],
      ['翁法罗斯如我所书卡牌', hero.assets.card, Buffer.from(`card:${hero.heroId}`)],
      ['表情包', hero.assets.sticker, Buffer.from(`sticker:${hero.heroId}`)],
    ] as const
    for (const [directory, file, value] of sources) {
      const path = join(root, directory, file)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, value)
    }
  }
  for (const file of [BRAND_STICKER, ...CHIMERA_STICKERS]) {
    const path = join(root, '表情包', file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `global-sticker:${file}`)
  }
  for (const file of GLOBAL_WALLPAPERS) {
    const path = join(root, '昔涟壁纸', file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `wallpaper:${file}`)
  }
}

test('derived paths are fixed, contained, and ASCII-only', () => {
  const cache = join('X:', 'cache')
  const paths = derivedPaths(cache, 'aglaea')
  assert.deepEqual(Object.keys(paths), ['cover34', 'cover169', 'chronicle', 'card', 'sticker'])
  for (const path of Object.values(paths)) assert.match(path, /aglaea[\\/]\w[\w-]*\.webp$/u)
  assert.match(derivedWallpaperPath(cache, 0), /_global[\\/]wallpaper-0\.webp$/u)
  assert.match(derivedGlobalStickerPath(cache, 'brand'), /_global[\\/]sticker-brand\.webp$/u)
  assert.match(derivedGlobalStickerPath(cache, 'chimera-12'), /_global[\\/]sticker-chimera-12\.webp$/u)
  assert.throws(() => derivedPaths(cache, '../escape'), /invalid hero id/)
  assert.throws(() => derivedWallpaperPath(cache, 6), /invalid wallpaper index/)
  assert.throws(() => derivedGlobalStickerPath(cache, 'chimera-../../x'), /invalid global sticker name/)
  assert.throws(() => derivedGlobalStickerPath(cache, 'chimera-13'), /invalid global sticker name/)
})

test('a complete fixture writes 84 files, reports cover jobs by 13 heroes, and then skips 84', async () => {
  const root = await temporary()
  try {
    const assetsRoot = join(root, 'assets')
    const cacheDir = join(root, 'cache')
    await seedFullAssets(assetsRoot)
    const trace: Array<{ args: readonly string[]; input: string }> = []
    const progress: Array<{ kind: string; done: number; total: number }> = []
    const runtime = fakeRuntime(trace)
    const first = await deriveAssets({
      assetsRoot,
      cacheDir,
      magick: 'synthetic-magick',
      onProgress: value => progress.push(value),
    }, runtime)
    assert.deepEqual({ written: first.written, skipped: first.skipped, failed: first.failed.length }, { written: 84, skipped: 0, failed: 0 })
    assert.equal(trace.length, 84)
    assert.equal((await filesBelow(cacheDir)).filter(path => path.endsWith('.webp')).length, 84)
    const summary = (kind: string) => {
      const value = progress.filter(item => item.kind === kind).at(-1)!
      return { kind: value.kind, done: value.done, total: value.total }
    }
    assert.deepEqual(summary('covers'), { kind: 'covers', done: 13, total: 13 })
    assert.deepEqual(summary('stickers'), { kind: 'stickers', done: 26, total: 26 })
    assert.deepEqual(summary('wallpapers'), { kind: 'wallpapers', done: 6, total: 6 })
    const globalNames = (await readdir(join(cacheDir, '_global'))).sort()
    assert.equal(globalNames.length, 19)
    assert.equal(globalNames.every(name => /^[a-z0-9-]+\.webp$/u.test(name)), true)

    const second = await deriveAssets({ assetsRoot, cacheDir, magick: 'synthetic-magick' }, runtime)
    assert.deepEqual({ written: second.written, skipped: second.skipped, failed: second.failed.length }, { written: 0, skipped: 84, failed: 0 })
    assert.equal(trace.length, 84)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('async magick receives stdin, writes atomically, skips by mtime, and force rewrites', async () => {
  const root = await temporary()
  try {
    const assetsRoot = join(root, 'assets')
    const cacheDir = join(root, 'cache')
    const trace: Array<{ args: readonly string[]; input: string }> = []
    const baseline = await seedChronicles(assetsRoot)
    const runtime = fakeRuntime(trace)

    const progress: string[] = []
    const first = await deriveAssets({
      assetsRoot,
      cacheDir,
      magick: 'synthetic-magick',
      only: ['chronicle'],
      onProgress: value => progress.push(`${value.kind}:${value.done}/${value.total}:${value.current}`),
    }, runtime)
    assert.deepEqual({ written: first.written, skipped: first.skipped, failed: first.failed.length }, { written: 13, skipped: 0, failed: 0 })
    assert.equal(progress.length, 13)
    assert.equal(progress[0], 'chronicle:1/13:cyrene chronicle.webp')
    assert.equal(progress.at(-1), 'chronicle:13/13:cipher chronicle.webp')
    assert.equal((await filesBelow(cacheDir)).filter(path => path.endsWith('.webp')).length, 13)
    assert.equal((await filesBelow(cacheDir)).some(path => path.includes('.tmp-')), false)
    assert.equal((await readFile(derivedPaths(cacheDir, 'aglaea').chronicle)).toString('ascii', 0, 4), 'RIFF')

    assert.equal(trace.length, 13)
    const aglaeaTrace = trace.find(entry => entry.input === 'source:aglaea')!
    assert.equal(aglaeaTrace.input, 'source:aglaea')
    assert.deepEqual(aglaeaTrace.args, ['-', '-auto-orient', '-resize', '1600x1600>', '-quality', '84', 'webp:-'])

    const second = await deriveAssets({ assetsRoot, cacheDir, magick: 'synthetic-magick', only: ['chronicle'] }, runtime)
    assert.deepEqual({ written: second.written, skipped: second.skipped, failed: second.failed.length }, { written: 0, skipped: 13, failed: 0 })
    assert.equal(trace.length, 13)

    const forced = await deriveAssets({ assetsRoot, cacheDir, magick: 'synthetic-magick', only: ['chronicle'], force: true }, runtime)
    assert.deepEqual({ written: forced.written, skipped: forced.skipped, failed: forced.failed.length }, { written: 13, skipped: 0, failed: 0 })
    assert.equal(trace.length, 26)

    for (const [path, before] of baseline) {
      const info = await stat(path)
      const hash = createHash('sha256').update(await readFile(path)).digest('hex')
      assert.equal(hash, before.hash)
      assert.equal(info.mtimeMs, before.mtimeMs)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('one conversion failure is recorded while later jobs continue and leave no temp file', async () => {
  const root = await temporary()
  try {
    const assetsRoot = join(root, 'assets')
    const cacheDir = join(root, 'cache')
    const trace: Array<{ args: readonly string[]; input: string }> = []
    await seedChronicles(assetsRoot, 'aglaea')
    const progress: Array<{ error?: string }> = []
    const result = await deriveAssets({ assetsRoot, cacheDir, magick: 'synthetic-magick', only: ['chronicle'], onProgress: value => progress.push(value) }, fakeRuntime(trace))
    assert.equal(result.written, 12)
    assert.equal(result.skipped, 0)
    assert.equal(result.failed.length, 1)
    assert.match(result.failed[0]!.file, /aglaea[\\/]chronicle\.webp$/u)
    assert.match(result.failed[0]!.error, /magick exited 7: synthetic conversion failure/)
    assert.equal(progress.filter(value => value.error !== undefined).length, 1)
    assert.equal((await filesBelow(cacheDir)).some(path => path.includes('.tmp-')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('nested 00_ ZIP entries never become cover inputs', async () => {
  const root = await temporary()
  try {
    const assetsRoot = join(root, 'assets')
    const cacheDir = join(root, 'cache')
    const trace: Array<{ args: readonly string[]; input: string }> = []
    const hero = HERO_VISUALS[0]!
    const zipPath = join(assetsRoot, '黄金裔杂志_13册分册压缩包', hero.assets.magazineZip)
    await mkdir(dirname(zipPath), { recursive: true })
    await writeFile(zipPath, singleEntryZip('nested/00_封面.jpg', Buffer.from('image')))

    const result = await deriveAssets({ assetsRoot, cacheDir, magick: 'synthetic-magick', only: ['covers'] }, fakeRuntime(trace))
    assert.equal(result.written, 0)
    assert.equal(result.skipped, 0)
    assert.equal(result.failed.length, 26)
    assert.match(result.failed[0]!.error, /expected exactly one root 00_ cover, found 0/)
    assert.equal((await filesBelow(cacheDir)).length, 0)
    assert.equal(trace.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('overlapping cache roots and missing ImageMagick fail before any output', async () => {
  const root = await temporary()
  try {
    const assetsRoot = join(root, 'assets')
    await mkdir(assetsRoot, { recursive: true })
    await assert.rejects(
      deriveAssets({ assetsRoot, cacheDir: join(assetsRoot, 'assets-cache'), only: ['chronicle'] }),
      /must not overlap assetsRoot/,
    )
    await assert.rejects(
      deriveAssets({ assetsRoot, cacheDir: join(root, 'cache'), magick: join(root, 'missing-magick'), only: ['chronicle'] }),
      /ImageMagick \(magick\) not found/,
    )
    assert.equal((await filesBelow(join(root, 'cache'))).length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('overlap checks canonicalize a missing cache directory through its linked parent', async t => {
  const root = await temporary()
  const assetsRoot = join(root, 'assets')
  const linkedRoot = join(root, 'assets-link')
  t.after(async () => rm(root, { recursive: true, force: true }))
  await mkdir(assetsRoot, { recursive: true })
  await symlink(assetsRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir')
  t.after(async () => unlink(linkedRoot).catch(() => {}))

  await assert.rejects(
    deriveAssets(
      { assetsRoot: linkedRoot, cacheDir: join(linkedRoot, 'assets-cache'), magick: 'synthetic-magick', only: ['chronicle'] },
      fakeRuntime([]),
    ),
    /must not overlap assetsRoot/,
  )
  await assert.rejects(stat(join(assetsRoot, 'assets-cache')), { code: 'ENOENT' })
})

test('production converter uses bounded async spawn pipes without a shell', async () => {
  const source = readFileSync(new URL('../src/host/derive.ts', import.meta.url), 'utf8')
  assert.match(source, /spawn\(magick, \[\.\.\.args\], \{[\s\S]*stdio: \['pipe', 'pipe', 'pipe'\][\s\S]*windowsHide: true[\s\S]*shell: false/)
  assert.match(source, /child\.stdin\.end\(input\)/)
  assert.match(source, /MAGICK_TIMEOUT_MS = 120_000/)
  assert.match(source, /MAX_MAGICK_OUTPUT_BYTES = 64 \* 1024 \* 1024/)
  assert.doesNotMatch(source, /spawn\([^\n]+\{\s*input/u)
  assert.equal(await probeMagick(join(tmpdir(), 'definitely-missing-magick')), undefined)
})
