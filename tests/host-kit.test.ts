import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { artifactPath, createProfile, hostEnvironment, installerEnvironment, linkPlugin, verifyFiles } from '../scripts/host-kit-runtime.mjs'
import { HOST_VERSION, hostManifest, PATCHED_PACKAGES, verifyHostLock, workspaceConfig } from '../scripts/build-host-kit.mjs'

test('host kit integrity rejects tampered archives and unsafe paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-host-kit-'))
  try {
    const bytes = Buffer.from('a built archive')
    writeFileSync(join(root, 'host.tgz'), bytes)
    const records = [{ path: 'host.tgz', bytes: bytes.length, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }]
    assert.doesNotThrow(() => verifyFiles(root, records))
    writeFileSync(join(root, 'host.tgz'), 'changed archive')
    assert.throws(() => verifyFiles(root, records), /integrity check failed/u)
    for (const path of ['../secrets', 'packages/../../secrets', 'C:/secrets', '/secrets', 'packages\\host.tgz']) {
      assert.throws(() => artifactPath(root, path), /Invalid artifact path/u)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('host kit defaults to an isolated home and never rewrites an existing profile', () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-host-home-'))
  try {
    const env = hostEnvironment(root, {})
    assert.equal(env.DSH_HOME, join(root, '.dsh-home'))
    const profile = createProfile(env.DSH_HOME)
    const file = join(profile, 'package.json')
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-amphoreus'])
    const existing = `${JSON.stringify({ ...manifest, userSetting: 'preserved' })}\n`
    writeFileSync(file, existing)
    createProfile(env.DSH_HOME)
    assert.equal(readFileSync(file, 'utf8'), existing)
    writeFileSync(file, '{"name":"user-owned","private":true}\n')
    assert.throws(() => createProfile(env.DSH_HOME), /Existing profile/u)
    assert.equal(hostEnvironment(root, { DSH_HOME: join(root, 'selected') }).DSH_HOME, join(root, 'selected'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('host installation pins every patched package in the root override map', () => {
  const packages = PATCHED_PACKAGES.map(([name], index) => ({ name, path: `packages/patch-${index}.tgz` }))
  const manifest = hostManifest('0.5.1', packages, 'packages/dsh-amphoreus-0.5.1.tgz')
  assert.equal(manifest.dependencies['@deepseek-ai/dsh'], HOST_VERSION)
  assert.equal(manifest.dependencies['dsh-amphoreus'], 'file:./packages/dsh-amphoreus-0.5.1.tgz')
  const workspace = workspaceConfig(packages)
  for (const item of packages) {
    assert.equal(manifest.dependencies[item.name], `file:./${item.path}`)
    assert.ok(workspace.includes(`${JSON.stringify(item.name)}: ${JSON.stringify(`file:./${item.path}`)}`))
  }
  assert.ok(workspace.includes('autoInstallPeers: true'))
  assert.ok(workspace.includes('nodeLinker: hoisted'))
})

test('Windows install scripts receive one bounded PATH with the current Node executable', () => {
  const environment = installerEnvironment({ Path: 'x'.repeat(20000), PATH: 'shadow', SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\fixture' }, 'win32')
  assert.equal(environment.Path, undefined)
  assert.ok(environment.PATH.length < 1000)
  assert.ok(environment.PATH.startsWith(dirname(process.execPath)))
  assert.equal(environment.USERPROFILE, 'C:\\Users\\fixture')
})

test('relocated kits update only their own profile link and preserve other installations', () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-host-link-'))
  try {
    const first = join(root, 'first')
    const second = join(root, 'second')
    mkdirSync(first); mkdirSync(second)
    const profile = createProfile(join(root, 'home'))
    linkPlugin(profile, first)
    assert.equal(realpathSync(join(profile, 'node_modules', 'dsh-amphoreus')), realpathSync(first))
    linkPlugin(profile, second)
    assert.equal(realpathSync(join(profile, 'node_modules', 'dsh-amphoreus')), realpathSync(second))
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    delete manifest.amphoreusHostKit
    writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest))
    assert.throws(() => linkPlugin(profile, first), /different plugin installation/u)
    assert.equal(realpathSync(join(profile, 'node_modules', 'dsh-amphoreus')), realpathSync(second))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('host lock validation rejects mixed DSH releases', () => {
  assert.doesNotThrow(() => verifyHostLock("packages:\n  '@deepseek-ai/dsh@0.2.1-rc.2':\n  '@deepseek-ai/dsh-workspace@file:packages/workspace.tgz':\n"))
  assert.throws(() => verifyHostLock("packages:\n  '@deepseek-ai/dsh@0.2.1-rc.2':\n  '@deepseek-ai/dsh-agent@0.2.2':\n"), /mixes DSH versions/u)
  assert.throws(() => verifyHostLock('packages: {}'), /no DSH packages/u)
})
