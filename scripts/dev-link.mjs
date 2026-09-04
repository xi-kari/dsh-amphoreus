/**
 * Dev-time module linking for an out-of-tree DSH plugin on Windows.
 *
 * `dsh-amphoreus` is installed into the `web` profile with `link:` and imports
 * the installation's own `@deepseek-ai/*` packages plus a few third-party
 * libraries. For typechecking and building from this directory, this script
 * junctions each declared dependency into `./node_modules` from:
 *   1. the profile module fallback `$WORKSPACE/.dsh-home/profiles/node_modules`
 *      (mirrors the running dsh installation; one entry per package)
 *   2. the dev checkout's `apps/web/node_modules` (static assembly libraries: store, slots, primitives, web)
 *      then its root `node_modules` (toolchain: tsdown, typescript, lightningcss)
 *   3. the dev checkout's `node_modules/.pnpm/<name>@<version>/node_modules/<name>` store
 * Junctions never require admin rights; realpath resolution keeps every
 * package's own dependencies resolvable from its true location. Only links this
 * script created (reparse points under ./node_modules) are ever removed.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmdirSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = process.env.DSH_WORKSPACE_ROOT ?? resolve(pluginDir, '..', '..')
const fallback = join(workspace, '.dsh-home', 'profiles', 'node_modules')
const devRoot = join(workspace, 'deepseek-harness-dev', 'node_modules')
const webAppRoot = join(workspace, 'deepseek-harness-dev', 'apps', 'web', 'node_modules')
const pnpmStore = join(devRoot, '.pnpm')
const manifest = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))
const names = [...new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
])]

function realDir(path) {
  try { return realpathSync.native(path) } catch { return undefined }
}

function fromPnpmStore(name) {
  if (!existsSync(pnpmStore)) return undefined
  const prefix = `${name.replace('/', '+')}@`
  const dirs = readdirSync(pnpmStore).filter(d => d.startsWith(prefix)).sort()
  for (const dir of dirs) {
    const candidate = join(pnpmStore, dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realDir(candidate)
  }
  return undefined
}

function locate(name) {
  for (const root of [fallback, webAppRoot, devRoot]) {
    const candidate = join(root, name)
    if (existsSync(join(candidate, 'package.json'))) return realDir(candidate)
  }
  return fromPnpmStore(name)
}

function ensureJunction(link, target) {
  mkdirSync(dirname(link), { recursive: true })
  let stat
  try { stat = lstatSync(link) } catch { stat = undefined }
  if (stat !== undefined) {
    if (!stat.isSymbolicLink()) throw new Error(`refusing to replace a real directory at ${link}`)
    let current
    try { current = realDir(readlinkSync(link)) } catch { current = undefined }
    if (current === target) return 'kept'
    rmdirSync(link) // removes the reparse point only, never the target contents
  }
  symlinkSync(target, link, 'junction')
  return 'linked'
}

const report = { linked: [], kept: [], missing: [] }
for (const name of names) {
  const target = locate(name)
  if (target === undefined) { report.missing.push(name); continue }
  const outcome = ensureJunction(join(pluginDir, 'node_modules', name), target)
  report[outcome].push(`${name} -> ${target}`)
}
for (const line of report.linked) console.log(`linked  ${line}`)
console.log(`kept ${report.kept.length}, linked ${report.linked.length}, missing ${report.missing.length}`)
for (const name of report.missing) console.log(`MISSING ${name}`)
process.exitCode = report.missing.length === 0 ? 0 : 1
