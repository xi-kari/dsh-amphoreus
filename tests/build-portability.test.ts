import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { transform } from 'lightningcss'
import configs from '../tsdown.config.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
type CssPlugin = { name: string; resolveId(source: string, importer: string): string; load(this: { addWatchFile(id: string): void }, id: string): Promise<string> }
const plugins = configs.find(config => config.name === 'dsh-amphoreus/client')!.plugins as CssPlugin[]

for (const [name, filename, query, prefix] of [
  ['amph-css-modules-inline', 'brand.module.css', '', 'amph-css'],
  ['amph-css-text-inline', 'grammar.css', '?inline', 'amph-inline-css'],
  ['amph-css-global-inline', 'grammar.css', '', 'amph-global-css'],
]) {
  test(`${name} uses a portable module identity and reads the original file`, async () => {
    const plugin = plugins.find(plugin => plugin.name === name)!
    const relative = `src/client/${filename}`
    const absolute = resolve(root, relative)
    const id = plugin.resolveId(`./${filename}${query}`, resolve(root, 'src/client/index.ts'))
    assert.equal(id, `\0${prefix}:${relative}.mjs`)
    const watched: string[] = []
    const code = await plugin.load.call({ addWatchFile(id) { watched.push(id) } }, id)
    assert.deepEqual(watched, [absolute])
    assert.ok(!code.includes(root))
    if (filename.endsWith('.module.css')) {
      const expected = transform({ filename: relative, code: await readFile(absolute), cssModules: { pattern: '[hash]_[local]' } })
      for (const exported of Object.values(expected.exports ?? {})) assert.ok(code.includes(exported.name))
    } else assert.ok(code.includes('export'))
  })
}
