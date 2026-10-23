import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { makeInstallManifest, stageResourcePack } from '../scripts/package-with-assets.mjs'

test('ordinary artwork package retains DSH manifests and removes all installation lifecycle execution', () => {
  const source = {
    name: 'dsh-amphoreus', version: '0.5.1', files: ['lib/index.js', 'lib/client.js'],
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
    scripts: { prepare: 'build', prepublishOnly: 'check', install: 'install-deps', postinstall: 'setup', derive: 'node scripts/derive-assets.mjs' },
    peerDependencies: { '@deepseek-ai/cordis': '^4.0.5' },
  }
  const result = makeInstallManifest(source)
  assert.deepEqual(result.dsh, source.dsh)
  assert.deepEqual(result.peerDependencies, source.peerDependencies)
  assert.deepEqual(result.scripts, { derive: 'node scripts/derive-assets.mjs' })
  assert.ok(result.files.includes('resources/**'))
  assert.equal(source.scripts.prepare, 'build')
})

test('resource staging keeps only audited images and notice, never a stored preference envelope', async () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-package-resources-'))
  try {
    const source = join(root, 'source')
    const output = join(root, 'resources')
    const items = [
      ['assets/表情包/昔涟.png', 'image'],
      ['assets-cache/cyrene/sticker.webp', 'derived'],
      ['ASSETS-NOTICE.txt', 'notice'],
      ['assets-preferences.json', '{"tables":{"bindings":{"private":"must not be copied"}}}'],
    ] as const
    const files = items.map(([path, body]) => {
      const file = join(source, path)
      mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, body)
      return { path, bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') }
    })
    writeFileSync(join(source, 'bundled-assets.json'), JSON.stringify({ schemaVersion: 1, files }))
    const manifest = await stageResourcePack(source, output)
    assert.equal(manifest.originals, 1)
    assert.equal(manifest.derived, 1)
    assert.equal(existsSync(join(output, 'assets-preferences.json')), false)
    assert.equal(readFileSync(join(output, 'assets-cache/cyrene/sticker.webp'), 'utf8'), 'derived')
    assert.equal(manifest.files.length, 3)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
