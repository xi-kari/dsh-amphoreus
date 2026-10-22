/**
 * Create Windows junctions for local plugin development.
 * Resolve workspace packages by manifest name, then consult the profile fallback,
 * Web and root dependencies, and the pnpm store. Existing real directories are preserved.
 */
import { existsSync, globSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmdirSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = process.env.DSH_WORKSPACE_ROOT ?? resolve(pluginDir, '..', '..')
const devDirectory = join(workspace, 'deepseek-harness-dev')
const fallback = join(workspace, '.dsh-home', 'profiles', 'node_modules')
const devRoot = join(workspace, 'deepseek-harness-dev', 'node_modules')
const webAppRoot = join(workspace, 'deepseek-harness-dev', 'apps', 'web', 'node_modules')
const pnpmStore = join(devRoot, '.pnpm')
const manifest = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))
const workspacePackages = new Map(globSync(['vendor/*/package.json', 'packages/*/*/package.json'], { cwd: devDirectory })
  .map(path => {
    const absolutePath = join(devDirectory, path)
    return [JSON.parse(readFileSync(absolutePath, 'utf8')).name, dirname(absolutePath)]
  }))
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
  const source = workspacePackages.get(name)
  if (source !== undefined) return realDir(source)
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
