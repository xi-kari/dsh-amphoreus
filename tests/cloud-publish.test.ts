import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { RELEASE, assertAllowedChanges, assertNoTagDowngrade, assertPayloadEquivalent, assertWorkflowContext,
  inspectPackageArchive, registryPublishAction, restampedManifest, validateArchiveEntries } from '../scripts/cloud-publish.mjs'

const target = 'a'.repeat(40)

test('cloud publishing requires the exact main workflow and rejects runtime source changes', () => {
  const environment = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: RELEASE.repository,
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: target,
    GITHUB_WORKFLOW_REF: `${RELEASE.repository}/.github/workflows/cloud-publish.yml@refs/heads/main`,
    RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Linux', RELEASE_TAG: RELEASE.tag,
    MANIFEST_SHA256: 'b'.repeat(64), ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/oidc', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture' }
  assert.doesNotThrow(() => assertWorkflowContext(environment))
  for (const changed of [{ GITHUB_REF: 'refs/heads/feature' }, { GITHUB_REPOSITORY: 'other/repo' },
    { GITHUB_EVENT_NAME: 'pull_request' }, { RUNNER_ENVIRONMENT: 'self-hosted' }, { NODE_AUTH_TOKEN: 'traditional-token' }]) {
    assert.throws(() => assertWorkflowContext({ ...environment, ...changed }))
  }
  assert.doesNotThrow(() => assertAllowedChanges(['.github/workflows/cloud-publish.yml', 'scripts/release-chunks.mjs', 'tests/cloud-publish.test.ts']))
  for (const changed of ['src/index.ts', 'workbench/app.js', 'package.json', 'resources/manifest.json']) assert.throws(() => assertAllowedChanges([changed]))
})

test('cloud package checks reject traversal, links, payload changes, and metadata beyond gitHead', () => {
  assert.doesNotThrow(() => validateArchiveEntries(['package/package.json', 'package/lib/index.js'], ['-rw-r--r-- package/package.json', '-rw-r--r-- package/lib/index.js']))
  for (const path of ['../escape', 'package/../../escape', '/package/a', 'package/a\\b', 'package/sessions/log.jsonl', 'package/SKILL.md']) {
    assert.throws(() => validateArchiveEntries([path], ['-rw-r--r--']))
  }
  assert.throws(() => validateArchiveEntries(['package/a', 'package/a'], ['-rw-r--r--', '-rw-r--r--']))
  assert.throws(() => validateArchiveEntries(['package/a'], ['lrwxrwxrwx']))
  const original = { name: RELEASE.package, version: RELEASE.version, gitHead: RELEASE.originGitHead, files: ['lib/**'] }
  const restamped = restampedManifest(original, RELEASE.originGitHead, target)
  const before = [{ path: 'lib/index.js', bytes: 5, sha256: 'original' }, { path: 'package.json', bytes: 10, sha256: 'old' }]
  const after = [{ path: 'lib/index.js', bytes: 5, sha256: 'original' }, { path: 'package.json', bytes: 11, sha256: 'new' }]
  assertPayloadEquivalent(before, after, original, restamped, target)
  assert.equal(original.gitHead, RELEASE.originGitHead)
  assert.throws(() => assertPayloadEquivalent(before, [{ ...after[0], sha256: 'changed' }, after[1]], original, restamped, target))
  assert.throws(() => assertPayloadEquivalent(before, after, original, { ...restamped, version: '0.5.2' }, target))
})

test('idempotent publishing requires matching immutable metadata and cannot downgrade tags', () => {
  const state = { sourceCommit: target, integrity: 'sha512-fixture' }
  assert.equal(registryPublishAction({ versions: {} }, state), 'publish')
  const registry = { versions: { [RELEASE.version]: { gitHead: target, dist: { integrity: state.integrity } } } }
  assert.equal(registryPublishAction(registry, state), 'skip')
  assert.throws(() => registryPublishAction(registry, { ...state, sourceCommit: 'c'.repeat(40) }))
  assert.throws(() => registryPublishAction(registry, { ...state, integrity: 'sha512-different' }))
  assert.doesNotThrow(() => assertNoTagDowngrade({ alpha: '0.5.1', latest: '0.4.2' }))
  assert.throws(() => assertNoTagDowngrade({ latest: '0.5.2' }))
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
    write('package.json', JSON.stringify({ name: RELEASE.package, version: RELEASE.version, gitHead: RELEASE.originGitHead,
      dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } } }))
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
    const inspected = await inspectPackageArchive(archive, join(root, 'inspection'), RELEASE.originGitHead)
    assert.equal(inspected.resources.originals, 77)
    assert.equal(inspected.resources.derived, 108)
    const originalBytes = readFileSync(join(packageRoot, 'resources/assets/image-0.png'))
    assert.ok(originalBytes.length > 0)
    write('resources/assets/image-0.png', 'tampered')
    execFileSync('tar', ['-czf', join(root, 'tampered.tgz'), '-C', root, 'package'])
    await assert.rejects(inspectPackageArchive(join(root, 'tampered.tgz'), join(root, 'rejected'), RELEASE.originGitHead), /integrity mismatch/u)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
