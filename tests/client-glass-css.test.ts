import assert from 'node:assert/strict'
import test from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import configs from '../tsdown.config.ts'

test('the shipped glass stylesheet keeps standard backdrop filters for evergreen browsers', async () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  type Loader = { name: string; resolveId(source: string, importer: string): string; load(this: { addWatchFile(id: string): void }, id: string): Promise<string> }
  const plugins = configs.find(config => config.name === 'dsh-amphoreus/client')!.plugins as Loader[]
  const loader = plugins.find(plugin => plugin.name === 'amph-css-global-inline')!
  const module = await loader.load.call({ addWatchFile() {} }, loader.resolveId('./grammar.css', resolve(root, 'src/client/grammar-layer.ts')))
  const match = /^const css = (.+);$/m.exec(module)
  assert.ok(match)
  const css = JSON.parse(match[1]!) as string
  assert.match(css, /(?:[;{])backdrop-filter:var\(--amph-glass-filter\)/)
  assert.match(css, /(?:[;{])backdrop-filter:var\(--amph-dialog-filter\)/)
})
