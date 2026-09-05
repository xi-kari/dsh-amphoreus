import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { SuiteResolver } from '../src/host/bridge.ts'
import { declaredTooLarge, resolveSeatSoundExt, SEAT_SOUND_TYPES, SeatSoundStore, SeatSoundTooLargeError } from '../src/host/seat-sounds.ts'
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

async function serve(root: string, seatSoundMaxBytes?: number) {
  const fixture = stores()
  const api = new AmphoreusWebApi({} as Context, {
    config: fixtureConfig(),
    stores: fixture.stores,
    resolver: { current: () => undefined } as unknown as SuiteResolver,
    nonce: NONCE,
    dataDir: root,
    assetsCacheDir: join(root, 'assets-cache'),
    probeMagick: async () => undefined,
    seatSoundMaxBytes,
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
  assert.equal(resolveSeatSoundExt('image/png', 'mp3'), undefined, 'the hint only rescues an empty / octet-stream declared type')
  assert.equal(resolveSeatSoundExt('application/zip', 'mp3'), undefined)
  assert.equal(declaredTooLarge({ 'content-length': '2049' }, 2048), true)
  assert.equal(declaredTooLarge({ 'content-length': '2048' }, 2048), false)
  assert.equal(declaredTooLarge({}, 2048), false)
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
      assert.equal((await fetch(`${origin}/amphoreus/api/seat-sound/anaxa/greeting`, { method: 'PUT', headers: { 'content-type': 'image/png', 'x-amphoreus-ext': 'mp3', 'x-amphoreus-nonce': NONCE }, body: 'x' })).status, 415, 'ext hint does not rescue a foreign declared type')
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

/** Streams `total` bytes with no content-length (chunked), pushing `chunk`-sized pieces. */
function chunkedBody(total: number, chunk = 256 * 1024): ReadableStream<Uint8Array> {
  const piece = Buffer.alloc(chunk, 0x61)
  let sent = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= total) { controller.close(); return }
      const size = Math.min(piece.length, total - sent)
      controller.enqueue(piece.subarray(0, size))
      sent += size
    },
  })
}

test('uploads past the byte cap are rejected with 413 and leave no file or directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-seat-snd-cap-'))
  try {
    const store = new SeatSoundStore(root, { maxBytes: 1024 })
    assert.equal(store.maxBytes, 1024)
    const { origin, close } = await serve(root)
    try {
      // The web api uses the default 20 MiB cap: stream 20 MiB + 1 byte in modest chunks.
      const response = await fetch(`${origin}/amphoreus/api/seat-sound/cipher/send`, {
        method: 'PUT',
        headers: { 'content-type': 'audio/mpeg', 'x-amphoreus-nonce': NONCE },
        body: chunkedBody(SEAT_SOUND_MAX_BYTES + 1, 1024 * 1024),
        // @ts-expect-error undici streaming upload option
        duplex: 'half',
      })
      assert.equal(response.status, 413)
      assert.deepEqual(await response.json(), { error: `request body exceeds ${SEAT_SOUND_MAX_BYTES} bytes` })
      await assert.rejects(stat(join(root, 'seat-sounds', 'cipher')), /ENOENT/u, 'temp file removed and the empty hero directory pruned')
      assert.equal((await (await fetch(`${origin}/amphoreus/api/state`)).json() as { seatSounds: unknown[] }).seatSounds.length, 0)
    } finally {
      await close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('413 is delivered for a declared content-length past the cap (no disk work) and for a chunked body far past the cap', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-seat-snd-cap2-'))
  try {
    const cap = 4096
    const { origin, close } = await serve(root, cap)
    try {
      // Browsers always declare a File's length: 64 KiB declared against a 4 KiB cap -> 413 without creating the hero directory.
      const declared = await fetch(`${origin}/amphoreus/api/seat-sound/cipher/send`, {
        method: 'PUT', headers: { 'content-type': 'audio/mpeg', 'x-amphoreus-nonce': NONCE }, body: Buffer.alloc(64 * 1024, 0x61),
      })
      assert.equal(declared.status, 413)
      assert.deepEqual(await declared.json(), { error: `request body exceeds ${cap} bytes` })
      await assert.rejects(stat(join(root, 'seat-sounds', 'cipher')), /ENOENT/u, 'declared-too-large never touches the disk')

      // A chunked body 6 MiB long against a 4 KiB cap: nothing past the cap is written, yet a real 413 arrives (not ECONNRESET).
      const streamed = await fetch(`${origin}/amphoreus/api/seat-sound/cipher/send`, {
        method: 'PUT', headers: { 'content-type': 'audio/mpeg', 'x-amphoreus-nonce': NONCE }, body: chunkedBody(6 * 1024 * 1024),
        // @ts-expect-error undici streaming upload option
        duplex: 'half',
      })
      assert.equal(streamed.status, 413)
      assert.deepEqual(await streamed.json(), { error: `request body exceeds ${cap} bytes` })

      // Raw http client (no undici retries): an 8 MiB chunked body still sees a 413 status line.
      const raw = await new Promise<IncomingMessage>((resolveResponse, reject) => {
        const url = new URL(`${origin}/amphoreus/api/seat-sound/cipher/greeting`)
        const client = httpRequest({ host: url.hostname, port: url.port, path: url.pathname, method: 'PUT', headers: { 'content-type': 'audio/mpeg', 'x-amphoreus-nonce': NONCE, 'transfer-encoding': 'chunked' } }, resolveResponse)
        client.on('error', reject)
        const piece = Buffer.alloc(64 * 1024, 0x62)
        let sent = 0
        const pump = (): void => {
          if (client.destroyed) return
          while (sent < 8 * 1024 * 1024) {
            sent += piece.length
            if (!client.write(piece)) { client.once('drain', pump); return }
          }
          client.end()
        }
        pump()
      })
      assert.equal(raw.statusCode, 413)
      raw.resume()

      // Still usable afterwards: a small upload succeeds, and nothing was left behind by the failures.
      const ok = await fetch(`${origin}/amphoreus/api/seat-sound/cipher/send`, {
        method: 'PUT', headers: { 'content-type': 'audio/mpeg', 'x-amphoreus-nonce': NONCE }, body: Buffer.from('ID3-small'),
      })
      assert.equal(ok.status, 200)
      assert.deepEqual(await readdir(join(root, 'seat-sounds', 'cipher')), ['send.mp3'])
    } finally {
      await close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/** A slow in-process body: chunks arrive on later ticks, so the temp file's async open races them. */
function slowBody(chunks: readonly Buffer[]): IncomingMessage {
  const stream = new PassThrough()
  void (async () => {
    for (const chunk of chunks) {
      await new Promise(resolveTick => setTimeout(resolveTick, 5))
      stream.write(chunk)
    }
    stream.end()
  })()
  return stream as unknown as IncomingMessage
}

test('store.put: write-stream open failures reject instead of crashing the process; racing puts and a put racing remove stay contained', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-seat-snd-race-'))
  const uncaught: unknown[] = []
  const onUncaught = (error: unknown): void => { uncaught.push(error) }
  process.on('uncaughtException', onUncaught)
  try {
    // 1) The temp name is already taken (EEXIST on the async open): rejects, does not delete the stranger, no uncaught 'error'.
    const frozen = new SeatSoundStore(root, { tempToken: () => 'frozen' })
    await mkdir(join(root, 'seat-sounds', 'anaxa'), { recursive: true })
    await writeFile(join(root, 'seat-sounds', 'anaxa', '.upload-send-frozen.tmp'), 'stranger')
    await assert.rejects(frozen.put('anaxa', 'send', 'audio/mpeg', slowBody([Buffer.from('ID3-A'), Buffer.from('aaaa')])), (error: NodeJS.ErrnoException) => error.code === 'EEXIST')
    assert.deepEqual(await readdir(join(root, 'seat-sounds', 'anaxa')), ['.upload-send-frozen.tmp'], 'the pre-existing file is not ours to remove')
    assert.equal(frozen.get('anaxa', 'send'), undefined)
    await rm(join(root, 'seat-sounds', 'anaxa'), { recursive: true, force: true })

    // 2) Concurrent puts on one slot are serialized per hero: both settle, the later call wins, one file remains, no EPERM rename-over race.
    const store = new SeatSoundStore(root)
    await store.scan()
    const both = await Promise.all([
      store.put('cipher', 'greeting', 'audio/ogg', slowBody([Buffer.from('OggS-1')])),
      store.put('cipher', 'greeting', 'audio/ogg', slowBody([Buffer.from('OggS-22')])),
    ])
    assert.equal(both.length, 2)
    assert.deepEqual(await readdir(join(root, 'seat-sounds', 'cipher')), ['greeting.ogg'])
    assert.equal(store.get('cipher', 'greeting')?.bytes, 7, 'second writer wins')
    // put racing remove on the same hero: serialized too — the remove runs after the put lands, so both settle and the seat ends up empty.
    const [landed, removed] = await Promise.all([
      store.put('cipher', 'send', 'audio/mpeg', slowBody([Buffer.from('ID3')])),
      store.remove('cipher', 'send'),
    ])
    assert.equal(landed.slot, 'send')
    assert.equal(removed, true)
    assert.equal(store.get('cipher', 'send'), undefined)
    assert.deepEqual(await readdir(join(root, 'seat-sounds', 'cipher')), ['greeting.ogg'])

    // 3) The temp path's parent is missing (the same ENOENT a concurrent remove() of the hero dir produces between mkdir and open): rejects, prunes the empty dir.
    const missingParent = new SeatSoundStore(root, { tempToken: () => 'gone/inner' })
    await assert.rejects(missingParent.put('mydei', 'send', 'audio/wav', slowBody([Buffer.from('RIFF')])), (error: NodeJS.ErrnoException) => error.code === 'ENOENT')
    assert.equal(missingParent.get('mydei', 'send'), undefined)
    await assert.rejects(stat(join(root, 'seat-sounds', 'mydei')), /ENOENT/u, 'empty hero directory pruned after the failed put')

    // 4) The cap error is a rejection too (unit level, tiny cap), and the empty directory is pruned.
    const tiny = new SeatSoundStore(root, { maxBytes: 8 })
    await assert.rejects(tiny.put('phainon', 'send', 'audio/mpeg', slowBody([Buffer.alloc(6), Buffer.alloc(6)])), SeatSoundTooLargeError)
    await assert.rejects(stat(join(root, 'seat-sounds', 'phainon')), /ENOENT/u)

    await new Promise(resolveTick => setTimeout(resolveTick, 20))
    assert.deepEqual(uncaught, [], 'no uncaught exceptions escaped')
  } finally {
    process.off('uncaughtException', onUncaught)
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

test('serve resolves containment against the canonical root: a junction/symlinked dataDir still serves its own files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-seat-snd-link-'))
  try {
    const real = join(root, 'real-data')
    const link = join(root, 'link-data')
    await mkdir(join(real, 'seat-sounds', 'castorice'), { recursive: true })
    await writeFile(join(real, 'seat-sounds', 'castorice', 'greeting.mp3'), 'ID3-castorice')
    let linked = true
    try {
      await symlink(real, link, 'junction')
    } catch {
      linked = false // no link privilege on this machine: only the direct half is checked
    }
    const fakeResponse = () => {
      const calls: Array<{ status: number; headers: Record<string, string> }> = []
      return {
        calls,
        response: {
          writeHead(status: number, headers: Record<string, string>) { calls.push({ status, headers }) },
          end() {},
        } as unknown as ServerResponse,
      }
    }
    for (const dataDir of linked ? [real, link] : [real]) {
      const store = new SeatSoundStore(dataDir)
      await store.scan()
      assert.equal(store.list().length, 1, dataDir)
      const { calls, response } = fakeResponse()
      const served = await store.serve({ method: 'HEAD', headers: {} } as unknown as IncomingMessage, response, 'castorice', 'greeting.mp3')
      assert.equal(served, true, `${dataDir}: a record the state advertises must be servable`)
      assert.equal(calls[0]?.status, 200)
      assert.equal(calls[0]?.headers['content-length'], '13')
      // A file the index does not know (or a stranger name) is still refused.
      assert.equal(await store.serve({ method: 'HEAD', headers: {} } as unknown as IncomingMessage, fakeResponse().response, 'castorice', 'send.mp3'), false)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
