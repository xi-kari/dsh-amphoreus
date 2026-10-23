import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { desktopLaunchConfiguration, prepareDesktopProfile } from '../scripts/desktop-launch.mjs'
import { inventory, safeRelative } from '../scripts/desktop-build.mjs'

test('desktop artifact paths reject traversal and absolute inputs', () => {
  for (const path of ['../x', '/x', 'C:/x', 'a\\b', 'a/../b', 'a//b']) assert.throws(() => safeRelative(tmpdir(), path))
  assert.equal(safeRelative(tmpdir(), 'packages/host.tgz'), join(tmpdir(), 'packages', 'host.tgz'))
})

test('desktop launch isolates home and profile and removes inherited launcher configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-desktop-test-'))
  try {
    writeFileSync(join(root, 'desktop-host.json'), JSON.stringify({ schemaVersion: 1, platform: process.platform, arch: process.arch, pluginVersion: '0.5.1' }))
    const configuration = desktopLaunchConfiguration(root, { data: join(root, 'private data') }, {
      LOCALAPPDATA: root, DSH_HOME: 'official-home', DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: 'inherited-policy',
      ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: 'inherited', PATH: 'system-path',
    })
    assert.equal(configuration.home, join(root, 'private data', 'home'))
    assert.equal(configuration.env.ELECTRON_RUN_AS_NODE, undefined)
    assert.equal(configuration.env.NODE_OPTIONS, undefined)
    assert.equal(configuration.env.DSH_DESKTOP_MANDATORY_UPDATE_CONFIG, undefined)
    assert.equal(configuration.env.PATH, 'system-path')
    assert.ok(configuration.args.includes(`--user-data-dir=${join(root, 'private data', 'electron')}`))
    prepareDesktopProfile(configuration)
    const manifest = JSON.parse(readFileSync(join(configuration.profile, 'package.json'), 'utf8'))
    assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-amphoreus'])
    writeFileSync(join(configuration.profile, 'package.json'), 'existing-user-profile')
    prepareDesktopProfile(configuration)
    assert.equal(readFileSync(join(configuration.profile, 'package.json'), 'utf8'), 'existing-user-profile')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('runtime inventory records bytes and detects changed package content', () => {
  const root = mkdtempSync(join(tmpdir(), 'amphoreus-runtime-test-'))
  try {
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'node_modules', 'example.js'), 'original')
    writeFileSync(join(root, 'desktop-runtime.json'), '{}')
    const first = inventory(root)
    assert.equal(first.length, 1)
    assert.equal(first[0].path, 'node_modules/example.js')
    assert.equal(first[0].bytes, 8)
    writeFileSync(join(root, 'node_modules', 'example.js'), 'changed')
    assert.notEqual(inventory(root)[0].sha256, first[0].sha256)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('desktop profile resolves its bundled plugin and relocates only an owned junction', () => {
  const parent = mkdtempSync(join(tmpdir(), 'amphoreus-link-test-'))
  try {
    const roots = [join(parent, 'first'), join(parent, 'relocated')]
    for (const root of roots) {
      const plugin = join(root, 'app', 'dsh', 'node_modules', 'dsh-amphoreus')
      mkdirSync(plugin, { recursive: true })
      writeFileSync(join(root, 'desktop-host.json'), JSON.stringify({ schemaVersion: 1, platform: process.platform, arch: process.arch, pluginVersion: '0.5.1' }))
      writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: 'dsh-amphoreus', main: 'index.mjs' }))
      writeFileSync(join(plugin, 'index.mjs'), 'export const name = "amphoreus"')
    }
    const data = join(parent, 'data')
    const first = desktopLaunchConfiguration(roots[0], { data })
    prepareDesktopProfile(first)
    assert.equal(createRequire(join(first.profile, 'package.json')).resolve('dsh-amphoreus'), join(roots[0], 'app', 'dsh', 'node_modules', 'dsh-amphoreus', 'index.mjs'))
    const second = desktopLaunchConfiguration(roots[1], { data })
    prepareDesktopProfile(second)
    const receipt = JSON.parse(readFileSync(join(second.profile, '.amphoreus-runtime-link.json'), 'utf8'))
    assert.equal(receipt.target, join(roots[1], 'app', 'dsh', 'node_modules', 'dsh-amphoreus'))
    const user = desktopLaunchConfiguration(roots[0], { data: join(parent, 'user-data') })
    const installed = join(user.profile, 'node_modules', 'dsh-amphoreus')
    mkdirSync(installed, { recursive: true })
    writeFileSync(join(installed, 'keep.txt'), 'user install')
    prepareDesktopProfile(user)
    assert.equal(readFileSync(join(installed, 'keep.txt'), 'utf8'), 'user install')
  } finally { rmSync(parent, { recursive: true, force: true }) }
})
