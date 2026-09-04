import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { SuiteResolver } from '../src/host/bridge.ts'
import type { AmphoreusConfig } from '../src/host/config.ts'
import { INITIAL_GLOBAL, type AmphoreusStores } from '../src/host/store.ts'
import { AmphoreusWebApi } from '../src/host/webapi.ts'

function fixtureConfig(assetsRoot = ''): AmphoreusConfig {
  return {
    skillRoots: ['X:/fixture'], dataDir: '', assetsRoot, commonPath: 'amphoreus/references/common.md', relationsPath: 'amphoreus/references/relations.md',
    sectionAliases: {}, providerName: 'dsh-amphoreus', providerSource: 'amphoreus', providerRank: 300, registerProvider: true, forceUserOnly: false,
    heroWorkspaceMode: 'seats', magazineMode: 'light', seatStyle: true,
    wallpaper: { enabled: true, global: 'fixed', globalIndex: 0, sidebarIndex: 1, perSeat: true, darkMask: 0.18, lightMask: 0.03, surfaceAlpha: { light: 0.22, dark: 0.4 } },
    autoInvoke: { enabled: true, sources: ['startup', 'clear'] }, receiptParsing: true, handoff: { enabled: true },
    workbench: { enabled: true, host: 'iframe', defaultView: 'chat', cardTextLimit: 8000, autoProjection: true },
    suiteWatch: { mode: 'off', pollMs: 15_000, debounceMs: 800 }, validate: { enabled: false, python: 'python' },
    sync: { source: 'fixture', ref: 'main', keepBackups: 3 }, trustedHosts: [],
  }
}

function fixtureStores(): AmphoreusStores {
  let global = structuredClone(INITIAL_GLOBAL)
  const empty = new Map()
  return {
    main: {
      global: { get: () => global, set: async value => { global = value } },
      table: () => ({ entries: () => empty.entries() }),
    },
    canvas: { table: () => ({ entries: () => empty.entries() }) },
    close: async () => {},
  } as unknown as AmphoreusStores
}

function api(cacheDir: string, assetsRoot = ''): AmphoreusWebApi {
  return new AmphoreusWebApi({} as Context, {
    config: fixtureConfig(assetsRoot),
    stores: fixtureStores(),
    resolver: { current: () => undefined } as unknown as SuiteResolver,
    nonce: 'derived-assets-test',
    assetsCacheDir: cacheDir,
  })
}

async function put(path: string, value: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value)
}

test('asset preparation is idempotent and scans exactly two sorted ASCII levels', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-derived-webapi-'))
  try {
    const cache = join(root, 'assets-cache')
    await put(join(cache, 'aglaea', 'cover-34.webp'), 'cover')
    await put(join(cache, '_global', 'wallpaper-0.webp'), 'wallpaper')
    await put(join(cache, 'aglaea', 'not.png'), 'ignored')
    await put(join(cache, 'aglaea', 'nested', 'deep.webp'), 'ignored')
    await put(join(cache, 'Bad', 'uppercase.webp'), 'ignored')
    await put(join(cache, 'bad-dir', 'hyphen.webp'), 'ignored')
    const outside = join(root, 'outside.webp')
    await put(outside, 'outside')
    try {
      await symlink(outside, join(cache, 'aglaea', 'linked.webp'), 'file')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
    }

    const webApi = api(cache, '   ')
    assert.equal(webApi.derivedWallpaperUrl(0), null)
    await Promise.all([webApi.prepareAssets(), webApi.prepareAssets(), webApi.prepareAssets()])
    const state = webApi.state()
    assert.deepEqual(state.assets.derived, ['_global/wallpaper-0.webp', 'aglaea/cover-34.webp'])
    assert.equal(state.assets.derivedCount, 2)
    assert.equal(state.assets.root, '')
    assert.equal(state.assets.cacheDir, cache)
    assert.equal(state.assets.magick === null || typeof state.assets.magick === 'string', true)
    assert.equal(state.assets.running, false)
    assert.equal(state.assets.lastDerive, null)
    assert.equal(webApi.derivedWallpaperUrl(0), '/amphoreus/derived/_global/wallpaper-0.webp')
    assert.equal(webApi.derivedWallpaperUrl(1), null)

    await put(join(cache, 'aglaea', 'card.webp'), 'added after preparation')
    await webApi.prepareAssets()
    assert.deepEqual(webApi.state().assets.derived, ['_global/wallpaper-0.webp', 'aglaea/cover-34.webp'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an unreadable cache shape fails soft to deterministic original-asset state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-derived-invalid-'))
  try {
    const cache = join(root, 'assets-cache')
    await put(cache, 'not a directory')
    const webApi = api(cache)
    await webApi.prepareAssets()
    assert.deepEqual(webApi.state().assets.derived, [])
    assert.equal(webApi.state().assets.derivedCount, 0)
    assert.equal(webApi.derivedWallpaperUrl(0), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('first state request awaits preparation and derived GET/HEAD enforce routing and headers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-derived-route-'))
  try {
    const cache = join(root, 'assets-cache')
    const cover = join(cache, 'aglaea', 'cover-34.webp')
    const card = join(cache, 'aglaea', 'card.webp')
    const body = Buffer.from('RIFF\x04\x00\x00\x00WEBP')
    await put(cover, body)
    await put(card, body)
    const webApi = api(cache)
    const server = createServer((request, response) => { void webApi.handle(request, response) })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address !== null && typeof address !== 'string')
    const origin = `http://127.0.0.1:${address.port}`
    try {
      const stateResponse = await fetch(`${origin}/amphoreus/api/state`)
      assert.equal(stateResponse.status, 200)
      const state = await stateResponse.json() as { assets: { derived: string[] } }
      assert.deepEqual(state.assets.derived, ['aglaea/card.webp', 'aglaea/cover-34.webp'])

      const get = await fetch(`${origin}/amphoreus/derived/aglaea/cover-34.webp`)
      assert.equal(get.status, 200)
      assert.equal(get.headers.get('content-type'), 'image/webp')
      assert.equal(get.headers.get('content-length'), String(body.length))
      assert.equal(get.headers.get('cache-control'), 'private, max-age=86400')
      assert.equal(get.headers.get('x-content-type-options'), 'nosniff')
      assert.deepEqual(Buffer.from(await get.arrayBuffer()), body)

      const head = await fetch(`${origin}/amphoreus/derived/aglaea/cover-34.webp`, { method: 'HEAD' })
      assert.equal(head.status, 200)
      assert.equal(head.headers.get('content-type'), 'image/webp')
      assert.equal(head.headers.get('content-length'), String(body.length))
      assert.equal(head.headers.get('cache-control'), 'private, max-age=86400')
      assert.equal(head.headers.get('x-content-type-options'), 'nosniff')
      assert.equal((await head.arrayBuffer()).byteLength, 0)

      for (const path of [
        '/amphoreus/derived/aglaea/missing.webp',
        '/amphoreus/derived/Bad/cover.webp',
        '/amphoreus/derived/aglaea%2Fnested/deep.webp',
        '/amphoreus/derived/%2e%2e/%2e%2e/x.webp',
      ]) {
        assert.equal((await fetch(`${origin}${path}`)).status, 404, path)
      }
      const post = await fetch(`${origin}/amphoreus/derived/aglaea/cover-34.webp`, {
        method: 'POST',
      })
      assert.equal(post.status, 405)
      assert.equal(post.headers.get('allow'), 'GET, HEAD')

      const outside = join(root, 'outside.webp')
      await put(outside, body)
      await rm(card)
      try {
        await symlink(outside, card, 'file')
        assert.equal((await fetch(`${origin}/amphoreus/derived/aglaea/card.webp`)).status, 404)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
      }

      const held = join(root, 'held.webp')
      await rename(cover, held)
      assert.equal((await fetch(`${origin}/amphoreus/derived/aglaea/cover-34.webp`)).status, 404)
    } finally {
      server.close()
      await once(server, 'close')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
