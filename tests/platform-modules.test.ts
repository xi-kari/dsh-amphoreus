/**
 * Drift guard: the PLATFORM_MODULES copy in tsdown.config.ts must equal the list
 * shipped by the linked @deepseek-ai/dsh-client-web (read from its source file,
 * because its built lib imports a stylesheet and cannot load in Node).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLATFORM_MODULES } from '../tsdown.config.ts'

const here = dirname(fileURLToPath(import.meta.url))

function upstreamPlatformModules(): string[] {
  const source = readFileSync(
    resolve(here, '..', 'node_modules', '@deepseek-ai', 'dsh-client-web', 'src', 'platform.ts'),
    'utf8',
  )
  const match = /export const PLATFORM_MODULES = \[([\s\S]*?)\] as const/.exec(source)
  assert.ok(match, 'PLATFORM_MODULES declaration not found in dsh-client-web/src/platform.ts')
  return [...match[1]!.matchAll(/'([^']+)'/g)].map(m => m[1]!)
}

test('PLATFORM_MODULES matches the linked dsh-client-web', () => {
  assert.deepEqual([...PLATFORM_MODULES], upstreamPlatformModules())
})
