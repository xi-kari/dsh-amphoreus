import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import configs, { PLATFORM_MODULES } from '../tsdown.config.ts'

const upstream = dirname(fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-client-web/package.json')))

function moduleList(source: string, name: string, file: string): string[] {
  const match = new RegExp(`\\b${name}(?::\\s*readonly\\s*\\[|\\s*=\\s*\\[)([\\s\\S]*?)\\]`, 'u').exec(source)
  assert.ok(match, `${name} declaration not found in ${file}`)
  return [...match[1]!.matchAll(/["']([^"']+)["']/gu)].map(result => result[1]!)
}

test('PLATFORM_MODULES matches every installed dsh-client-web contract', () => {
  const candidates = [
    resolve(upstream, 'lib', 'types', 'platform.d.ts'),
    resolve(upstream, 'src', 'platform.ts'),
    resolve(upstream, 'lib', 'index.js'),
  ].filter(existsSync)
  assert.ok(candidates.includes(resolve(upstream, 'lib', 'index.js')), 'the installed shell runtime is missing')
  for (const file of candidates) {
    const source = readFileSync(file, 'utf8')
    assert.deepEqual([...PLATFORM_MODULES], moduleList(source, 'PLATFORM_MODULES', file), file)
    assert.deepEqual(moduleList(source, 'PRELOADED_CLIENT_EXTERNALS', file), [], file)
  }
})

test('every platform external is seeded from its exact runtime module', () => {
  const file = resolve(upstream, 'lib', 'index.js')
  const source = readFileSync(file, 'utf8')
  const imports = new Map([...source.matchAll(/import\s+\*\s+as\s+([\w$]+)\s+from\s+["']([^"']+)["']/gu)]
    .map(match => [match[1]!, match[2]!]))
  const table = /function getStaticModules\(\)\s*\{\s*return\s*\{([\s\S]*?)\};?\s*\}/u.exec(source)?.[1]
  assert.ok(table, `static module table not found in ${file}`)
  const entry = /\s*(["'])([^"']+)\1\s*:\s*([\w$]+)\s*,?/gu
  const rows = [...table.matchAll(entry)]
  assert.equal(table.replace(entry, '').trim(), '', 'the static module table contains an unrecognized supplier')
  assert.deepEqual(rows.map(row => row[2]), [...PLATFORM_MODULES])
  for (const row of rows) {
    assert.equal(imports.get(row[3]!), row[2], `${row[2]} is not supplied by the matching static import`)
  }
})

test('client bundling shares platform instances without externalizing unseeded subpaths', () => {
  const client = configs.find(config => config.name === 'dsh-amphoreus/client')
  assert.ok(client)
  const external = client.deps?.neverBundle
  const inline = client.deps?.alwaysBundle
  assert.ok(typeof external === 'function')
  assert.ok(typeof inline === 'function')
  for (const specifier of PLATFORM_MODULES) {
    assert.equal(external(specifier), true, specifier)
    assert.equal(inline(specifier), false, specifier)
  }
  for (const specifier of ['zod/v4', '@tanstack/react-virtual/internal', 'react/jsx-runtime/extra', 'clsx']) {
    assert.equal(external(specifier), false, specifier)
    assert.equal(inline(specifier), true, specifier)
  }
})
