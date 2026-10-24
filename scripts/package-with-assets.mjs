import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { bundledResourcePath, inspectBundledResources, parseBundledResourceManifest } from '../src/host/bundled-resources.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LIFECYCLE_HOOKS = ['preinstall', 'install', 'postinstall', 'prepare', 'preprepare', 'postprepare', 'prepack', 'postpack', 'prepublish', 'prepublishOnly', 'publish', 'postpublish']

function buildEnvironment() {
  const env = { ...process.env }
  if (process.platform !== 'win32') return env
  for (const name of Object.keys(env)) if (name.toLowerCase() === 'path') delete env[name]
  const system = process.env.SystemRoot || 'C:\\Windows'
  env.PATH = [dirname(process.execPath), join(system, 'System32'), system, join(system, 'System32', 'Wbem')].join(';')
  return env
}

function command(executable, args, cwd) {
  if (process.platform === 'win32' && executable === 'git') {
    const inheritedPath = Object.entries(process.env).find(([name]) => name.toLowerCase() === 'path')?.[1] ?? ''
    const candidate = inheritedPath.split(';').map(directory => join(directory.replace(/^"|"$/gu, ''), 'git.exe')).find(path => existsSync(path))
    if (candidate === undefined) throw new Error('Packaging requires Git on the inherited PATH.')
    executable = realpathSync(candidate)
  }
  const result = spawnSync(executable, args, { cwd, env: buildEnvironment(), encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${executable} failed: ${result.stderr || result.stdout}`)
  return result.stdout
}

function npm(args, cwd) {
  if (process.platform !== 'win32') return command('npm', args, cwd)
  const entry = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (!existsSync(entry)) throw new Error('Packaging requires npm installed beside Node.js.')
  return command(process.execPath, [entry, ...args], cwd)
}

function sha(path) { return createHash('sha256').update(readFileSync(path)).digest('hex') }
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`) }

export function makeInstallManifest(source, sourceCommit) {
  if (source.name !== 'dsh-amphoreus' || typeof source.version !== 'string') throw new Error('Expected a dsh-amphoreus package manifest.')
  if (typeof sourceCommit !== 'string' || !/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error('Packaging requires the full 40-character source commit from Git HEAD.')
  const result = structuredClone(source)
  result.gitHead = sourceCommit
  result.files = [...new Set([...(result.files ?? []), 'resources/**'])]
  for (const hook of LIFECYCLE_HOOKS) if (result.scripts) delete result.scripts[hook]
  return result
}

export async function stageResourcePack(sourceRoot, destination) {
  sourceRoot = realpathSync(resolve(sourceRoot))
  if (existsSync(destination)) throw new Error('The resources staging directory already exists.')
  const source = JSON.parse(readFileSync(join(sourceRoot, 'bundled-assets.json'), 'utf8'))
  if (source.schemaVersion !== 1 || !Array.isArray(source.files)) throw new Error('Expected an audited bundled artwork manifest.')
  const files = source.files.filter(entry => typeof entry?.path === 'string'
    && (entry.path.startsWith('assets/') || entry.path.startsWith('assets-cache/') || entry.path === 'ASSETS-NOTICE.txt'))
  const sourceManifest = parseBundledResourceManifest({
    schemaVersion: 1,
    originals: files.filter(entry => entry.path.startsWith('assets/')).length,
    derived: files.filter(entry => entry.path.startsWith('assets-cache/')).length,
    bytes: files.reduce((sum, entry) => sum + entry.bytes, 0),
    files,
  })
  const stagedFiles = []
  for (const entry of sourceManifest.files) {
    const from = bundledResourcePath(sourceRoot, entry.path)
    const rel = relative(sourceRoot, realpathSync(from))
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || !lstatSync(from).isFile() || lstatSync(from).isSymbolicLink()) {
      throw new Error(`Artwork source is not a contained regular file: ${entry.path}`)
    }
    const to = bundledResourcePath(destination, entry.path)
    mkdirSync(dirname(to), { recursive: true })
    if (entry.path === 'ASSETS-NOTICE.txt') {
      const original = readFileSync(from)
      if (original.length !== entry.bytes || createHash('sha256').update(original).digest('hex') !== entry.sha256) throw new Error('Artwork source notice integrity mismatch.')
      const notice = Buffer.from(original.toString('utf8').replaceAll('bundled-assets.json', 'resources/manifest.json').replaceAll('本桌面包中的图像', '本素材包中的图像'))
      writeFileSync(to, notice, { flag: 'wx' })
      stagedFiles.push({ path: entry.path, bytes: notice.length, sha256: createHash('sha256').update(notice).digest('hex') })
    } else {
      copyFileSync(from, to, constants.COPYFILE_EXCL)
      stagedFiles.push(entry)
    }
  }
  const manifest = parseBundledResourceManifest({ ...sourceManifest, bytes: stagedFiles.reduce((sum, entry) => sum + entry.bytes, 0), files: stagedFiles })
  writeJson(join(destination, 'manifest.json'), manifest)
  await inspectBundledResources(destination)
  return manifest
}

export async function packageWithAssets({ assets, output, plugin = ROOT, baseTarball }) {
  plugin = resolve(plugin); output = resolve(output)
  const sourceCommit = command('git', ['rev-parse', '--verify', 'HEAD'], plugin).trim()
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error('Git HEAD did not return a full source commit.')
  if (existsSync(output) && readdirSync(output).length !== 0) throw new Error('Package output must be a new or empty directory.')
  mkdirSync(output, { recursive: true })
  const stage = join(output, 'stage')
  const base = join(output, 'base')
  mkdirSync(stage); mkdirSync(base)
  const expected = JSON.parse(readFileSync(join(plugin, 'package.json'), 'utf8'))
  if (baseTarball === undefined) {
    for (const file of ['lib/index.js', 'lib/client.js', 'lib/derive.js']) if (!existsSync(join(plugin, file))) throw new Error(`Build the plugin first: missing ${file}`)
    npm(['pack', '--ignore-scripts', '--json', '--pack-destination', base], plugin)
    baseTarball = join(base, `dsh-amphoreus-${expected.version}.tgz`)
  }
  baseTarball = resolve(baseTarball)
  const entries = command('tar', ['-tzf', baseTarball], output).trim().split(/\r?\n/u)
  for (const path of entries) {
    if (!path.startsWith('package/') || path.includes('\\') || path.includes(':') || path.split('/').includes('..')) throw new Error(`Invalid base package path: ${path}`)
    if (/^package\/(?:node_modules|resources|\.dsh-home|\.runtime|sessions)\//u.test(path)) throw new Error(`Unexpected base package content: ${path}`)
  }
  const descriptions = command('tar', ['-tvzf', baseTarball], output).trim().split(/\r?\n/u)
  if (descriptions.some(line => !line.startsWith('-') && !line.startsWith('d'))) throw new Error('Base plugin tarball must contain only regular files and directories.')
  command('tar', ['-xzf', baseTarball, '-C', stage], output)
  const packageRoot = join(stage, 'package')
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  if (manifest.name !== expected.name || manifest.version !== expected.version) throw new Error('Base package version does not match the current plugin.')
  for (const file of ['lib/index.js', 'lib/client.js', 'lib/derive.js', 'cordis.patch.yml']) {
    if (sha(join(packageRoot, file)) !== sha(join(plugin, file))) throw new Error(`Base package contains stale plugin output: ${file}`)
  }
  const installed = makeInstallManifest(manifest, sourceCommit)
  writeJson(join(packageRoot, 'package.json'), installed)
  const resources = await stageResourcePack(assets, join(packageRoot, 'resources'))
  npm(['pack', '--ignore-scripts', '--json', '--pack-destination', output], packageRoot)
  const filename = `dsh-amphoreus-${manifest.version}-with-assets.tgz`
  const tarball = join(output, filename)
  renameSync(join(output, `dsh-amphoreus-${manifest.version}.tgz`), tarball)
  const packed = JSON.parse(command('tar', ['-xOzf', tarball, 'package/package.json'], output))
  if (packed.gitHead !== sourceCommit) throw new Error('Packed plugin gitHead does not match its source commit.')
  if (LIFECYCLE_HOOKS.some(hook => packed.scripts?.[hook] !== undefined)) throw new Error('Packed plugin contains an install or build lifecycle hook.')
  const packedPaths = command('tar', ['-tzf', tarball], output).trim().split(/\r?\n/u)
  const set = new Set(packedPaths)
  for (const file of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'resources/manifest.json', ...resources.files.map(entry => `resources/${entry.path}`)]) {
    if (!set.has(`package/${file}`)) throw new Error(`Final plugin tarball omits ${file}`)
  }
  if (packedPaths.some(path => /(?:^|\/)(?:SKILL\.md|persona\.md|common\.md|relations\.md|assets-preferences\.json|settings\.yaml|sessions|node_modules)(?:\/|$)/u.test(path))) {
    throw new Error('Final plugin tarball contains private, skill, or user-state content.')
  }
  const digest = sha(tarball)
  if (command('git', ['rev-parse', '--verify', 'HEAD'], plugin).trim() !== sourceCommit) throw new Error('Git HEAD changed during packaging; rebuild from one source commit.')
  writeFileSync(`${tarball}.sha256`, `${digest}  ${filename}\n`)
  const provenance = {
    schemaVersion: 1, package: manifest.name, version: manifest.version,
    sourceCommit,
    sourceDiffSha256: createHash('sha256').update(command('git', ['diff', '--binary', 'HEAD', '--'], plugin)).digest('hex'),
    resources: { originals: resources.originals, derived: resources.derived, bytes: resources.bytes, manifestSha256: sha(join(packageRoot, 'resources', 'manifest.json')) },
    tarball: { file: filename, bytes: statSync(tarball).size, sha256: digest },
  }
  writeJson(join(output, 'provenance.json'), provenance)
  console.log(JSON.stringify({ tarball, ...provenance.tarball, resources: provenance.resources }, null, 2))
  return { tarball, provenance }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { assets: { type: 'string' }, out: { type: 'string' }, 'base-tarball': { type: 'string' } } })
  if (!values.assets || !values.out) throw new Error('Usage: node scripts/package-with-assets.mjs --assets <audited artwork directory> --out <new output directory> [--base-tarball <plugin.tgz>]')
  await packageWithAssets({ assets: values.assets, output: values.out, baseTarball: values['base-tarball'] })
}
