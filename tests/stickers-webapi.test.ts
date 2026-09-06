import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { SuiteResolver } from '../src/host/bridge.ts'
import { loadStickerCatalog, readSticker, stickerFormatOf } from '../src/host/stickers.ts'
import type { AmphoreusStores } from '../src/host/store.ts'
import type { SuiteSnapshot } from '../src/host/suite/types.ts'
import { AmphoreusWebApi } from '../src/host/webapi.ts'
import { fixtureConfig, fixtureSnapshot } from './fixture-suite.ts'

const WEBP = Buffer.from('RIFF\x08\x00\x00\x00WEBPbody')
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1')
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('IHDRbody')])
const CATALOG = {
  version: 1,
  speakers: [{ key: 'fixture', name: '测试', aliases: ['测试席'], default: 'fixture' }],
  items: [
    { key: 'fixture', speaker: 'fixture', label: '测试', file: 'fixture.webp' },
    { key: 'fixture-happy', speaker: 'fixture', label: '开心', file: 'happy.webp' },
  ],
}
const MIXED_CATALOG = {
  ...CATALOG,
  items: [
    ...CATALOG.items,
    { key: 'fixture-wave', speaker: 'fixture', label: '挥手', file: 'wave.gif' },
    { key: 'fixture-still', speaker: 'fixture', label: '定格', file: 'still.png' },
    { key: 'fixture-liar', speaker: 'fixture', label: '扩展名不符', file: 'liar.gif' },
  ],
}

async function put(path: string, value: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value)
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-stickers-'))
  await put(join(root, 'amphoreus/assets/stickers/manifest.json'), JSON.stringify(CATALOG))
  await put(join(root, 'amphoreus/assets/stickers/fixture.webp'), WEBP)
  return root
}

async function cleanup(root: string): Promise<void> {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  assert.match(root, /amphoreus-stickers-/u)
  await rm(root, { recursive: true, force: true })
}

test('sticker catalog exposes only registered, existing WebP files and refreshes on every read', async t => {
  const root = await fixture()
  t.after(() => cleanup(root))
  const directory = join(root, 'amphoreus/assets/stickers')
  await put(join(directory, 'unregistered.webp'), WEBP)
  await put(join(directory, 'happy.webp'), 'not a webp')
  const before = await loadStickerCatalog(root)
  assert.deepEqual(before?.items.map(item => item.key), ['fixture'])
  assert.deepEqual(before?.speakers, CATALOG.speakers)
  assert.deepEqual(await readSticker(root, 'fixture'), { body: WEBP, mime: 'image/webp', ext: 'webp' })
  assert.equal(await readSticker(root, 'unregistered'), undefined)
  assert.equal(await readSticker(root, 'fixture-happy'), undefined)
  await put(join(directory, 'happy.webp'), WEBP)
  assert.deepEqual((await loadStickerCatalog(root))?.items.map(item => item.key), ['fixture', 'fixture-happy'])
  assert.deepEqual((await loadStickerCatalog(root))?.items.map(item => item.ext), ['webp', 'webp'])
  assert.deepEqual(await readSticker(root, 'fixture-happy'), { body: WEBP, mime: 'image/webp', ext: 'webp' })
  await rm(join(directory, 'fixture.webp'))
  assert.equal(await readSticker(root, 'fixture'), undefined)
  await rm(join(directory, 'manifest.json'))
  assert.equal(await loadStickerCatalog(root), undefined)
  assert.equal(await readSticker(root, 'fixture-happy'), undefined)
})

test('sticker catalog admits GIF and PNG by manifest extension and drops files whose bytes disagree with it', async t => {
  const root = await fixture()
  t.after(() => cleanup(root))
  const directory = join(root, 'amphoreus/assets/stickers')
  await put(join(directory, 'manifest.json'), JSON.stringify(MIXED_CATALOG))
  await put(join(directory, 'happy.webp'), WEBP)
  await put(join(directory, 'wave.gif'), GIF)
  await put(join(directory, 'still.png'), PNG)
  await put(join(directory, 'liar.gif'), WEBP)
  const catalog = await loadStickerCatalog(root)
  assert.deepEqual(catalog?.items.map(item => [item.key, item.ext]), [
    ['fixture', 'webp'], ['fixture-happy', 'webp'], ['fixture-wave', 'gif'], ['fixture-still', 'png'],
  ])
  assert.deepEqual(await readSticker(root, 'fixture-wave'), { body: GIF, mime: 'image/gif', ext: 'gif' })
  assert.deepEqual(await readSticker(root, 'fixture-still'), { body: PNG, mime: 'image/png', ext: 'png' })
  assert.equal(await readSticker(root, 'fixture-liar'), undefined)
  await put(join(directory, 'still.png'), GIF)
  assert.equal(await readSticker(root, 'fixture-still'), undefined)
  assert.deepEqual((await loadStickerCatalog(root))?.items.map(item => item.key), ['fixture', 'fixture-happy', 'fixture-wave'])
  assert.deepEqual(stickerFormatOf('wave.gif'), { ext: 'gif', mime: 'image/gif' })
  assert.deepEqual(stickerFormatOf('still.png'), { ext: 'png', mime: 'image/png' })
  assert.deepEqual(stickerFormatOf('fixture.webp'), { ext: 'webp', mime: 'image/webp' })
  for (const file of ['fixture.jpg', 'fixture.svg', 'fixture.WEBP', 'fixture.gif.webp', 'fixture', '.gif']) assert.equal(stickerFormatOf(file), undefined, file)
})

test('sticker catalogs reject unsupported versions, malformed relationships, duplicate keys and unsafe paths', async t => {
  const root = await fixture()
  t.after(() => cleanup(root))
  const manifest = join(root, 'amphoreus/assets/stickers/manifest.json')
  const invalid = [
    { ...CATALOG, version: 2 },
    { ...CATALOG, speakers: [...CATALOG.speakers, ...CATALOG.speakers] },
    { ...CATALOG, items: [...CATALOG.items, CATALOG.items[0]] },
    { ...CATALOG, items: [{ ...CATALOG.items[0], speaker: 'unknown' }] },
    { ...CATALOG, speakers: [{ ...CATALOG.speakers[0], default: 'missing' }] },
    ...['../fixture.webp', '..\\fixture.webp', '/fixture.webp', 'C:/fixture.webp', 'nested/fixture.webp', 'file.webp:secret', 'fixture.jpg', 'fixture.svg', 'fixture.WEBP', 'fixture.gif.webp']
      .map(file => ({ ...CATALOG, items: [{ ...CATALOG.items[0], file }] })),
    ...['../fixture', 'fixture/child', 'fixture%2fchild', 'fixture?key', 'fixture#key']
      .map(key => ({ ...CATALOG, items: [{ ...CATALOG.items[0], key }] })),
  ]
  for (const value of invalid) {
    await writeFile(manifest, JSON.stringify(value))
    assert.equal(await loadStickerCatalog(root), undefined, JSON.stringify(value))
    assert.equal(await readSticker(root, 'fixture'), undefined)
  }
  await writeFile(manifest, '{')
  assert.equal(await loadStickerCatalog(root), undefined)
})

test('sticker reads reject directory junction escape and a replaced manifest or file symlink', async t => {
  const root = await fixture()
  const outside = await fixture()
  t.after(() => cleanup(root))
  t.after(() => cleanup(outside))
  const directory = join(root, 'amphoreus/assets/stickers')
  const outsideDirectory = join(outside, 'amphoreus/assets/stickers')
  const held = join(root, 'held-stickers')
  await rename(directory, held)
  await symlink(outsideDirectory, directory, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(await loadStickerCatalog(root), undefined)
  assert.equal(await readSticker(root, 'fixture'), undefined)
  await rm(directory)
  await rename(held, directory)
  for (const file of ['manifest.json', 'fixture.webp']) {
    const path = join(directory, file)
    const original = await readFile(path)
    await rm(path)
    try {
      await symlink(join(outsideDirectory, file), path, 'file')
      assert.equal(await readSticker(root, 'fixture'), undefined)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
    } finally {
      await rm(path, { force: true })
      await writeFile(path, original)
    }
  }
})

test('sticker HTTP route fences hosts and credentials, uses live primary root, and never caches media', async t => {
  const root = await fixture()
  const replacement = await fixture()
  t.after(() => cleanup(root))
  t.after(() => cleanup(replacement))
  const snapshot = fixtureSnapshot()
  let current: SuiteSnapshot | undefined = { ...snapshot, root: { ...snapshot.root!, canonical: root } }
  const ctx = { connection: { requestRejection: (request: { headers: { cookie?: string } }) => request.headers.cookie === 'authorized=true' ? undefined : 401 } }
  const api = new AmphoreusWebApi(ctx as unknown as Context, {
    config: fixtureConfig(), stores: {} as AmphoreusStores,
    resolver: { current: () => current } as unknown as SuiteResolver,
  })
  const server = createServer((request, response) => { void api.handle(request, response) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.close(); await once(server, 'close') })
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const headers = { cookie: 'authorized=true' }
  const path = '/amphoreus/stickers/fixture.webp'
  assert.equal((await fetch(origin + path)).status, 401)
  const untrusted = await new Promise<number | undefined>((resolveStatus, reject) => {
    const request = httpRequest(origin + path, { headers: { ...headers, host: 'evil.invalid' } }, response => { response.resume(); resolveStatus(response.statusCode) })
    request.on('error', reject)
    request.end()
  })
  assert.equal(untrusted, 403)
  const first = await fetch(origin + path, { headers })
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('content-type'), 'image/webp')
  assert.equal(first.headers.get('content-length'), String(WEBP.length))
  assert.equal(first.headers.get('cache-control'), 'no-store')
  assert.equal(first.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), WEBP)
  for (const tail of ['unknown.webp', 'fixture.png', 'fixture.gif', 'fixture.jpg', 'fixture.webp/extra', '%2e%2e%2ffixture.webp', '%2e%2e%5cfixture.webp', '%2ffixture.webp', 'fixture%00.webp']) {
    assert.equal((await fetch(`${origin}/amphoreus/stickers/${tail}`, { headers })).status, 404, tail)
  }
  const traversal = await new Promise<number | undefined>((resolveStatus, reject) => {
    const request = httpRequest(origin, { path: '/amphoreus/stickers/../manifest.json', headers }, response => { response.resume(); resolveStatus(response.statusCode) })
    request.on('error', reject)
    request.end()
  })
  assert.equal(traversal, 404)
  const post = await fetch(origin + path, { method: 'POST', headers })
  assert.equal(post.status, 405)
  assert.equal(post.headers.get('allow'), 'GET')
  const changed = Buffer.concat([WEBP, Buffer.from('changed')])
  await writeFile(join(root, 'amphoreus/assets/stickers/fixture.webp'), changed)
  assert.deepEqual(Buffer.from(await (await fetch(origin + path, { headers })).arrayBuffer()), changed)
  current = { ...snapshot, root: { ...snapshot.root!, canonical: replacement } }
  assert.deepEqual(Buffer.from(await (await fetch(origin + path, { headers })).arrayBuffer()), WEBP)
  await rm(join(replacement, 'amphoreus/assets/stickers/manifest.json'))
  assert.equal((await fetch(origin + path, { headers })).status, 404)
  current = undefined
  assert.equal((await fetch(origin + path, { headers })).status, 404)
})

test('sticker HTTP route serves GIF and PNG with their own mime and refuses a key under a different extension', async t => {
  const root = await fixture()
  t.after(() => cleanup(root))
  const directory = join(root, 'amphoreus/assets/stickers')
  await put(join(directory, 'manifest.json'), JSON.stringify(MIXED_CATALOG))
  await put(join(directory, 'wave.gif'), GIF)
  await put(join(directory, 'still.png'), PNG)
  await put(join(directory, 'liar.gif'), WEBP)
  const snapshot = fixtureSnapshot()
  const current: SuiteSnapshot = { ...snapshot, root: { ...snapshot.root!, canonical: root } }
  const ctx = { connection: { requestRejection: () => undefined } }
  const api = new AmphoreusWebApi(ctx as unknown as Context, {
    config: fixtureConfig(), stores: {} as AmphoreusStores,
    resolver: { current: () => current } as unknown as SuiteResolver,
  })
  const server = createServer((request, response) => { void api.handle(request, response) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.close(); await once(server, 'close') })
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}/amphoreus/stickers/`
  for (const [tail, mime, body] of [['fixture-wave.gif', 'image/gif', GIF], ['fixture-still.png', 'image/png', PNG], ['fixture.webp', 'image/webp', WEBP]] as const) {
    const response = await fetch(origin + tail)
    assert.equal(response.status, 200, tail)
    assert.equal(response.headers.get('content-type'), mime)
    assert.equal(response.headers.get('content-length'), String(body.length))
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), body)
  }
  for (const tail of ['fixture.gif', 'fixture.png', 'fixture-wave.webp', 'fixture-wave.png', 'fixture-still.gif', 'fixture-liar.gif', 'fixture-liar.webp', 'fixture-wave.GIF']) {
    assert.equal((await fetch(origin + tail)).status, 404, tail)
  }
})

const realSuite = process.env.AMPHOREUS_REAL_SUITE

test('AMPHOREUS_REAL_SUITE sticker manifest loads every registered item', { skip: realSuite === undefined ? 'AMPHOREUS_REAL_SUITE is not set' : false }, async () => {
  const expanded = realSuite!.replace(/^~(?=$|[\\/])/u, () => process.env.HOME ?? process.env.USERPROFILE ?? '~')
  const catalog = await loadStickerCatalog(resolve(expanded))
  assert.notEqual(catalog, undefined)
  assert.equal(catalog!.items.length, 96)
  assert.ok(catalog!.items.every(item => item.file === `${item.file.slice(0, item.file.lastIndexOf('.'))}.${item.ext}`))
})
