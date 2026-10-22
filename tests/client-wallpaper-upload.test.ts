import assert from 'node:assert/strict'
import { test } from 'node:test'
import { prepareWallpaperUpload } from '../src/client/wallpaper-upload.ts'
import { wallpaperUploadMime } from '../src/shared/wallpaper-media.ts'
import { AmphoreusClientModel } from '../src/client/state.ts'

class Video extends EventTarget {
  src = ''; muted = false; preload = ''; playsInline = false
  readyState = 0; videoWidth = 0; videoHeight = 0; paused = false
  load(): void {}
  pause(): void { this.paused = true }
  removeAttribute(name: string): void { if (name === 'src') this.src = '' }
}

async function harness(run: (h: {
  video: Video; revoked: string[]; timers: Map<number, () => void>
  decode(fn: () => Promise<void>): void
  fetch(fn: typeof fetch): void
}) => Promise<void>) {
  const previous = new Map(['window', 'Image', 'document', 'fetch'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL
  const video = new Video(), revoked: string[] = [], timers = new Map<number, () => void>()
  let id = 0, decode = async () => {}
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    __AMPHOREUS_BOOT__: { nonce: 'wallpaper-test-nonce' },
    setTimeout(fn: () => void) { timers.set(++id, fn); return id }, clearTimeout(key: number) { timers.delete(key) },
  } })
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {
    src = ''; naturalWidth = 320; naturalHeight = 180
    decode(): Promise<void> { return decode() }
  } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (tag: string) => { assert.equal(tag, 'video'); return video } } })
  URL.createObjectURL = () => 'blob:wallpaper-test'
  URL.revokeObjectURL = url => revoked.push(url)
  try { await run({ video, revoked, timers, decode: fn => { decode = fn }, fetch: fn => { Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fn }) } }) }
  finally {
    for (let tick = 0; tick < 12; tick++) await Promise.resolve()
    URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke
    for (const [name, descriptor] of previous) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name)
      else Object.defineProperty(globalThis, name, descriptor)
    }
  }
}

test('empty browser MIME uses a supported filename extension without accepting unrelated declared formats', () => {
  assert.equal(wallpaperUploadMime({ name: 'wallpaper.PNG', type: '' }), 'image/png')
  assert.equal(wallpaperUploadMime({ name: 'wallpaper.JPEG', type: 'application/octet-stream' }), 'image/jpeg')
  assert.equal(wallpaperUploadMime({ name: 'wallpaper.webm', type: '' }), 'video/webm')
  assert.equal(wallpaperUploadMime({ name: 'wallpaper.mp4', type: 'video/quicktime' }), undefined)
  assert.equal(wallpaperUploadMime({ name: 'wallpaper.heic', type: '' }), undefined)
})

test('image preflight decodes the selected file, releases its object URL, and gives an actionable error before upload', async () => {
  await harness(async h => {
    assert.equal(await prepareWallpaperUpload(new File(['png'], 'image.png')), 'image/png')
    assert.deepEqual(h.revoked, ['blob:wallpaper-test'])
    h.decode(async () => { throw new Error('invalid PNG') })
    await assert.rejects(prepareWallpaperUpload(new File(['broken'], 'image.png')), /重新导出.*原壁纸未改变/u)
    assert.equal(h.timers.size, 0)
    assert.equal(h.revoked.length, 2)
    await assert.rejects(prepareWallpaperUpload(new File([], 'empty.png')), /文件为空/u)
  })
})

test('video preflight waits for a decoded frame and rejects unsupported codecs without leaving a player running', async () => {
  await harness(async h => {
    const pending = prepareWallpaperUpload(new File(['webm'], 'clip.webm'))
    h.video.readyState = 1
    h.video.dispatchEvent(new Event('loadeddata'))
    assert.equal(h.revoked.length, 0)
    h.video.readyState = 2; h.video.videoWidth = 320; h.video.videoHeight = 180
    h.video.dispatchEvent(new Event('loadeddata'))
    assert.equal(await pending, 'video/webm')
    assert.equal(h.video.paused, true)
    assert.equal(h.video.src, '')
    const failed = prepareWallpaperUpload(new File(['bad'], 'clip.mp4'))
    h.video.dispatchEvent(new Event('error'))
    await assert.rejects(failed, /H\.264.*VP9\/VP8/u)
    assert.equal(h.timers.size, 0)
    assert.equal(h.revoked.length, 2)
  })
})

test('media preflight timeout and cancellation release pending media resources', async () => {
  await harness(async h => {
    h.decode(() => new Promise(() => {}))
    const timeout = prepareWallpaperUpload(new File(['png'], 'image.png'))
    h.timers.values().next().value!()
    await assert.rejects(timeout, /读取超时/u)
    const abort = new AbortController()
    const canceled = prepareWallpaperUpload(new File(['png'], 'image.png'), abort.signal)
    abort.abort(new Error('plugin stopped'))
    await assert.rejects(canceled, /plugin stopped/u)
    assert.equal(h.timers.size, 0)
    assert.equal(h.revoked.length, 2)
  })
})

test('client upload sends the inferred MIME only after decode, relies on host activation, and skips writes on decode failure', async () => {
  await harness(async h => {
    const calls: { url: string; init?: RequestInit }[] = []
    h.fetch(async (url, init) => {
      calls.push({ url: String(url), ...(init === undefined ? {} : { init }) })
      return Response.json(init?.method === 'PUT' ? { wallpaper: {} } : { nonce: 'wallpaper-test-nonce', assets: { running: false } })
    })
    const model = new AmphoreusClientModel()
    try {
      await model.uploadCustomWallpaper('global', new File(['png'], 'image.PNG'))
      assert.equal(calls.length, 2)
      assert.equal(calls[0]!.url, '/amphoreus/api/custom-wallpaper/global')
      assert.equal(new Headers(calls[0]!.init!.headers).get('content-type'), 'image/png')
      assert.equal(calls[1]!.url, '/amphoreus/api/state')
      h.decode(async () => { throw new Error('bad image') })
      await assert.rejects(model.uploadCustomWallpaper('cyrene', new File(['broken'], 'image.png')), /原壁纸未改变/u)
      assert.equal(calls.length, 2)
    } finally { model.close() }
  })
})

test('a saved upload with failed state readback reports saved but unsynchronized, never an unchanged wallpaper', async () => {
  await harness(async h => {
    h.fetch(async (_url, init) => init?.method === 'PUT' ? Response.json({ wallpaper: {} }) : new Response('{}', { status: 500 }))
    const model = new AmphoreusClientModel()
    try {
      await assert.rejects(model.uploadCustomWallpaper('global', new File(['png'], 'image.png')), error => {
        assert.match(String(error), /已保存.*同步失败/u)
        assert.doesNotMatch(String(error), /原壁纸未改变/u)
        return true
      })
    } finally { model.close() }
  })
})

test('upload deadline releases the pending action and requests readback without claiming whether the host committed', async () => {
  await harness(async h => {
    let signal: AbortSignal | undefined, reads = 0
    h.fetch(async (_url, init) => {
      if (init?.method === 'PUT') { signal = init.signal ?? undefined; return new Promise(() => {}) }
      reads++; return Response.json({ assets: { running: false } })
    })
    const model = new AmphoreusClientModel()
    try {
      const upload = model.uploadCustomWallpaper('global', new File(['png'], 'image.png'))
      for (let i = 0; i < 12; i++) await Promise.resolve()
      assert.equal(h.timers.size, 1, 'upload owns a deadline after media preflight completes')
      h.timers.values().next().value!()
      await assert.rejects(upload, error => {
        assert.match(String(error), /结果未确认/u)
        assert.doesNotMatch(String(error), /原壁纸未改变/u)
        return true
      })
      assert.equal(signal?.aborted, true)
      assert.equal(reads, 1)
    } finally { model.close() }
  })
})

test('closing during a stalled upload immediately aborts and settles the pending operation', async () => {
  await harness(async h => {
    let signal: AbortSignal | undefined
    h.fetch(async (_url, init) => { signal = init?.signal ?? undefined; return new Promise(() => {}) })
    const model = new AmphoreusClientModel()
    const upload = model.uploadCustomWallpaper('global', new File(['png'], 'image.png'))
    for (let i = 0; i < 12; i++) await Promise.resolve()
    model.close()
    await assert.rejects(upload)
    assert.equal(signal?.aborted, true)
    assert.equal(h.timers.size, 0)
  })
})
