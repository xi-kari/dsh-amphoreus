import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { seedDesktopAssets, validateBundledAssets } from '../scripts/bundled-assets.mjs'

function fixture(root: string) {
  const files = [
    ['assets/表情包/昔涟.png', Buffer.from('fixture original')],
    ['assets-cache/cyrene/cover-34.webp', Buffer.from('fixture derived')],
    ['assets-preferences.json', Buffer.from('{"unit":{"name":"amphoreus","version":1},"global":{"seeded":false},"tables":{}}\n')],
  ] as const
  const records = files.map(([path, bytes]) => {
    const full = join(root, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, bytes)
    return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  })
  writeFileSync(join(root, 'bundled-assets.json'), JSON.stringify({ schemaVersion: 1, files: records }))
  return records
}

test('bundled assets seed clean preferences and missing images without replacing user state', () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-bundled-assets-'))
  try {
    const payload = join(root, 'payload')
    const home = join(root, 'home')
    fixture(payload)
    assert.equal(seedDesktopAssets(payload, home), join(payload, 'assets'))
    const image = join(home, 'amphoreus', 'assets-cache', 'cyrene', 'cover-34.webp')
    const store = join(home, 'storages', 'amphoreus.json')
    assert.equal(readFileSync(image, 'utf8'), 'fixture derived')
    assert.equal(readFileSync(store, 'utf8'), readFileSync(join(payload, 'assets-preferences.json'), 'utf8'))
    writeFileSync(image, 'user image')
    writeFileSync(store, '{"user":"preferences, bindings and memory remain untouched"}')
    seedDesktopAssets(payload, home)
    assert.equal(readFileSync(image, 'utf8'), 'user image')
    assert.equal(readFileSync(store, 'utf8'), '{"user":"preferences, bindings and memory remain untouched"}')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('bundled assets reject tampering before writing any data to a new home', () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-bundled-tamper-'))
  try {
    const payload = join(root, 'payload')
    const home = join(root, 'home')
    fixture(payload)
    writeFileSync(join(payload, 'assets-cache', 'cyrene', 'cover-34.webp'), 'tampered')
    assert.throws(() => seedDesktopAssets(payload, home), /integrity mismatch/u)
    assert.equal(existsSync(home), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('bundled assets reject traversal and unexpected non-image payloads', () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-bundled-path-'))
  try {
    const records = fixture(root)
    for (const path of ['assets/../../settings.yaml', 'sessions/private.json', 'assets\\image.png']) {
      writeFileSync(join(root, 'bundled-assets.json'), JSON.stringify({ schemaVersion: 1, files: [{ ...records[0], path }, records[2]] }))
      assert.throws(() => validateBundledAssets(root), /Invalid bundled asset path|Unexpected bundled asset/u)
    }
    assert.equal(seedDesktopAssets(join(root, 'absent'), join(root, 'home')), undefined)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
