import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assembleArchive, MAX_CHUNK_BYTES, splitArchive, validateManifest } from '../scripts/release-chunks.mjs'

const release = { package: 'dsh-amphoreus', version: '0.5.1', originGitHead: 'a'.repeat(40) }

async function fixture(root: string) {
  const archive = join(root, 'fixture.tgz')
  const body = Buffer.from(Array.from({ length: 103 }, (_, index) => index))
  writeFileSync(archive, body)
  const chunks = join(root, 'parts')
  const split = await splitArchive({ archive, out: chunks, release, chunkBytes: 25 })
  return { archive, body, chunks, split }
}

test('release chunks reassemble byte-exactly with bounded ordered files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-chunks-'))
  try {
    const { body, chunks, split } = await fixture(root)
    assert.equal(split.parts.length, 5)
    assert.ok(split.parts.every(part => part.bytes <= MAX_CHUNK_BYTES))
    assert.equal(split.sha256, createHash('sha256').update(body).digest('hex'))
    const out = join(root, 'reassembled.tgz')
    const result = await assembleArchive({ manifest: split.manifest, parts: chunks, out })
    assert.deepEqual(readFileSync(out), body)
    assert.equal(result.sha256, split.sha256)
    await assert.rejects(assembleArchive({ manifest: split.manifest, parts: chunks, out }), /Refusing to replace/u)
    assert.deepEqual(readFileSync(out), body)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('tampered or missing chunks fail without leaving an assembled archive', async () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-chunks-invalid-'))
  try {
    const { chunks, split } = await fixture(root)
    const path = join(chunks, split.parts[0]!.file)
    const original = readFileSync(path)
    const modified = Buffer.from(original); modified[0] = 255
    writeFileSync(path, modified)
    const out = join(root, 'failed.tgz')
    await assert.rejects(assembleArchive({ manifest: split.manifest, parts: chunks, out }), /integrity mismatch/u)
    assert.equal(existsSync(out), false)
    assert.equal(readdirSync(root).some(file => file.endsWith('.tmp')), false)
    writeFileSync(path, original); unlinkSync(path)
    await assert.rejects(assembleArchive({ manifest: split.manifest, parts: chunks, out }), /ENOENT/u)
    assert.equal(existsSync(out), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('chunk manifests reject reordering, traversal, and excessive chunk sizes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-chunks-manifest-'))
  try {
    const { split } = await fixture(root)
    const manifest = JSON.parse(readFileSync(split.manifest, 'utf8'))
    assert.throws(() => validateManifest({ ...manifest, parts: [...manifest.parts].reverse() }), /unordered/u)
    for (const file of ['../escape', '/tmp/escape', 'C:\\escape', 'nested/part']) {
      assert.throws(() => validateManifest({ ...manifest, parts: [{ ...manifest.parts[0], file }, ...manifest.parts.slice(1)] }), /unordered/u)
    }
    assert.throws(() => validateManifest({ ...manifest, archive: '../escape.tgz' }), /Invalid release chunk manifest/u)
    assert.throws(() => validateManifest({ ...manifest, chunkBytes: MAX_CHUNK_BYTES + 1 }), /Invalid release chunk manifest/u)
    assert.throws(() => validateManifest({ ...manifest, parts: manifest.parts.slice(1) }), /Invalid release chunk manifest/u)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('whole-archive digest is checked independently of valid part digests', async () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-chunks-whole-'))
  try {
    const { chunks, split } = await fixture(root)
    const manifest = JSON.parse(readFileSync(split.manifest, 'utf8'))
    writeFileSync(split.manifest, JSON.stringify({ ...manifest, sha256: '0'.repeat(64) }))
    const out = join(root, 'failed.tgz')
    await assert.rejects(assembleArchive({ manifest: split.manifest, parts: chunks, out }), /original archive/u)
    assert.equal(existsSync(out), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
