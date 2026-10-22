import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { CustomWallpaperStore } from '../src/host/custom-wallpapers.ts'

const incoming = (bytes: string) => Readable.from([Buffer.from(bytes)]) as unknown as IncomingMessage

test('a failed preference commit restores the previous wallpaper bytes and record for same and different file types', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-wp-transaction-'))
  try {
    const store = new CustomWallpaperStore(root)
    const old = await store.put('global', 'image/png', incoming('old image'))
    for (const mime of ['image/png', 'video/mp4']) {
      await assert.rejects(store.put('global', mime, incoming('new media'), async () => { throw new Error('preference write failed') }), /preference write failed/u)
      assert.deepEqual(store.get('global'), old)
      assert.equal(await readFile(join(store.root, 'global', old.file), 'utf8'), 'old image')
      assert.deepEqual((await readdir(join(store.root, 'global'))).filter(name => name.startsWith('wallpaper.')), ['wallpaper.png'])
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a stream failure keeps the active wallpaper and removes its incomplete upload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amphoreus-wp-stream-'))
  try {
    const store = new CustomWallpaperStore(root)
    const old = await store.put('cyrene', 'image/png', incoming('old image'))
    const broken = Readable.from((async function* () { yield Buffer.from('partial'); throw new Error('upload interrupted') })()) as unknown as IncomingMessage
    await assert.rejects(store.put('cyrene', 'video/webm', broken), /upload interrupted/u)
    assert.deepEqual(store.get('cyrene'), old)
    assert.equal(await readFile(join(store.root, 'cyrene', old.file), 'utf8'), 'old image')
    assert.equal((await readdir(join(store.root, 'cyrene'))).some(name => name.endsWith('.tmp')), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
