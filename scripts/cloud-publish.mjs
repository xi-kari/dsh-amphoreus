import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectBundledResources } from '../src/host/bundled-resources.ts'
import { assembleArchive, validateManifest } from './release-chunks.mjs'

export const RELEASE = Object.freeze({
  repository: 'xi-kari/dsh-amphoreus', package: 'dsh-amphoreus', version: '0.5.1', tag: 'v0.5.1', draftId: 422573177,
  originGitHead: '22efbadbf39ff4555f2112f89a0d911e5e11e84b',
  originSha256: '98ed2859645b49093c4b93c24f044865985ff424a6480244d396af8a72643df7',
  resourceManifestSha256: '041e02bcc093059d40572f8512d1f6e0c9596e1de556219c472a012fb8e10147',
  filename: 'dsh-amphoreus-0.5.1-with-assets.tgz',
})
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY = 'https://registry.npmjs.org'
const HOOKS = ['preinstall', 'install', 'postinstall', 'prepare', 'preprepare', 'postprepare', 'prepack', 'postpack', 'prepublish', 'prepublishOnly', 'publish', 'postpublish']
const ALLOWED_CHANGES = new Set(['.github/workflows/cloud-publish.yml', 'scripts/cloud-publish.mjs', 'scripts/release-chunks.mjs', 'tests/cloud-publish.test.ts', 'tests/release-chunks.test.ts'])
const json = file => JSON.parse(readFileSync(file, 'utf8'))
const hash = (file, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(readFileSync(file)).digest(encoding)
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n')

function redact(value) {
  for (const [name, secret] of Object.entries(process.env)) {
    if (/TOKEN|SECRET|PASSWORD/iu.test(name) && secret && secret.length >= 8) value = value.replaceAll(secret, '[redacted]')
  }
  return value
}

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(redact(`${executable} failed: ${result.stderr || result.stdout}`))
  return result.stdout
}

export function assertWorkflowContext(environment) {
  assert.equal(environment.GITHUB_ACTIONS, 'true', 'Publishing is restricted to GitHub Actions')
  assert.equal(environment.GITHUB_REPOSITORY, RELEASE.repository)
  assert.equal(environment.GITHUB_EVENT_NAME, 'workflow_dispatch')
  assert.equal(environment.GITHUB_REF, 'refs/heads/main', 'Dispatch this workflow from main')
  assert.equal(environment.GITHUB_WORKFLOW_REF, `${RELEASE.repository}/.github/workflows/cloud-publish.yml@refs/heads/main`)
  assert.equal(environment.RUNNER_ENVIRONMENT, 'github-hosted')
  assert.equal(environment.RUNNER_OS, 'Linux')
  assert.match(environment.GITHUB_SHA ?? '', /^[0-9a-f]{40}$/u)
  assert.equal(environment.RELEASE_TAG, RELEASE.tag)
  assert.match(environment.MANIFEST_SHA256 ?? '', /^[0-9a-f]{64}$/u)
  assert.ok(environment.ACTIONS_ID_TOKEN_REQUEST_URL && environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN, 'OIDC permission is unavailable')
  assert.ok(!environment.NPM_TOKEN && !environment.NODE_AUTH_TOKEN, 'Traditional npm tokens must not be supplied')
}

export function assertAllowedChanges(paths) {
  assert.ok(paths.length > 0, 'The cloud publisher must be a new source commit')
  for (const path of paths) assert.ok(ALLOWED_CHANGES.has(path), `Source change is outside the publishing bridge: ${path}`)
}

function assertSource(environment) {
  assertWorkflowContext(environment)
  assert.equal(process.versions.node.split('.')[0], '24')
  assert.equal(command('npm', ['--version']).trim(), '11.21.0')
  assert.equal(command('git', ['rev-parse', 'HEAD']).trim(), environment.GITHUB_SHA)
  assert.equal(command('git', ['status', '--porcelain']).trim(), '', 'Checkout must be clean')
  command('git', ['merge-base', '--is-ancestor', RELEASE.originGitHead, environment.GITHUB_SHA])
  assertAllowedChanges(command('git', ['diff', '--name-only', '-z', RELEASE.originGitHead, environment.GITHUB_SHA]).split('\0').filter(Boolean))
  const tag = spawnSync('git', ['rev-parse', '--verify', `refs/tags/${RELEASE.tag}^{commit}`], { cwd: ROOT, encoding: 'utf8' })
  if (tag.status === 0) assert.equal(tag.stdout.trim(), environment.GITHUB_SHA, 'Existing release tag points to another commit')
}

export function validateArchiveEntries(entries, descriptions) {
  const seen = new Set()
  for (const path of entries) {
    const normalized = path.endsWith('/') ? path.slice(0, -1) : path
    assert.ok(normalized.startsWith('package/') || normalized === 'package', `Unexpected archive root: ${path}`)
    assert.ok(!/[\\:\x00-\x1f\x7f]/u.test(path) && !normalized.split('/').some(part => part === '.' || part === '..' || part === ''), `Unsafe archive path: ${path}`)
    assert.ok(!seen.has(normalized), `Duplicate archive path: ${path}`)
    seen.add(normalized)
    assert.ok(!/(?:^|\/)(?:node_modules|sessions|\.runtime|\.dsh-home|SKILL\.md|persona\.md|common\.md|relations\.md|settings\.yaml)(?:\/|$)/u.test(path), `Unexpected private payload: ${path}`)
  }
  assert.ok(descriptions.every(line => line.startsWith('-') || line.startsWith('d')), 'Archive contains a link or special entry')
}

export function treeInventory(root) {
  const entries = []
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else {
        assert.ok(entry.isFile() && !lstatSync(file).isSymbolicLink(), 'Package contains a nonregular entry')
        entries.push({ path: relative(root, file).split(sep).join('/'), bytes: lstatSync(file).size, sha256: hash(file) })
      }
    }
  }
  visit(root)
  return entries.sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

export function restampedManifest(manifest, from, to) {
  assert.equal(manifest.name, RELEASE.package)
  assert.equal(manifest.version, RELEASE.version)
  assert.equal(manifest.gitHead, from)
  assert.match(to, /^[0-9a-f]{40}$/u)
  const result = structuredClone(manifest)
  result.gitHead = to
  return result
}

export function assertPayloadEquivalent(before, after, originalManifest, finalManifest, target) {
  assert.deepEqual(finalManifest, restampedManifest(originalManifest, originalManifest.gitHead, target), 'Package metadata changed beyond gitHead')
  assert.deepEqual(after.filter(entry => entry.path !== 'package.json'), before.filter(entry => entry.path !== 'package.json'), 'Runtime or artwork bytes changed')
}

export async function inspectPackageArchive(archive, destination, expectedHead) {
  assert.ok(!existsSync(destination), 'Archive inspection requires a fresh directory')
  const entries = command('tar', ['-tzf', archive]).trim().split(/\r?\n/u)
  const descriptions = command('tar', ['-tvzf', archive]).trim().split(/\r?\n/u)
  validateArchiveEntries(entries, descriptions)
  mkdirSync(destination, { recursive: true })
  command('tar', ['-xzf', archive, '-C', destination])
  const root = join(destination, 'package')
  const manifest = json(join(root, 'package.json'))
  assert.equal(manifest.name, RELEASE.package)
  assert.equal(manifest.version, RELEASE.version)
  assert.equal(manifest.gitHead, expectedHead)
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh?.client?.platform, 'web')
  assert.ok(HOOKS.every(hook => manifest.scripts?.[hook] === undefined), 'Package contains a lifecycle hook')
  for (const file of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) assert.ok(lstatSync(join(root, file)).isFile())
  const resources = await inspectBundledResources(join(root, 'resources'))
  assert.equal(resources.originals, 77)
  assert.equal(resources.derived, 108)
  const inventory = treeInventory(root)
  assert.equal(inventory.filter(entry => /^resources\/(assets|assets-cache)\//u.test(entry.path)).length, 185)
  return { root, manifest, resources, inventory, resourceManifestSha256: hash(join(root, 'resources', 'manifest.json')) }
}

function draftRelease() {
  const release = JSON.parse(command('gh', ['api', `repos/${RELEASE.repository}/releases/${RELEASE.draftId}`]))
  assert.equal(release.id, RELEASE.draftId)
  assert.equal(release.tag_name, RELEASE.tag)
  assert.equal(release.draft, true, 'The target release must remain a draft')
  return release
}

function downloadAsset(name, directory, release, expectedBytes) {
  const matches = release.assets.filter(asset => asset.name === name)
  assert.equal(matches.length, 1, `Missing or ambiguous draft asset: ${name}`)
  assert.equal(matches[0].state, 'uploaded', `Draft asset is not complete: ${name}`)
  if (expectedBytes !== undefined) assert.equal(matches[0].size, expectedBytes, `Draft asset size differs: ${name}`)
  command('gh', ['release', 'download', RELEASE.tag, '--repo', RELEASE.repository, '--pattern', name, '--dir', directory])
}

function loadState(directory, environment) {
  const state = json(join(directory, 'state.json'))
  assert.equal(state.sourceCommit, environment.GITHUB_SHA)
  assert.equal(state.originGitHead, RELEASE.originGitHead)
  assert.equal(state.filename, RELEASE.filename)
  const archive = join(directory, state.filename)
  assert.equal(hash(archive), state.sha256)
  assert.equal(`sha512-${hash(archive, 'sha512', 'base64')}`, state.integrity)
  return { state, archive }
}

async function prepare(directory, environment) {
  assert.ok(!existsSync(directory), 'Use a fresh cloud publishing directory')
  mkdirSync(directory, { recursive: true })
  const input = join(directory, 'input')
  mkdirSync(input)
  const release = draftRelease()
  const manifestName = `upload-${RELEASE.tag}.manifest.json`
  downloadAsset(manifestName, input, release)
  const manifestFile = join(input, manifestName)
  assert.equal(hash(manifestFile), environment.MANIFEST_SHA256, 'Uploaded manifest digest differs from the approved input')
  const manifest = validateManifest(json(manifestFile))
  assert.equal(manifest.package, RELEASE.package)
  assert.equal(manifest.version, RELEASE.version)
  assert.equal(manifest.originGitHead, RELEASE.originGitHead)
  assert.equal(manifest.archive, RELEASE.filename)
  assert.equal(manifest.sha256, RELEASE.originSha256)
  for (const part of manifest.parts) downloadAsset(part.file, input, release, part.bytes)
  const original = join(input, RELEASE.filename)
  await assembleArchive({ manifest: manifestFile, parts: input, out: original })
  assert.equal(hash(original), RELEASE.originSha256)
  const before = await inspectPackageArchive(original, join(directory, 'original'), RELEASE.originGitHead)
  assert.equal(before.resourceManifestSha256, RELEASE.resourceManifestSha256)
  writeJson(join(before.root, 'package.json'), restampedManifest(before.manifest, RELEASE.originGitHead, environment.GITHUB_SHA))
  const packed = JSON.parse(command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], { cwd: before.root }))
  assert.equal(packed.length, 1)
  const generated = join(directory, `${RELEASE.package}-${RELEASE.version}.tgz`)
  const archive = join(directory, RELEASE.filename)
  const { renameSync } = await import('node:fs')
  renameSync(generated, archive)
  const after = await inspectPackageArchive(archive, join(directory, 'verified'), environment.GITHUB_SHA)
  assert.equal(after.resourceManifestSha256, RELEASE.resourceManifestSha256)
  assertPayloadEquivalent(before.inventory, after.inventory, before.manifest, after.manifest, environment.GITHUB_SHA)
  const state = { schemaVersion: 1, sourceCommit: environment.GITHUB_SHA, originGitHead: RELEASE.originGitHead,
    originSha256: RELEASE.originSha256, manifestSha256: environment.MANIFEST_SHA256, filename: RELEASE.filename,
    bytes: lstatSync(archive).size, sha256: hash(archive), integrity: `sha512-${hash(archive, 'sha512', 'base64')}`,
    resourceManifestSha256: after.resourceManifestSha256, originals: after.resources.originals, derived: after.resources.derived,
    unchangedPayloadFiles: after.inventory.length - 1 }
  writeJson(join(directory, 'state.json'), state)
  writeFileSync(join(directory, 'npmrc'), `registry=${REGISTRY}/\n`)
  console.log(JSON.stringify({ prepared: true, ...state }))
}

async function registryDocument() {
  const response = await fetch(`${REGISTRY}/${RELEASE.package}`, { signal: AbortSignal.timeout(30000), cache: 'no-store' })
  assert.equal(response.status, 200, 'Cannot read package metadata from npm')
  return response.json()
}

export function registryPublishAction(registry, state) {
  const existing = registry.versions?.[RELEASE.version]
  if (!existing) return 'publish'
  assert.equal(existing.gitHead, state.sourceCommit, 'Existing npm version belongs to another source commit')
  assert.ok(existing.dist?.integrity?.split(/\s+/u).includes(state.integrity), 'Existing npm version has different artifact bytes')
  return 'skip'
}

export function assertNoTagDowngrade(tags) {
  const target = RELEASE.version.split('.').map(Number)
  for (const name of ['alpha', 'latest']) {
    const value = tags?.[name]
    if (value === undefined) continue
    const parsed = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(value)
    assert.ok(parsed, `Unexpected ${name} version`)
    const parts = parsed.slice(1).map(Number)
    for (let index = 0; index < 3; index += 1) {
      if (parts[index] < target[index]) break
      assert.ok(parts[index] <= target[index], `Refusing to move ${name} backwards from ${value}`)
    }
  }
}

function npmCommand(args, directory) {
  return command('npm', [...args, '--registry', REGISTRY, '--userconfig', join(directory, 'npmrc')])
}

async function waitForPublished(state, tags = false) {
  let failure
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const registry = await registryDocument()
      assert.equal(registryPublishAction(registry, state), 'skip', 'Published version is not visible yet')
      if (tags) for (const tag of ['alpha', 'latest']) assert.equal(registry['dist-tags']?.[tag], RELEASE.version)
      return registry
    } catch (error) { failure = error }
    if (attempt < 5) await new Promise(resolvePromise => setTimeout(resolvePromise, 3000))
  }
  throw failure
}

async function publish(directory, environment) {
  draftRelease()
  const { state, archive } = loadState(directory, environment)
  const registry = await registryDocument()
  assertNoTagDowngrade(registry['dist-tags'])
  const action = registryPublishAction(registry, state)
  if (action === 'publish') npmCommand(['publish', archive, '--tag', 'alpha', '--access', 'public', '--provenance', '--ignore-scripts'], directory)
  await waitForPublished(state)
  npmCommand(['dist-tag', 'add', `${RELEASE.package}@${RELEASE.version}`, 'alpha'], directory)
  npmCommand(['dist-tag', 'add', `${RELEASE.package}@${RELEASE.version}`, 'latest'], directory)
  await waitForPublished(state, true)
  console.log(JSON.stringify({ published: action, package: RELEASE.package, version: RELEASE.version, sourceCommit: state.sourceCommit }))
}

async function verify(directory, environment) {
  const { state, archive } = loadState(directory, environment)
  const registry = await waitForPublished(state, true)
  const published = registry.versions[RELEASE.version]
  const url = new URL(published.dist.tarball)
  assert.equal(url.protocol, 'https:')
  assert.equal(url.hostname, 'registry.npmjs.org')
  assert.equal(url.username + url.password, '')
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(180000) })
  assert.equal(response.status, 200)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(bytes.length, state.bytes)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), state.sha256, 'Registry returned different package bytes')
  const registryArchive = join(directory, 'registry.tgz')
  writeFileSync(registryArchive, bytes)
  const inspected = await inspectPackageArchive(registryArchive, join(directory, 'registry-package'), environment.GITHUB_SHA)
  assert.equal(inspected.resourceManifestSha256, RELEASE.resourceManifestSha256)
  const provenance = { schemaVersion: 1, package: RELEASE.package, version: RELEASE.version, sourceCommit: state.sourceCommit,
    originGitHead: state.originGitHead, originSha256: state.originSha256, sourceChanges: [...ALLOWED_CHANGES],
    payloadChanges: ['package.json.gitHead'], unchangedPayloadFiles: state.unchangedPayloadFiles,
    resources: { originals: 77, derived: 108, manifestSha256: state.resourceManifestSha256 },
    tarball: { file: state.filename, bytes: state.bytes, sha256: state.sha256, integrity: state.integrity },
    registry: { gitHead: published.gitHead, alpha: registry['dist-tags'].alpha, latest: registry['dist-tags'].latest },
    workflow: { repository: RELEASE.repository, runId: environment.GITHUB_RUN_ID, runAttempt: environment.GITHUB_RUN_ATTEMPT } }
  const checksum = archive + '.sha256'
  const provenanceFile = join(directory, 'provenance.json')
  const releaseProvenanceFile = join(directory, `${RELEASE.package}-${RELEASE.version}-provenance.json`)
  writeFileSync(checksum, `${state.sha256}  ${state.filename}\n`)
  writeJson(provenanceFile, provenance)
  writeFileSync(releaseProvenanceFile, readFileSync(provenanceFile))
  draftRelease()
  command('gh', ['release', 'upload', RELEASE.tag, archive, checksum, releaseProvenanceFile, '--repo', RELEASE.repository, '--clobber'])
  draftRelease()
  console.log(JSON.stringify({ verified: true, sourceCommit: state.sourceCommit, sha256: state.sha256, draftRelease: RELEASE.draftId }))
}

async function main() {
  const phase = process.argv[2]
  assert.ok(['prepare', 'publish', 'verify'].includes(phase), 'Usage: node scripts/cloud-publish.mjs <prepare|publish|verify>')
  assertSource(process.env)
  assert.ok(process.env.CLOUD_PUBLISH_DIR && process.env.GH_TOKEN, 'Workflow runtime directory or GitHub token is missing')
  const directory = resolve(process.env.CLOUD_PUBLISH_DIR)
  assert.ok(!directory.startsWith(ROOT + sep), 'Publishing output must be outside the checkout')
  await ({ prepare, publish, verify })[phase](directory, process.env)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(redact(error instanceof Error ? error.message : String(error)))
  process.exitCode = 1
})
