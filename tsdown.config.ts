/**
 * Out-of-tree build for dsh-amphoreus, mirroring the alpha.4 client-bundle
 * contract of `packages/client/tsdown.client.ts` (dsh-v0.1.2-alpha.4):
 *  - host half: ESM `lib/index.js`, production dependencies external, rest inlined;
 *  - browser half: CJS closure factory `lib/client.js` wrapped in
 *    `window.__ModuleLoader__.load({ id, factory })`, platform modules external,
 *    every other import inlined, CSS Modules / `?inline` / global CSS compiled
 *    by lightningcss at build time and injected at factory execution.
 * PLATFORM_MODULES is a copy of the list in `@deepseek-ai/dsh-client-web`
 * (its built lib imports a stylesheet, so a Node config cannot import it);
 * `tests/platform-modules.test.ts` guards drift against the linked package.
 */
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserslistToTargets, transform } from 'lightningcss'

/** Modern evergreen browsers: keeps unprefixed backdrop-filter / color-mix / :has() intact. */
const CSS_TARGETS = browserslistToTargets(['chrome >= 120', 'edge >= 120', 'firefox >= 121'])
import type { UserConfig } from 'tsdown'

const ID = 'dsh-amphoreus'
const HERE = dirname(fileURLToPath(import.meta.url))

export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

const INLINE_SAFE = /^(?:@deepseek-ai\/dsh-(?:file-reference|session|llm|tools|brand|deque|typert-protocol|util-crypto|util-values|util-workspace-path)(?:\/|$)|@deepseek-ai\/dsh-token-meter\/client$|@deepseek-ai\/dsh-agent-presets\/display$)/
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/

const manifest = JSON.parse(readFileSync(resolvePath(HERE, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}
const productionNames = [...new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
])]
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const productionPatterns = productionNames.map(name => new RegExp(`^${escapeRe(name)}(/|$)`))
const isProductionDependency = (spec: string): boolean => productionPatterns.some(p => p.test(spec))
const isPlatform = (spec: string): boolean => (PLATFORM_MODULES as readonly string[]).includes(spec)
const nodeEnv = process.env.NODE_ENV ?? 'production'

const CSS_VIRTUAL_PREFIX = '\0amph-css:'
const GLOBAL_CSS_VIRTUAL_PREFIX = '\0amph-global-css:'
const INLINE_CSS_VIRTUAL_PREFIX = '\0amph-inline-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const INLINE_CSS_QUERY = '?inline'

interface WatchingLoader { addWatchFile(id: string): void }

function styleInjectionModule(fileId: string, css: string, classMap?: Readonly<Record<string, string>>): string {
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${ID}/${basename(fileId)}`)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
    "  const tag = document.createElement('style');",
    `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

function assetPath(source: string, importer: string | undefined): string {
  return importer === undefined ? source : resolvePath(dirname(importer), source)
}

const hostConfig: UserConfig = {
  name: ID,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  sourcemap: true,
  deps: {
    neverBundle: isProductionDependency,
    alwaysBundle: (spec: string) => !isBuiltin(spec) && !isProductionDependency(spec),
  },
  plugins: [{
    name: 'amph-host-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (isProductionDependency(source)) return null
      throw new Error(`host bundle: "${source}" is a value import but not a declared dependency/peer of ${ID}; add it to package.json or import it type-only`)
    },
  }],
}

const clientConfig: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: isPlatform,
    alwaysBundle: (spec: string) => !isPlatform(spec),
  },
  inputOptions: {
    resolve: {
      conditionNames: [nodeEnv === 'development' ? 'development' : 'production', 'browser', 'import', 'module', 'default'],
    },
  },
  define: {
    'process.env': '{}',
    'process.env.NODE_ENV': JSON.stringify(nodeEnv),
    'import.meta.env.MODE': JSON.stringify(nodeEnv),
    'import.meta.env': JSON.stringify({ MODE: nodeEnv }),
  },
  plugins: [{
    name: 'amph-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (isPlatform(source) || VENDORED_LIBRARY.test(source) || INLINE_SAFE.test(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not a platform module or an inline-safe wire layer; `
        + 'cross-plugin value imports are forbidden (type-only imports never reach this gate)',
      )
    },
  }, {
    name: 'amph-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      return CSS_VIRTUAL_PREFIX + assetPath(source, importer) + CSS_VIRTUAL_SUFFIX
    },
    async load(this: WatchingLoader, id: string) {
      if (!id.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = id.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const { code, exports } = transform({ filename: fileId, code: await readFile(fileId), cssModules: { pattern: '[hash]_[local]' }, minify: true, targets: CSS_TARGETS })
      const classMap: Record<string, string> = {}
      for (const [local, exp] of Object.entries(exports ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) classMap[local] = exp.name
      return styleInjectionModule(fileId, code.toString(), classMap)
    },
  }, {
    name: 'amph-css-text-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith(`.css${INLINE_CSS_QUERY}`)) return null
      return INLINE_CSS_VIRTUAL_PREFIX + assetPath(source.slice(0, -INLINE_CSS_QUERY.length), importer) + CSS_VIRTUAL_SUFFIX
    },
    async load(this: WatchingLoader, id: string) {
      if (!id.startsWith(INLINE_CSS_VIRTUAL_PREFIX)) return null
      const fileId = id.slice(INLINE_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const { code } = transform({ filename: fileId, code: await readFile(fileId), minify: true, targets: CSS_TARGETS })
      return `export default ${JSON.stringify(code.toString())};`
    },
  }, {
    name: 'amph-css-global-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.css') || source.endsWith('.module.css')) return null
      return GLOBAL_CSS_VIRTUAL_PREFIX + assetPath(source, importer) + CSS_VIRTUAL_SUFFIX
    },
    async load(this: WatchingLoader, id: string) {
      if (!id.startsWith(GLOBAL_CSS_VIRTUAL_PREFIX)) return null
      const fileId = id.slice(GLOBAL_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const { code } = transform({ filename: fileId, code: await readFile(fileId), minify: true, targets: CSS_TARGETS })
      return styleInjectionModule(fileId, code.toString())
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

const deriveConfig: UserConfig = {
  ...hostConfig,
  name: `${ID}-derive`,
  entry: { derive: 'src/host/derive.ts' },
}

export default [hostConfig, clientConfig, deriveConfig]
