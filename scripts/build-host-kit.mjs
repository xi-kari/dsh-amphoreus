import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { preparePnpm } from './host-kit-runtime.mjs'

export const HOST_BASELINE = '687f282e8625c6b8d11ff58211a90524be2e4317'
export const HOST_VERSION = '0.2.1-rc.2'
export const PNPM_VERSION = '11.28.5'
export const PATCHED_PACKAGES = [
  ['@deepseek-ai/dsh-workspace', 'packages/workspace/workspace', ['lib/index.js']],
  ['@deepseek-ai/dsh-api-workspace-controller', 'packages/api/workspace-controller', ['lib/index.js', 'lib/client.js', 'lib/typert.host.js', 'lib/typert.remote-client.js']],
  ['@deepseek-ai/dsh-client-ui-workspace', 'packages/client/ui-workspace', ['lib/index.js', 'lib/client.js']],
  ['@deepseek-ai/dsh-cordis-client-runner', 'packages/extensions/cordis-client-runner', ['lib/index.js', 'lib/client.js']],
  ['@deepseek-ai/dsh-tool-cordis', 'packages/extensions/tool-cordis', ['lib/index.js']],
]
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PATCH = 'compat/dsh-v0.2.1-rc.2-workspace-visibility.patch'

function capture(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed: ${result.stderr || result.stdout}`)
  return result.stdout
}

function sha(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function json(path) { return JSON.parse(readFileSync(path, 'utf8')) }
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`) }
function normalizedDiff(value) { return value.replaceAll('\r\n', '\n').trimEnd() }

export function verifyHostLock(lock) {
  const versions = [...lock.matchAll(/^\s{2}'?(@deepseek-ai\/dsh(?:-[a-z0-9-]+)?)@([^:('"\s]+)/gmu)]
  if (versions.length === 0) throw new Error('The host lockfile contains no DSH packages.')
  for (const [, name, version] of versions) {
    if (version === 'file' && PATCHED_PACKAGES.some(([patched]) => patched === name)) continue
    if (version !== HOST_VERSION) throw new Error(`Host lockfile mixes DSH versions: ${name}@${version}`)
  }
}

function latestSourceTimestamp(directory) {
  let latest = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) latest = Math.max(latest, latestSourceTimestamp(path))
    else if (entry.isFile() && /\.(?:tsx?|css)$/u.test(entry.name)) latest = Math.max(latest, statSync(path).mtimeMs)
  }
  return latest
}

export function validateSource(source, patch) {
  const head = capture('git', ['rev-parse', 'HEAD'], source).trim()
  if (head !== HOST_BASELINE) throw new Error(`Host source must be ${HOST_BASELINE}; found ${head}`)
  const diff = capture('git', ['diff', '--binary', 'HEAD', '--'], source)
  if (normalizedDiff(diff) !== normalizedDiff(patch)) throw new Error('Host source changes do not exactly match the shipped compatibility patch.')
  return { commit: head, patchSha256: sha(Buffer.from(patch)), sourceDiffSha256: sha(Buffer.from(normalizedDiff(diff))) }
}

export function hostManifest(version, packages, pluginArchive) {
  return {
    name: 'dsh-amphoreus-host', version, private: true, type: 'module',
    description: 'Unofficial DSH host distribution for dsh-amphoreus',
    packageManager: `pnpm@${PNPM_VERSION}`,
    engines: { node: '^22.19.0 || >=24' },
    dependencies: {
      '@deepseek-ai/dsh': HOST_VERSION,
      ...Object.fromEntries(packages.map(entry => [entry.name, `file:./${entry.path}`])),
      'dsh-amphoreus': `file:./${pluginArchive}`,
    },
  }
}

export function workspaceConfig(packages) {
  return `packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: true\noverrides:\n${packages.map(entry => `  ${JSON.stringify(entry.name)}: ${JSON.stringify(`file:./${entry.path}`)}`).join('\n')}\nallowBuilds:\n  node-pty: true\n  koffi: true\n  fs-ext: true\n  '@deepseek-ai/dsh-subprocess-local': true\n  '@google/genai': false\n  protobufjs: false\n  node-addon-require-builtin: false\n`
}

function archiveRecord(root, path, name, version) {
  const body = readFileSync(join(root, path))
  return { name, version, path, bytes: body.length, sha256: sha(body), integrity: `sha512-${createHash('sha512').update(body).digest('base64')}` }
}

function pack(source, directory, output, pnpm, expectedName, expectedVersion, required) {
  const absolute = join(source, directory)
  const manifest = json(join(absolute, 'package.json'))
  if (manifest.name !== expectedName || manifest.version !== expectedVersion) throw new Error(`Unexpected package identity in ${directory}`)
  for (const file of required) if (!existsSync(join(absolute, file))) throw new Error(`Missing built host artifact: ${directory}/${file}`)
  const newestSource = latestSourceTimestamp(join(absolute, 'src'))
  for (const file of required) {
    if (statSync(join(absolute, file)).mtimeMs < newestSource) throw new Error(`Stale built host artifact: ${directory}/${file}; rebuild the patched host first.`)
  }
  for (const hook of ['prepack', 'prepare', 'postpack']) {
    if (manifest.scripts?.[hook]) throw new Error(`Host package has an unexpected pack hook: ${expectedName}:${hook}`)
  }
  capture(process.execPath, [pnpm, '--config.ignore-scripts=true', '--dir', absolute, 'pack', '--pack-destination', join(output, 'packages')], source)
  const filename = `${expectedName.replace('@', '').replace('/', '-')}-${expectedVersion}.tgz`
  const path = `packages/${filename}`
  const archive = join(output, path)
  const packed = JSON.parse(capture('tar', ['-xOzf', archive, 'package/package.json'], output))
  if (packed.name !== expectedName || packed.version !== expectedVersion) throw new Error(`Packed package identity mismatch: ${path}`)
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const value of Object.values(packed[section] ?? {})) if (String(value).startsWith('workspace:')) throw new Error(`${path} contains an unresolved workspace dependency`)
  }
  const files = capture('tar', ['-tzf', archive], output).trim().split(/\r?\n/u)
  for (const file of required) if (!files.includes(`package/${file}`)) throw new Error(`Packed host artifact missing: ${path}:${file}`)
  for (const file of files) {
    if (!file.startsWith('package/') || file.split('/').includes('..') || /(?:^|\/)(?:\.dsh-home|\.runtime|node_modules|sessions|settings\.yaml)(?:\/|$)/u.test(file)) {
      throw new Error(`Unexpected private path in ${path}: ${file}`)
    }
  }
  return archiveRecord(output, path, expectedName, expectedVersion)
}

export function stageHostPackages(source, output, plugin = ROOT) {
  const patch = readFileSync(join(plugin, PATCH), 'utf8')
  const sourceIdentity = validateSource(source, patch)
  const pnpm = join(source, 'apps', 'desktop', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  if (!existsSync(pnpm)) throw new Error('The DSH checkout needs its pinned pnpm development dependency.')
  mkdirSync(join(output, 'packages'), { recursive: true })
  const packages = PATCHED_PACKAGES.map(([name, directory, required]) => pack(source, directory, output, pnpm, name, HOST_VERSION, required))
  writeJson(join(output, 'host-packages.json'), { schemaVersion: 1, host: { version: HOST_VERSION, ...sourceIdentity }, packages })
  return { sourceIdentity, packages, pnpm }
}

async function downloadPnpm(output) {
  const response = await fetch(`https://registry.npmjs.org/pnpm/${PNPM_VERSION}`)
  if (!response.ok) throw new Error(`Unable to resolve pnpm ${PNPM_VERSION}: HTTP ${response.status}`)
  const metadata = await response.json()
  if (metadata.version !== PNPM_VERSION || !String(metadata.dist?.tarball).startsWith('https://registry.npmjs.org/pnpm/')) throw new Error('Unexpected pnpm registry metadata.')
  const archive = await fetch(metadata.dist.tarball)
  if (!archive.ok) throw new Error(`Unable to download pnpm: HTTP ${archive.status}`)
  const body = Buffer.from(await archive.arrayBuffer())
  if (`sha512-${createHash('sha512').update(body).digest('base64')}` !== metadata.dist.integrity) throw new Error('pnpm download integrity mismatch.')
  const path = `packages/pnpm-${PNPM_VERSION}.tgz`
  writeFileSync(join(output, path), body)
  return archiveRecord(output, path, 'pnpm', PNPM_VERSION)
}

export async function buildHostKit({ source, output, plugin = ROOT }) {
  source = resolve(source); output = resolve(output); plugin = resolve(plugin)
  if (existsSync(output) && readdirSync(output).length !== 0) throw new Error('Host kit output must be a new or empty directory.')
  const manifest = json(join(plugin, 'package.json'))
  for (const file of ['lib/index.js', 'lib/client.js', 'lib/derive.js']) if (!existsSync(join(plugin, file))) throw new Error(`Missing plugin artifact: ${file}`)
  const { sourceIdentity, packages, pnpm } = stageHostPackages(source, output, plugin)
  capture(process.execPath, [pnpm, '--config.ignore-scripts=true', '--dir', plugin, 'pack', '--pack-destination', join(output, 'packages')], plugin)
  const pluginPath = `packages/dsh-amphoreus-${manifest.version}.tgz`
  const pluginRecord = archiveRecord(output, pluginPath, manifest.name, manifest.version)
  writeJson(join(output, 'package.json'), hostManifest(manifest.version, packages, pluginPath))
  writeFileSync(join(output, 'pnpm-workspace.yaml'), workspaceConfig(packages))
  writeFileSync(join(output, '.npmrc'), 'registry=https://registry.npmjs.org/\n')
  cpSync(join(plugin, 'scripts', 'host-kit-runtime.mjs'), join(output, 'runtime.mjs'))
  cpSync(join(source, 'LICENSE'), join(output, 'LICENSE-DSH'))
  cpSync(join(plugin, 'LICENSE'), join(output, 'LICENSE-AMPHOREUS'))
  cpSync(join(plugin, PATCH), join(output, 'workspace-visibility.patch'))
  const manager = await downloadPnpm(output)
  const provenance = {
    schemaVersion: 1, host: { version: HOST_VERSION, ...sourceIdentity },
    plugin: { version: manifest.version, commit: capture('git', ['rev-parse', 'HEAD'], plugin).trim(), sourceDiffSha256: sha(Buffer.from(capture('git', ['diff', '--binary', 'HEAD', '--'], plugin))) },
    pnpm: manager, packages: [...packages, pluginRecord],
  }
  writeJson(join(output, 'provenance.json'), provenance)
  const installerPnpm = preparePnpm(output, provenance)
  console.log('Resolving the frozen production dependency lockfile...')
  capture(process.execPath, [installerPnpm, '--config.registry=https://registry.npmjs.org', 'install', '--lockfile-only', '--ignore-scripts'], output)
  const lock = readFileSync(join(output, 'pnpm-lock.yaml'), 'utf8')
  verifyHostLock(lock)
  for (const entry of packages) if (!lock.includes(entry.path)) throw new Error(`Lockfile lost patched archive ${entry.path}`)
  for (const privatePath of [source, plugin, output]) if (lock.includes(privatePath) || lock.includes(privatePath.replaceAll('\\', '/'))) throw new Error('Lockfile contains a build-machine path.')
  writeFileSync(join(output, 'Install.cmd'), '@echo off\r\ncd /d "%~dp0"\r\nnode runtime.mjs install\r\nif errorlevel 1 pause\r\n')
  writeFileSync(join(output, 'Start.cmd'), '@echo off\r\ncd /d "%~dp0"\r\nnode runtime.mjs start %*\r\nif errorlevel 1 pause\r\n')
  writeFileSync(join(output, 'README.txt'), `DSH Amphoreus Host ${manifest.version}\n\nUnofficial distribution based on DSH ${HOST_VERSION}.\nRequires Node.js 22.19+ or 24+ and the tar command. First installation needs internet access.\n\n1. Run node runtime.mjs verify\n2. Run node runtime.mjs install (or Install.cmd on Windows)\n3. Run node runtime.mjs start (or Start.cmd on Windows)\n\nThe host uses .dsh-home inside this directory by default. DSH_HOME explicitly selects another home; existing profiles are never overwritten. External Amphoreus skills and artwork remain user-managed.\n\nThe five patched DSH packages and dsh-amphoreus are included as built archives. pnpm-lock.yaml freezes the production dependency graph. provenance.json records upstream identity and artifact hashes; integrity.json verifies the distribution files.\n\nThis kit runs the web host. Official Electron Desktop requires a compatible bundled host; installing this kit does not replace an installed desktop application.\n\nDSH and dsh-amphoreus use the MIT licenses included here. Patched upstream files are described by workspace-visibility.patch; upstream repository: https://github.com/deepseek-ai/deepseek-harness\n`)
  const files = []
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name)
      const path = relative(output, full).replaceAll('\\', '/')
      if (path === '.tools' || path === 'node_modules') continue
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile()) {
        const bytes = readFileSync(full)
        files.push({ path, bytes: statSync(full).size, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` })
      } else throw new Error(`Unexpected nonregular distribution entry: ${path}`)
    }
  }
  visit(output)
  writeJson(join(output, 'integrity.json'), { schemaVersion: 1, files: files.sort((a, b) => a.path.localeCompare(b.path)) })
  const archive = `${output}${process.platform === 'win32' ? '.zip' : '.tar.gz'}`
  if (existsSync(archive)) throw new Error(`Refusing to replace an existing host archive: ${archive}`)
  capture('tar', [...(process.platform === 'win32' ? ['-a', '-cf'] : ['-czf']), archive, '-C', output, ...files.map(file => file.path), 'integrity.json'], output)
  writeFileSync(`${archive}.sha256`, `${sha(readFileSync(archive))}  ${basename(archive)}\n`)
  console.log(`Host kit prepared: ${output}`)
  console.log(`Host kit archive: ${archive}`)
  return { output, archive, provenance }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { source: { type: 'string' }, out: { type: 'string' } } })
  if (!values.source || !values.out) throw new Error('Usage: node scripts/build-host-kit.mjs --source <patched DSH checkout> --out <new output directory>')
  await buildHostKit({ source: values.source, output: values.out })
}
