import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import test from 'node:test'
import { RELEASE, assertNoTagDowngrade, assertWorkflowContext, inspectPackageArchive, registryPublishAction,
  releaseFromManifest, selectDraftRelease, validateArchiveEntries, validateUploadManifest } from '../scripts/cloud-publish.mjs'

const target = 'a'.repeat(40)

test('cloud release identity follows the checked-out package version', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(RELEASE.version, manifest.version)
  assert.equal(RELEASE.tag, `v${manifest.version}`)
  const next = releaseFromManifest({ name: 'dsh-amphoreus', version: '1.2.3' })
  assert.equal(next.tag, 'v1.2.3')
  assert.equal(next.filename, 'dsh-amphoreus-1.2.3-with-assets.tgz')
  assert.throws(() => releaseFromManifest({ name: 'other-package', version: '1.2.3' }))
  for (const version of ['1.2', '01.2.3', '1.2.3-beta.1', '1.2.3+metadata', '../escape']) {
    assert.throws(() => releaseFromManifest({ name: 'dsh-amphoreus', version }))
  }
})

test('cloud publishing requires the exact main workflow and an approved manifest digest', () => {
  const environment = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: RELEASE.repository,
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: target,
    GITHUB_WORKFLOW_REF: `${RELEASE.repository}/.github/workflows/cloud-publish.yml@refs/heads/main`,
    RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Linux', RELEASE_TAG: RELEASE.tag,
    MANIFEST_SHA256: 'b'.repeat(64), ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/oidc', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture' }
  assert.doesNotThrow(() => assertWorkflowContext(environment))
  for (const changed of [{ GITHUB_REF: 'refs/heads/feature' }, { GITHUB_REPOSITORY: 'other/repo' },
    { GITHUB_EVENT_NAME: 'pull_request' }, { RUNNER_ENVIRONMENT: 'self-hosted' }, { NODE_AUTH_TOKEN: 'traditional-token' },
    { NPM_TOKEN: 'traditional-token' }, { RELEASE_TAG: 'v0.0.0' }, { MANIFEST_SHA256: '' },
    { ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' }]) {
    assert.throws(() => assertWorkflowContext({ ...environment, ...changed }))
  }
})

test('release lookup requires a unique same-tag draft and does not reuse an older release', () => {
  const release = { id: 12345, tag_name: RELEASE.tag, draft: true, prerelease: false, target_commitish: target }
  const other = { ...release, id: 12344, tag_name: 'v0.0.0' }
  assert.equal(selectDraftRelease([other, release], target), release)
  for (const releases of [[], [other], [release, { ...release, id: 54321 }],
    [{ ...release, draft: false }], [{ ...release, prerelease: true }], [{ ...release, id: undefined }],
    [{ ...release, target_commitish: 'main' }], [{ ...release, target_commitish: 'd'.repeat(40) }]]) {
    assert.throws(() => selectDraftRelease(releases, target))
  }
})

test('approved upload identity must already match the workflow commit without restamping', () => {
  const manifest = { schemaVersion: 1, package: RELEASE.package, version: RELEASE.version, originGitHead: target,
    archive: RELEASE.filename, bytes: 3, sha256: 'b'.repeat(64), chunkBytes: 3,
    parts: [{ file: `upload-${RELEASE.tag}.part-0000`, bytes: 3, sha256: 'c'.repeat(64) }] }
  const before = structuredClone(manifest)
  assert.deepEqual(validateUploadManifest(manifest, target), manifest)
  assert.deepEqual(manifest, before)
  assert.throws(() => validateUploadManifest(manifest, 'd'.repeat(40)), /already be built/u)
  assert.throws(() => validateUploadManifest({ ...manifest, originGitHead: 'e'.repeat(40) }, target), /already be built/u)
  assert.throws(() => validateUploadManifest({ ...manifest, archive: 'old-package.tgz' }, target))
  assert.throws(() => validateUploadManifest({ ...manifest, sha256: undefined }, target))
  assert.throws(() => validateUploadManifest({ ...manifest, version: '0.0.0' }, target))
})

test('cloud package checks reject traversal, links, and private payloads', () => {
  assert.doesNotThrow(() => validateArchiveEntries(['package/package.json', 'package/lib/index.js'], ['-rw-r--r-- package/package.json', '-rw-r--r-- package/lib/index.js']))
  for (const path of ['../escape', 'package/../../escape', '/package/a', 'package/a\\b', 'package/sessions/log.jsonl', 'package/SKILL.md']) {
    assert.throws(() => validateArchiveEntries([path], ['-rw-r--r--']))
  }
  assert.throws(() => validateArchiveEntries(['package/a', 'package/a'], ['-rw-r--r--', '-rw-r--r--']))
  assert.throws(() => validateArchiveEntries(['package/a'], ['lrwxrwxrwx']))
})

test('idempotent publishing requires matching immutable metadata and cannot downgrade tags', () => {
  const state = { sourceCommit: target, integrity: 'sha512-fixture' }
  assert.equal(registryPublishAction({ versions: {} }, state), 'publish')
  const registry = { versions: { [RELEASE.version]: { gitHead: target, dist: { integrity: state.integrity } } } }
  assert.equal(registryPublishAction(registry, state), 'skip')
  assert.throws(() => registryPublishAction(registry, { ...state, sourceCommit: 'c'.repeat(40) }))
  assert.throws(() => registryPublishAction(registry, { ...state, integrity: 'sha512-different' }))
  assert.doesNotThrow(() => assertNoTagDowngrade({ alpha: RELEASE.version, latest: '0.0.0' }))
  const [major, minor, patch] = RELEASE.version.split('.').map(Number)
  assert.throws(() => assertNoTagDowngrade({ latest: `${major}.${minor}.${patch + 1}` }))
})

test('a full offline archive must carry 77 originals, 108 derived images and their exact hashes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-cloud-test-'))
  try {
    const packageRoot = join(root, 'package')
    const files: Array<{ path: string; bytes: number; sha256: string }> = []
    const write = (path: string, content: string) => {
      const file = join(packageRoot, path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, content)
    }
    const manifest = { name: RELEASE.package, version: RELEASE.version, gitHead: target,
      dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } } }
    write('package.json', JSON.stringify(manifest))
    write('lib/index.js', 'export const name = "fixture"')
    write('lib/client.js', 'fixture client')
    write('cordis.patch.yml', '[]')
    const resource = (path: string) => {
      const content = `fixture:${path}`
      write('resources/' + path, content)
      files.push({ path, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') })
    }
    for (let index = 0; index < 77; index += 1) resource(`assets/image-${index}.png`)
    for (let index = 0; index < 108; index += 1) resource(`assets-cache/_global/image-${index}.webp`)
    resource('ASSETS-NOTICE.txt')
    write('resources/manifest.json', JSON.stringify({ schemaVersion: 1, originals: 77, derived: 108,
      bytes: files.reduce((total, file) => total + file.bytes, 0), files }))
    const archive = join(root, 'fixture.tgz')
    execFileSync('tar', ['-czf', archive, '-C', root, 'package'])
    const archiveBytes = readFileSync(archive)
    const inspected = await inspectPackageArchive(archive, join(root, 'inspection'), target)
    assert.equal(inspected.resources.originals, 77)
    assert.equal(inspected.resources.derived, 108)
    assert.deepEqual(readFileSync(archive), archiveBytes)
    await assert.rejects(inspectPackageArchive(archive, join(root, 'old-head'), 'f'.repeat(40)))
    write('package.json', JSON.stringify({ ...manifest, scripts: { prepare: 'node build.mjs' } }))
    const hooked = join(root, 'hooked.tgz')
    execFileSync('tar', ['-czf', hooked, '-C', root, 'package'])
    await assert.rejects(inspectPackageArchive(hooked, join(root, 'hooked'), target), /lifecycle hook/u)
    write('package.json', JSON.stringify(manifest))
    const originalBytes = readFileSync(join(packageRoot, 'resources/assets/image-0.png'))
    assert.ok(originalBytes.length > 0)
    write('resources/assets/image-0.png', 'tampered')
    execFileSync('tar', ['-czf', join(root, 'tampered.tgz'), '-C', root, 'package'])
    await assert.rejects(inspectPackageArchive(join(root, 'tampered.tgz'), join(root, 'rejected'), target), /integrity mismatch/u)
  } finally {
    const path = relative(resolve(tmpdir()), resolve(root))
    assert.ok(!isAbsolute(path) && path.startsWith('amphoreus-cloud-test-') && !path.includes('..'))
    rmSync(root, { recursive: true, force: true })
  }
})
