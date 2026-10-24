import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { makeInstallManifest, packageWithAssets, stageResourcePack } from '../scripts/package-with-assets.mjs'

test('ordinary artwork package retains DSH manifests and removes all installation lifecycle execution', () => {
  const source = {
    name: 'dsh-amphoreus', version: '0.5.1', files: ['lib/index.js', 'lib/client.js'],
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
    scripts: { prepare: 'build', prepublishOnly: 'check', install: 'install-deps', postinstall: 'setup', derive: 'node scripts/derive-assets.mjs' },
    peerDependencies: { '@deepseek-ai/cordis': '^4.0.5' },
  }
  const result = makeInstallManifest(source, 'a'.repeat(40))
  assert.deepEqual(result.dsh, source.dsh)
  assert.deepEqual(result.peerDependencies, source.peerDependencies)
  assert.deepEqual(result.scripts, { derive: 'node scripts/derive-assets.mjs' })
  assert.ok(result.files.includes('resources/**'))
  assert.equal(source.scripts.prepare, 'build')
  assert.equal(result.gitHead, 'a'.repeat(40))
})

test('complete package requires a full source identity and replaces stale manifest gitHead', () => {
  const source = { name: 'dsh-amphoreus', version: '0.5.1', gitHead: 'b'.repeat(40) }
  for (const identity of [undefined, '', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), 'main', 123]) {
    assert.throws(() => makeInstallManifest(source, identity), /source commit from Git HEAD/u)
  }
  const current = makeInstallManifest(source, 'c'.repeat(40))
  assert.equal(current.gitHead, 'c'.repeat(40))
  assert.equal(source.gitHead, 'b'.repeat(40))
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

test('complete tarball and provenance use the actual Git HEAD rather than a stale manifest identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-package-git-head-'))
  try {
    const plugin = join(root, 'plugin')
    const assets = join(root, 'artwork')
    const put = (directory: string, path: string, body: string) => {
      const file = join(directory, path)
      mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, body)
    }
    put(plugin, 'package.json', JSON.stringify({
      name: 'dsh-amphoreus', version: '0.0.0', type: 'module', gitHead: 'f'.repeat(40),
      files: ['lib/*.js', 'cordis.patch.yml'], dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
    }))
    for (const name of ['index', 'client', 'derive']) put(plugin, `lib/${name}.js`, 'export {}\n')
    put(plugin, 'cordis.patch.yml', '[]\n')
    const git = (...args: string[]) => execFileSync('git', args, { cwd: plugin, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    git('init', '-q')
    git('add', '.')
    git('-c', 'user.name=Package test', '-c', 'user.email=package-test@example.invalid', '-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=.git/no-hooks', 'commit', '-qm', 'fixture')
    const head = git('rev-parse', 'HEAD')
    const files = ['assets/image.png', 'assets-cache/cyrene/sticker.webp', 'ASSETS-NOTICE.txt'].map(path => {
      const body = `fixture ${path}`
      put(assets, path, body)
      return { path, bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') }
    })
    put(assets, 'bundled-assets.json', JSON.stringify({ schemaVersion: 1, files }))
    const result = await packageWithAssets({ plugin, assets, output: join(root, 'output') })
    const packed = JSON.parse(execFileSync('tar', ['-xOzf', result.tarball, 'package/package.json'], { encoding: 'utf8' }))
    assert.equal(packed.gitHead, head)
    assert.equal(result.provenance.sourceCommit, head)
    assert.equal(result.provenance.sourceDiffSha256, createHash('sha256').update('').digest('hex'))
    assert.equal(git('status', '--porcelain'), '')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
