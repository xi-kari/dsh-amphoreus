import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { SuiteResolver } from '../src/host/bridge.ts'
import { CustomWallpaperStore, customWallpaperKind } from '../src/host/custom-wallpapers.ts'
import { INITIAL_GLOBAL, type AmphoreusStores } from '../src/host/store.ts'
import { AmphoreusWebApi } from '../src/host/webapi.ts'
import { seatWallpaperCandidates } from '../src/client/seat-wallpaper.ts'
import { heroVisualById } from '../src/shared/heroes.ts'
import { fixtureConfig } from './fixture-suite.ts'

const NONCE = 'custom-wallpaper-nonce'

function stores(): { stores: AmphoreusStores; read(): typeof INITIAL_GLOBAL } {
  let global = structuredClone(INITIAL_GLOBAL)
  return {
    read: () => global,
    stores: {
      main: {
        global: { get: () => global, set: async (value: typeof global) => { global = value } },
        table: () => ({ entries: () => new Map().entries() }),
      },
      canvas: { table: () => ({ entries: () => new Map().entries() }) },
      close: async () => {},
    } as unknown as AmphoreusStores,
  }
}

test('custom wallpaper kind follows the extension', () => {
  assert.equal(customWallpaperKind('wallpaper.mp4'), 'video')
  assert.equal(customWallpaperKind('wallpaper.webm'), 'video')
  assert.equal(customWallpaperKind('wallpaper.png'), 'image')
  assert.equal(customWallpaperKind('wallpaper.gif'), 'image')
})

test('upload replaces per seat, streams with Range, placement persists, delete clears both file and prefs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-custom-wp-'))
  try {
    const { stores: fixtureStores, read } = stores()
    const api = new AmphoreusWebApi({} as Context, {
      config: fixtureConfig(),
      stores: fixtureStores,
      resolver: { current: () => undefined } as unknown as SuiteResolver,
      nonce: NONCE,
      dataDir: root,
      assetsCacheDir: join(root, 'assets-cache'),
      probeMagick: async () => undefined,
    })
    const server = createServer((request, response) => { void api.handle(request, response) })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address !== null && typeof address !== 'string')
    const origin = `http://127.0.0.1:${address.port}`
    try {
      // 1) upload a "png" (bytes are arbitrary; the server trusts the declared type)
      const png = Buffer.from('PNGDATA-' + 'x'.repeat(5000))
      const put = await fetch(`${origin}/amphoreus/api/custom-wallpaper/cerydra`, {
        method: 'PUT', headers: { 'content-type': 'image/png', 'x-amphoreus-nonce': NONCE }, body: png,
      })
      assert.equal(put.status, 200)
      const uploaded = (await put.json() as { wallpaper: { url: string; kind: string; bytes: number; placement: { fit: string; x: number } } }).wallpaper
      assert.equal(uploaded.kind, 'image')
      assert.equal(uploaded.bytes, png.length)
      assert.match(uploaded.url, /^\/amphoreus\/custom-wallpaper\/cerydra\/wallpaper\.png\?v=\d+$/u)
      assert.deepEqual([uploaded.placement.fit, uploaded.placement.x], ['cover', 50])

      // state exposes it
      const state = await (await fetch(`${origin}/amphoreus/api/state`)).json() as { customWallpapers: { heroId: string }[] }
      assert.deepEqual(state.customWallpapers.map(item => item.heroId), ['cerydra'])

      // 2) unsupported type → 415; unknown hero → 400; missing nonce → 403
      assert.equal((await fetch(`${origin}/amphoreus/api/custom-wallpaper/cerydra`, { method: 'PUT', headers: { 'content-type': 'application/zip', 'x-amphoreus-nonce': NONCE }, body: 'zip' })).status, 415)
      assert.equal((await fetch(`${origin}/amphoreus/api/custom-wallpaper/Bad%20Id`, { method: 'PUT', headers: { 'content-type': 'image/png', 'x-amphoreus-nonce': NONCE }, body: 'x' })).status, 400)
      assert.equal((await fetch(`${origin}/amphoreus/api/custom-wallpaper/cerydra`, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: 'x' })).status, 403)

      // 3) streaming: full, HEAD, and a byte range
      const streamPath = uploaded.url.split('?')[0]!
      const full = await fetch(`${origin}${streamPath}`)
      assert.equal(full.status, 200)
      assert.equal(full.headers.get('content-type'), 'image/png')
      assert.equal(full.headers.get('accept-ranges'), 'bytes')
      assert.equal((await full.arrayBuffer()).byteLength, png.length)
      const head = await fetch(`${origin}${streamPath}`, { method: 'HEAD' })
      assert.equal(head.status, 200)
      assert.equal(head.headers.get('content-length'), String(png.length))
      const ranged = await fetch(`${origin}${streamPath}`, { headers: { range: 'bytes=0-7' } })
      assert.equal(ranged.status, 206)
      assert.equal(ranged.headers.get('content-range'), `bytes 0-7/${png.length}`)
      assert.equal(Buffer.from(await ranged.arrayBuffer()).toString('utf8'), 'PNGDATA-')
      assert.equal((await fetch(`${origin}${streamPath}`, { headers: { range: 'bytes=999999-' } })).status, 416)

      // 4) replacing with a video swaps the file (only one per seat)
      const mp4 = await fetch(`${origin}/amphoreus/api/custom-wallpaper/cerydra`, {
        method: 'PUT', headers: { 'content-type': 'video/mp4', 'x-amphoreus-nonce': NONCE }, body: Buffer.from('MP4'),
      })
      assert.equal(mp4.status, 200)
      const files = (await readdir(join(root, 'custom-wallpapers', 'cerydra'))).filter(name => name.startsWith('wallpaper.'))
      assert.deepEqual(files, ['wallpaper.mp4'])
      assert.equal((await fetch(`${origin}${streamPath}`)).status, 404, 'old png url is gone')

      // 5) placement patch through prefs; unknown key rejected
      const placed = await fetch(`${origin}/amphoreus/api/prefs`, {
        method: 'PUT', headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': NONCE },
        body: JSON.stringify({ customWallpapers: { cerydra: { fit: 'contain', x: 20, playbackRate: 0.5, muted: false } } }),
      })
      assert.equal(placed.status, 200)
      assert.deepEqual(read().prefs.customWallpapers?.cerydra, { fit: 'contain', x: 20, playbackRate: 0.5, muted: false })
      const merged = (await (await fetch(`${origin}/amphoreus/api/state`)).json() as { customWallpapers: { placement: Record<string, unknown> }[] }).customWallpapers[0]!.placement
      assert.deepEqual(merged, { fit: 'contain', x: 20, y: 40, scale: 1, playbackRate: 0.5, muted: false, loop: true, paused: false })
      assert.equal((await fetch(`${origin}/amphoreus/api/prefs`, {
        method: 'PUT', headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': NONCE },
        body: JSON.stringify({ customWallpapers: { cerydra: { sparkle: true } } }),
      })).status, 400)

      // 6) delete clears the file and the prefs entry
      const removed = await fetch(`${origin}/amphoreus/api/custom-wallpaper/cerydra`, { method: 'DELETE', headers: { 'x-amphoreus-nonce': NONCE } })
      assert.equal(removed.status, 200)
      assert.equal(Object.hasOwn(read().prefs.customWallpapers ?? {}, 'cerydra'), false)
      assert.equal((await (await fetch(`${origin}/amphoreus/api/state`)).json() as { customWallpapers: unknown[] }).customWallpapers.length, 0)
      assert.equal((await fetch(`${origin}/amphoreus/api/custom-wallpaper/cerydra`, { method: 'DELETE', headers: { 'x-amphoreus-nonce': NONCE } })).status, 404)
    } finally {
      server.close()
      await once(server, 'close')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('store rescans existing files on start', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-custom-wp-scan-'))
  try {
    const store = new CustomWallpaperStore(root)
    await store.scan()
    assert.deepEqual(store.list(), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a custom image outranks derived home wallpapers in the seat candidate chain', () => {
  const anaxa = heroVisualById('anaxa')!
  const candidates = seatWallpaperCandidates(anaxa, {
    derived: ['anaxa/home-00.webp', 'anaxa/cover-169.webp'],
    assetsConfigured: true,
    customUrl: '/amphoreus/custom-wallpaper/anaxa/wallpaper.png?v=1',
  })
  assert.equal(candidates[0], '/amphoreus/custom-wallpaper/anaxa/wallpaper.png?v=1')
  assert.equal(candidates[1], '/amphoreus/derived/anaxa/home-00.webp')
})
