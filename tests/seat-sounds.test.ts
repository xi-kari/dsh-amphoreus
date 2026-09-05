import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { SuiteResolver } from '../src/host/bridge.ts'
import { resolveSeatSoundExt, SEAT_SOUND_TYPES, SeatSoundStore } from '../src/host/seat-sounds.ts'
import { GlobalSchema, INITIAL_GLOBAL, type AmphoreusStores } from '../src/host/store.ts'
import { AmphoreusWebApi } from '../src/host/webapi.ts'
import { SEAT_SOUND_MAX_BYTES } from '../src/shared/api.ts'
import { fixtureConfig } from './fixture-suite.ts'

const NONCE = 'seat-sound-nonce'

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

async function serve(root: string) {
  const fixture = stores()
  const api = new AmphoreusWebApi({} as Context, {
    config: fixtureConfig(),
    stores: fixture.stores,
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
  return {
    origin: `http://127.0.0.1:${address.port}`,
    read: fixture.read,
    async close() {
      server.close()
      await once(server, 'close')
    },
  }
}

test('extension resolution: MIME wins, octet-stream falls back to a known x-amphoreus-ext, anything else is rejected', () => {
  assert.equal(resolveSeatSoundExt('audio/mpeg', undefined), 'mp3')
  assert.equal(resolveSeatSoundExt('audio/x-wav', undefined), 'wav')
  assert.equal(resolveSeatSoundExt('Audio/OGG; codecs=opus', undefined), 'ogg')
  assert.equal(resolveSeatSoundExt('application/octet-stream', 'FLAC'), 'flac')
  assert.equal(resolveSeatSoundExt('application/octet-stream', '.m4a'), 'm4a')
  assert.equal(resolveSeatSoundExt('', 'ogg'), 'ogg')
  assert.equal(resolveSeatSoundExt('application/octet-stream', 'exe'), undefined)
  assert.equal(resolveSeatSoundExt('application/zip', undefined), undefined)
  assert.equal(resolveSeatSoundExt('image/png', 'mp3'), 'mp3', 'hint wins over an unknown declared type')
  assert.equal(Object.keys(SEAT_SOUND_TYPES).length, 8)
  assert.equal(SEAT_SOUND_MAX_BYTES, 20 * 1024 * 1024)
})

test('prefs schema accepts seatSounds and legacy globals without it', () => {
  const legacy = GlobalSchema.parse({ ...INITIAL_GLOBAL, prefs: { lastSeat: null, wallpaperCursor: 0, quickPhrases: [] } })
  assert.equal(legacy.prefs.seatSounds, undefined)
  const withSounds = GlobalSchema.parse({
    ...INITIAL_GLOBAL,
    prefs: { ...INITIAL_GLOBAL.prefs, seatSounds: { master: false, seats: { anaxa: { greeting: { volume: 0.2 }, send: { enabled: false } } } } },
  })
  assert.equal(withSounds.prefs.seatSounds?.master, false)
  assert.equal(withSounds.prefs.seatSounds?.seats?.anaxa?.greeting?.volume, 0.2)
  assert.equal(GlobalSchema.safeParse({ ...INITIAL_GLOBAL, prefs: { ...INITIAL_GLOBAL.prefs, seatSounds: { seats: { anaxa: { send: { volume: 1.5 } } } } } }).success, false)
})

test('upload per (seat, slot), Range streaming, prefs merge, 415/413/400/403, remove clears the prefs entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-seat-snd-'))
  try {
    const { origin, read, close } = await serve(root)
    try {
      // 1) greeting as mp3
      const mp3 = Buffer.from('ID3-GREETING-' + 'x'.repeat(3000))
      const put = await fetch(`${origin}/amphoreus/api/seat-sound/anaxa/greeting`, {
        method: 'PUT', headers: { 'content-type': 'audio/mpeg', 'x-amphoreus-nonce': NONCE }, body: mp3,
      })
      assert.equal(put.status, 200)
      const uploaded = (await put.json() as { sound: { url: string; slot: string; mime: string; bytes: number; prefs: { enabled: boolean; volume: number } } }).sound
      assert.equal(uploaded.slot, 'greeting')
      assert.equal(uploaded.mime, 'audio/mpeg')
      assert.equal(uploaded.bytes, mp3.length)
      assert.match(uploaded.url, /^\/amphoreus\/seat-sound\/anaxa\/greeting\.mp3\?v=\d+$/u)
      assert.deepEqual(uploaded.prefs, { enabled: true, volume: 0.6 })

      // 2) send slot with an empty-MIME upload rescued by the extension hint
      const ogg = Buffer.from('OggS-SEND')
      const putOgg = await fetch(`${origin}/amphoreus/api/seat-sound/anaxa/send`, {
        method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-amphoreus-ext': 'ogg', 'x-amphoreus-nonce': NONCE }, body: ogg,
      })
      assert.equal(putOgg.status, 200)
      assert.equal((await putOgg.json() as { sound: { mime: string; url: string } }).sound.mime, 'audio/ogg')

      // state exposes both, sorted hero then slot
      const state = await (await fetch(`${origin}/amphoreus/api/state`)).json() as { seatSounds: { heroId: string; slot: string }[] }
      assert.deepEqual(state.seatSounds.map(item => `${item.heroId}/${item.slot}`), ['anaxa/greeting', 'anaxa/send'])

      // 3) rejections: unknown type → 415; octet-stream without a usable hint → 415; bad slot / hero → 400; no nonce → 403; oversize → 413
      assert.equal((await fetch(`${origin}/amphoreus/api/seat-sound/anaxa/greeting`, { method: 'PUT', headers: { 'content-type': 'application/zip', 'x-amphoreus-nonce': NONCE }, body: 'zip' })).status, 415)
      assert.equal((await fetch(`${origin}/amphoreus/api/seat-sound/anaxa/greeting`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-amphoreus-ext': 'exe', 'x-amphoreus-nonce': NONCE }, body: 'x' })).status, 415)
      assert.equal((await fetch(`${origin}/amphoreus/api/seat-sound/anaxa/ambient`, { method: 'PUT', headers: { 'content-type': 'audio/mpeg', 'x-amphoreus-nonce': NONCE }, body: 'x' })).status, 400)
      assert.equal((await fetch(`${origin}/amphoreus/api/seat-sound/Bad%20Id/greeting`, { method: 'PUT', headers: { 'content-type': 'audio/mpeg', 'x-amphoreus-nonce': NONCE }, body: 'x' })).status, 400)
      assert.equal((await fetch(`${origin}/amphoreus/api/seat-sound/anaxa/greeting`, { method: 'PUT', headers: { 'content-type': 'audio/mpeg' }, body: 'x' })).status, 403)
      assert.equal((await fetch(`${origin}/amphoreus/api/seat-sound/anaxa/greeting`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': NONCE }, body: '{}' })).status, 405)
      // the previous greeting is untouched by the failed uploads
      const files = (await readdir(join(root, 'seat-sounds', 'anaxa'))).sort()
      assert.deepEqual(files, ['greeting.mp3', 'send.ogg'], 'no temp files left behind')

      // 4) streaming: full, HEAD, byte range, 416, nosniff + immutable cache, non-GET → 405
      const streamPath = uploaded.url.split('?')[0]!
      const full = await fetch(`${origin}${streamPath}`)
      assert.equal(full.status, 200)
      assert.equal(full.headers.get('content-type'), 'audio/mpeg')
      assert.equal(full.headers.get('accept-ranges'), 'bytes')
      assert.equal(full.headers.get('x-content-type-options'), 'nosniff')
      assert.match(full.headers.get('cache-control') ?? '', /immutable/u)
      assert.equal((await full.arrayBuffer()).byteLength, mp3.length)
      const head = await fetch(`${origin}${streamPath}`, { method: 'HEAD' })
      assert.equal(head.status, 200)
      assert.equal(head.headers.get('content-length'), String(mp3.length))
      const ranged = await fetch(`${origin}${streamPath}`, { headers: { range: 'bytes=4-11' } })
      assert.equal(ranged.status, 206)
      assert.equal(ranged.headers.get('content-range'), `bytes 4-11/${mp3.length}`)
      assert.equal(Buffer.from(await ranged.arrayBuffer()).toString('utf8'), 'GREETING')
      assert.equal((await fetch(`${origin}${streamPath}`, { headers: { range: 'bytes=999999-' } })).status, 416)
      assert.equal((await fetch(`${origin}${streamPath}`, { method: 'DELETE', headers: { 'x-amphoreus-nonce': NONCE } })).status, 405)
      assert.equal((await fetch(`${origin}/amphoreus/seat-sound/anaxa/greeting.wav`)).status, 404, 'only the stored file name serves')
      assert.equal((await fetch(`${origin}/amphoreus/seat-sound/anaxa/..%2F..%2Fpackage.json`)).status, 404)

      // 5) replacing the greeting with wav swaps the file, old url is gone
      const wav = await fetch(`${origin}/amphoreus/api/seat-sound/anaxa/greeting`, {
        method: 'PUT', headers: { 'content-type': 'audio/x-wav', 'x-amphoreus-nonce': NONCE }, body: Buffer.from('RIFF'),
      })
      assert.equal(wav.status, 200)
      assert.equal((await wav.json() as { sound: { mime: string } }).sound.mime, 'audio/wav')
      assert.deepEqual((await readdir(join(root, 'seat-sounds', 'anaxa'))).sort(), ['greeting.wav', 'send.ogg'])
      assert.equal((await fetch(`${origin}${streamPath}`)).status, 404)

      // 6) prefs patch: master + per-slot knobs merge; unknown keys / out-of-range rejected; null seat entry deletes
      const patched = await fetch(`${origin}/amphoreus/api/prefs`, {
        method: 'PUT', headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': NONCE },
        body: JSON.stringify({ seatSounds: { master: false, seats: { anaxa: { greeting: { volume: 0.25 } } } } }),
      })
      assert.equal(patched.status, 200)
      assert.deepEqual(read().prefs.seatSounds, { master: false, seats: { anaxa: { greeting: { volume: 0.25 } } } })
      const again = await fetch(`${origin}/amphoreus/api/prefs`, {
        method: 'PUT', headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': NONCE },
        body: JSON.stringify({ seatSounds: { seats: { anaxa: { greeting: { enabled: false }, send: { volume: 1 } } } } }),
      })
      assert.equal(again.status, 200)
      assert.deepEqual(read().prefs.seatSounds, { master: false, seats: { anaxa: { greeting: { volume: 0.25, enabled: false }, send: { volume: 1 } } } })
      const merged = (await (await fetch(`${origin}/amphoreus/api/state`)).json() as { seatSounds: { slot: string; prefs: Record<string, unknown> }[]; prefs: { seatSounds?: { master?: boolean } } })
      assert.deepEqual(merged.seatSounds.find(item => item.slot === 'greeting')?.prefs, { enabled: false, volume: 0.25 })
      assert.deepEqual(merged.seatSounds.find(item => item.slot === 'send')?.prefs, { enabled: true, volume: 1 })
      assert.equal(merged.prefs.seatSounds?.master, false)
      for (const bad of [
        { seatSounds: { seats: { anaxa: { greeting: { sparkle: true } } } } },
        { seatSounds: { seats: { anaxa: { send: { volume: 2 } } } } },
        { seatSounds: { seats: { anaxa: { ambient: { enabled: true } } } } },
        { seatSounds: { loud: true } },
      ]) {
        assert.equal((await fetch(`${origin}/amphoreus/api/prefs`, {
          method: 'PUT', headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': NONCE }, body: JSON.stringify(bad),
        })).status, 400, JSON.stringify(bad))
      }

      // 7) delete greeting clears only its prefs; deleting send drops the seat entry and the directory
      const removed = await fetch(`${origin}/amphoreus/api/seat-sound/anaxa/greeting`, { method: 'DELETE', headers: { 'x-amphoreus-nonce': NONCE } })
      assert.equal(removed.status, 200)
      assert.deepEqual(read().prefs.seatSounds, { master: false, seats: { anaxa: { send: { volume: 1 } } } })
      assert.equal((await fetch(`${origin}/amphoreus/api/seat-sound/anaxa/greeting`, { method: 'DELETE', headers: { 'x-amphoreus-nonce': NONCE } })).status, 404)
      assert.equal((await fetch(`${origin}/amphoreus/api/seat-sound/anaxa/send`, { method: 'DELETE', headers: { 'x-amphoreus-nonce': NONCE } })).status, 200)
      assert.deepEqual(read().prefs.seatSounds, { master: false, seats: {} })
      assert.equal((await (await fetch(`${origin}/amphoreus/api/state`)).json() as { seatSounds: unknown[] }).seatSounds.length, 0)
      assert.deepEqual(await readdir(join(root, 'seat-sounds')), [])
    } finally {
      await close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('uploads past the byte cap are rejected with 413 and leave no file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-seat-snd-cap-'))
  try {
    const store = new SeatSoundStore(root, { maxBytes: 1024 })
    assert.equal(store.maxBytes, 1024)
    const { origin, close } = await serve(root)
    try {
      // The web api uses the default 20 MiB cap: stream 20 MiB + 1 byte in modest chunks.
      const chunk = Buffer.alloc(1024 * 1024, 0x61)
      const total = SEAT_SOUND_MAX_BYTES + 1
      let sent = 0
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= total) { controller.close(); return }
          const size = Math.min(chunk.length, total - sent)
          controller.enqueue(chunk.subarray(0, size))
          sent += size
        },
      })
      const response = await fetch(`${origin}/amphoreus/api/seat-sound/cipher/send`, {
        method: 'PUT',
        headers: { 'content-type': 'audio/mpeg', 'x-amphoreus-nonce': NONCE },
        body,
        // @ts-expect-error undici streaming upload option
        duplex: 'half',
      })
      assert.equal(response.status, 413)
      assert.deepEqual(await response.json(), { error: `request body exceeds ${SEAT_SOUND_MAX_BYTES} bytes` })
      const files = await readdir(join(root, 'seat-sounds', 'cipher')).catch(() => [] as string[])
      assert.deepEqual(files, [], 'temp file removed and nothing published')
      assert.equal((await (await fetch(`${origin}/amphoreus/api/state`)).json() as { seatSounds: unknown[] }).seatSounds.length, 0)
    } finally {
      await close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('store rescans existing files on start, ignores strangers, one file per slot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-seat-snd-scan-'))
  try {
    await mkdir(join(root, 'seat-sounds', 'mydei'), { recursive: true })
    await writeFile(join(root, 'seat-sounds', 'mydei', 'greeting.flac'), 'fLaC')
    await writeFile(join(root, 'seat-sounds', 'mydei', 'send.mp3'), 'ID3')
    await writeFile(join(root, 'seat-sounds', 'mydei', 'send.wav'), 'RIFF')
    await writeFile(join(root, 'seat-sounds', 'mydei', 'notes.txt'), 'x')
    await mkdir(join(root, 'seat-sounds', 'Bad Hero'), { recursive: true })
    const store = new SeatSoundStore(root)
    await store.scan()
    assert.deepEqual(store.list().map(record => `${record.heroId}/${record.file}/${record.mime}`), ['mydei/greeting.flac/audio/flac', 'mydei/send.mp3/audio/mpeg'])
    assert.equal(store.get('mydei', 'send')?.bytes, 3)
    assert.equal(store.get('mydei', 'greeting')?.mime, 'audio/flac')
    assert.match(store.urlOf(store.get('mydei', 'greeting')!), /^\/amphoreus\/seat-sound\/mydei\/greeting\.flac\?v=\d+$/u)
    const empty = new SeatSoundStore(join(root, 'nowhere'))
    await empty.scan()
    assert.deepEqual(empty.list(), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
