import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { discoverBundledResources, inspectBundledResources, parseBundledResourceManifest, prepareBundledResources } from '../src/host/bundled-resources.ts'

function fixture(root: string) {
  const contents = [
    ['assets/表情包/昔涟.png', 'original image fixture'],
    ['assets-cache/cyrene/cover-34.webp', 'derived image fixture'],
    ['ASSETS-NOTICE.txt', 'Artwork notice'],
  ] as const
  const files = contents.map(([path, body]) => {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, body)
    return { path, bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') }
  })
  const manifest = { schemaVersion: 1, originals: 1, derived: 1, bytes: files.reduce((n, f) => n + f.bytes, 0), files }
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest))
  return manifest
}

test('ordinary plugin discovers resources from both compiled and source module locations', async () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-plugin-resources-'))
  try {
    writeFileSync(join(root, 'package.json'), '{"name":"dsh-amphoreus"}')
    assert.equal(await discoverBundledResources(pathToFileURL(join(root, 'lib/index.js'))), undefined)
    fixture(join(root, 'resources'))
    assert.equal(await discoverBundledResources(pathToFileURL(join(root, 'lib/index.js'))), join(root, 'resources'))
    assert.equal(await discoverBundledResources(pathToFileURL(join(root, 'src/host/bundled-resources.ts'))), join(root, 'resources'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('ordinary plugin fills missing derived images and returns fresh-store visual defaults without writing storage', async () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-resource-seed-'))
  try {
    const resourcesRoot = join(root, 'resources')
    const dataDir = join(root, 'data')
    fixture(resourcesRoot)
    const result = await prepareBundledResources({ resourcesRoot, dataDir, configuredAssetsRoot: '', hasExistingStore: false })
    assert.equal(result?.assetsRoot, join(resourcesRoot, 'assets'))
    assert.equal(result?.copiedFiles, 1)
    assert.equal(result?.defaultPrefs?.backgroundMode, 'preset')
    assert.equal(result?.defaultPrefs?.magazineMode, 'full')
    assert.equal(existsSync(join(root, 'storages')), false)
    const file = join(dataDir, 'assets-cache/cyrene/cover-34.webp')
    writeFileSync(file, 'user image')
    const existing = await prepareBundledResources({ resourcesRoot, dataDir, configuredAssetsRoot: '', hasExistingStore: true })
    assert.equal(existing?.copiedFiles, 0)
    assert.equal(existing?.defaultPrefs, undefined)
    assert.equal(readFileSync(file, 'utf8'), 'user image')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('explicit profile and saved artwork roots take priority without touching the cache', async () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-resource-root-'))
  try {
    const dataDir = join(root, 'data')
    assert.equal(await prepareBundledResources({ resourcesRoot: join(root, 'unused'), dataDir, configuredAssetsRoot: 'user assets', hasExistingStore: false }), undefined)
    assert.equal(await prepareBundledResources({ resourcesRoot: join(root, 'unused'), dataDir, configuredAssetsRoot: '', savedAssetsRoot: 'saved assets', hasExistingStore: false }), undefined)
    assert.equal(existsSync(dataDir), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('resource integrity failure rejects startup before creating cache files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-resource-integrity-'))
  try {
    const resourcesRoot = join(root, 'resources')
    const dataDir = join(root, 'data')
    fixture(resourcesRoot)
    writeFileSync(join(resourcesRoot, 'assets-cache/cyrene/cover-34.webp'), 'changed image')
    await assert.rejects(prepareBundledResources({ resourcesRoot, dataDir, configuredAssetsRoot: '', hasExistingStore: false }), /integrity mismatch/u)
    assert.equal(existsSync(dataDir), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('resource manifests reject traversal, data files and inconsistent byte limits', () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-resource-manifest-'))
  try {
    const manifest = fixture(root)
    for (const path of ['assets/../../settings.yaml', 'assets-cache/cyrene/../../sessions', 'assets-preferences.json', 'assets/skills/SKILL.md']) {
      assert.throws(() => parseBundledResourceManifest({ ...manifest, files: [{ ...manifest.files[0], path }, ...manifest.files.slice(1)] }), /Invalid bundled resource path|Unexpected bundled resource/u)
    }
    assert.throws(() => parseBundledResourceManifest({ ...manifest, bytes: 256 * 1024 * 1024 + 1 }), /totals/u)
    assert.throws(() => parseBundledResourceManifest({ ...manifest, files: [...manifest.files, manifest.files[0]] }), /Duplicate/u)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a present resources directory without its manifest fails clearly', async () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-resource-missing-'))
  try { await assert.rejects(inspectBundledResources(root), /manifest\.json/u) }
  finally { rmSync(root, { recursive: true, force: true }) }
})
