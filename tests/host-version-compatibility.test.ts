import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import semver from 'semver'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const requirements = {
  'engines.dsh': manifest.engines.dsh,
  ...Object.fromEntries(Object.entries(manifest.peerDependencies)
    .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))),
} as Record<string, string>

for (const runtime of ['0.2.1-rc.2', '0.2.1-rc.3']) {
  test(`package requirements accept DSH ${runtime} without a version exemption`, () => {
    for (const [name, range] of Object.entries(requirements)) {
      assert.equal(semver.satisfies(runtime, range, { includePrerelease: true }), true, `${name}: ${range}`)
    }
  })
}

for (const runtime of ['0.2.1-rc.1', '0.2.1-rc.4', '0.2.1', '0.2.2-alpha.1']) {
  test(`package requirements do not claim support for DSH ${runtime}`, () => {
    for (const [name, range] of Object.entries(requirements)) {
      assert.equal(semver.satisfies(runtime, range, { includePrerelease: true }), false, `${name}: ${range}`)
    }
  })
}
