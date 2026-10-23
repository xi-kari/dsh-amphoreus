import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function artifactPath(root, name) {
  if (typeof name !== 'string' || name === '' || name.includes('\\') || name.includes(':')
    || name.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`Invalid artifact path: ${String(name)}`)
  }
  return join(root, ...name.split('/'))
}

export function verifyFiles(root, records) {
  if (!Array.isArray(records) || records.length === 0) throw new Error('The host kit has no integrity records.')
  const seen = new Set()
  for (const entry of records) {
    if (seen.has(entry.path)) throw new Error(`Duplicate integrity record: ${entry.path}`)
    seen.add(entry.path)
    const bytes = readFileSync(artifactPath(root, entry.path))
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
    if (bytes.length !== entry.bytes || integrity !== entry.integrity) {
      throw new Error(`Host kit integrity check failed: ${entry.path}`)
    }
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`)
}

export function preparePnpm(root, provenance) {
  const tools = join(root, '.tools')
  const entry = join(tools, 'package', 'bin', 'pnpm.mjs')
  if (!existsSync(entry)) {
    mkdirSync(tools, { recursive: true })
    run('tar', ['-xzf', artifactPath(root, provenance.pnpm.path), '-C', tools])
  }
  const manifest = JSON.parse(readFileSync(join(tools, 'package', 'package.json'), 'utf8'))
  if (manifest.name !== 'pnpm' || manifest.version !== provenance.pnpm.version) throw new Error('Unexpected pnpm bootstrap version.')
  return entry
}

export function createProfile(home) {
  const profile = join(home, 'profiles', 'web')
  const file = join(profile, 'package.json')
  mkdirSync(profile, { recursive: true })
  if (!existsSync(file)) {
    writeFileSync(file, `${JSON.stringify({
      name: 'dsh-amphoreus-host-profile', private: true, amphoreusHostKit: 1,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-amphoreus'] } },
    }, null, 2)}\n`, { flag: 'wx' })
  } else {
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    const bundles = manifest.dsh?.profile?.bundles
    if (!Array.isArray(bundles) || !bundles.includes('dsh-amphoreus')) {
      throw new Error(`Existing profile does not enable dsh-amphoreus: ${file}`)
    }
  }
  const patch = join(profile, 'cordis.patch.yml')
  if (!existsSync(patch)) writeFileSync(patch, '[]\n', { flag: 'wx' })
  return profile
}

export function linkPlugin(profile, plugin) {
  const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  const destination = join(profile, 'node_modules', 'dsh-amphoreus')
  let entry
  try { entry = lstatSync(destination) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (entry) {
    if (existsSync(destination) && realpathSync(destination) === realpathSync(plugin)) return
    if (!entry.isSymbolicLink() || manifest.amphoreusHostKit !== 1) {
      throw new Error(`Existing profile owns a different plugin installation: ${destination}`)
    }
    unlinkSync(destination)
  }
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(realpathSync(plugin), destination, process.platform === 'win32' ? 'junction' : 'dir')
}

export function hostEnvironment(root, environment = process.env) {
  const home = resolve(environment.DSH_HOME || join(root, '.dsh-home'))
  return { ...environment, DSH_HOME: home }
}

export function installerEnvironment(environment = process.env, platform = process.platform) {
  const result = Object.fromEntries(Object.entries(environment).filter(([key]) => key.toLowerCase() !== 'path'))
  const executableDirectory = dirname(process.execPath)
  if (platform === 'win32') {
    const systemRoot = environment.SystemRoot || environment.SYSTEMROOT || 'C:\\Windows'
    result.PATH = [executableDirectory, join(systemRoot, 'System32'), systemRoot, join(systemRoot, 'System32', 'Wbem'), join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')].join(';')
  } else {
    result.PATH = [executableDirectory, environment.PATH || '/usr/local/bin:/usr/bin:/bin'].join(delimiter)
  }
  return result
}

export function main(args = process.argv.slice(2), root = dirname(fileURLToPath(import.meta.url))) {
  const manifest = JSON.parse(readFileSync(join(root, 'integrity.json'), 'utf8'))
  verifyFiles(root, manifest.files)
  const provenance = JSON.parse(readFileSync(join(root, 'provenance.json'), 'utf8'))
  const command = args[0] ?? 'start'
  if (command === 'verify') {
    console.log(`Host kit integrity verified (${manifest.files.length} files).`)
    return
  }
  if (command === 'install') {
    const pnpm = preparePnpm(root, provenance)
    run(process.execPath, [pnpm, '--config.registry=https://registry.npmjs.org', 'install', '--prod', '--frozen-lockfile'], { cwd: root, env: installerEnvironment() })
    console.log('Host installation complete. Run: node runtime.mjs start')
    return
  }
  if (command !== 'start') throw new Error('Usage: node runtime.mjs [verify|install|start] [DSH web arguments]')
  const cli = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!existsSync(cli)) throw new Error('Install the host first: node runtime.mjs install')
  const env = hostEnvironment(root)
  const profile = createProfile(env.DSH_HOME)
  linkPlugin(profile, join(root, 'node_modules', 'dsh-amphoreus'))
  run(process.execPath, [cli, '--profile', 'web', ...args.slice(1)], { cwd: root, env })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
