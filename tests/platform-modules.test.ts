/**
 * Drift guard: the PLATFORM_MODULES copy in tsdown.config.ts must equal the list
 * shipped by @deepseek-ai/dsh-client-web. Prefer its published declaration;
 * linked development copies may fall back to the source file.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLATFORM_MODULES } from '../tsdown.config.ts'

const here = dirname(fileURLToPath(import.meta.url))

function upstreamPlatformModules(): string[] {
  const base = resolve(here, '..', 'node_modules', '@deepseek-ai', 'dsh-client-web')
  const candidates = [
    resolve(base, 'lib', 'types', 'platform.d.ts'),
    resolve(base, 'src', 'platform.ts'),
  ]
  const file = candidates.find(existsSync)
  assert.ok(file, `dsh-client-web platform list not found under ${base}`)
  const source = readFileSync(file, 'utf8')
  const match = /PLATFORM_MODULES(?::\s*readonly\s*\[|\s*=\s*\[)([\s\S]*?)\]/u.exec(source)
  assert.ok(match, `PLATFORM_MODULES declaration not found in ${file}`)
  return [...match[1]!.matchAll(/["']([^"']+)["']/gu)].map(result => result[1]!)
}

test('PLATFORM_MODULES matches the linked dsh-client-web', () => {
  assert.deepEqual([...PLATFORM_MODULES], upstreamPlatformModules())
})
