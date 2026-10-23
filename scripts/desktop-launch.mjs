import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { seedDesktopAssets } from './bundled-assets.mjs'

export function desktopLaunchConfiguration(root, options = {}, environment = process.env) {
  const metadata = JSON.parse(readFileSync(join(root, 'desktop-host.json'), 'utf8'))
  if (metadata.schemaVersion !== 1 || metadata.platform !== process.platform || metadata.arch !== process.arch) {
    throw new Error('Desktop host kit does not match this operating system and architecture')
  }
  const data = resolve(options.data ?? environment.AMPHOREUS_DESKTOP_DATA ?? join(environment.LOCALAPPDATA ?? join(homedir(), '.local', 'share'), 'dsh-amphoreus-desktop', metadata.pluginVersion))
  const home = join(data, 'home')
  const profile = join(home, 'profiles', 'desktop')
  const env = Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !/^DSH_/i.test(key) && !/^ELECTRON_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH'].includes(key)))
  Object.assign(env, {
    DSH_HOME: home,
    DSH_DESKTOP_DSH_DIR: join(root, 'app', 'dsh'),
    DSH_DESKTOP_PRIMARY_RUNTIME_DIR: join(root, 'runtime', 'primary-runtime'),
    DSH_DESKTOP_PNPM_ENTRY: join(root, 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'),
    DSH_DESKTOP_OPEN_DEVTOOLS: '0',
  })
  if (existsSync(join(root, 'bundled-assets.json'))) env.DSH_AMPHOREUS_ASSETS_ROOT = join(root, 'assets')
  const args = [`--user-data-dir=${join(data, 'electron')}`]
  if (options.debugPort !== undefined) {
    const port = Number(options.debugPort)
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('debug port must be 1024 through 65535')
    args.push('--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`)
  }
  args.push(join(root, 'app'))
  return { root, metadata, data, home, profile, env, args, executable: join(root, 'electron', process.platform === 'win32' ? 'electron.exe' : 'electron') }
}

export function prepareDesktopProfile(configuration) {
  const { profile } = configuration
  seedDesktopAssets(configuration.root, configuration.home)
  mkdirSync(profile, { recursive: true })
  const file = join(profile, 'package.json')
  const target = join(configuration.root, 'app', 'dsh', 'node_modules', 'dsh-amphoreus')
  const linkSpec = path => `link:${path.replaceAll('\\', '/')}`
  if (!existsSync(file)) writeFileSync(file, JSON.stringify({
    name: 'dsh-amphoreus-desktop-profile', private: true, version: '0.0.0',
    dependencies: { 'dsh-amphoreus': linkSpec(target) },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-amphoreus'] } },
  }, null, 2) + '\n', { flag: 'wx' })
  const workspace = join(profile, 'pnpm-workspace.yaml')
  if (!existsSync(workspace)) writeFileSync(workspace, 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n', { flag: 'wx' })
  const link = join(profile, 'node_modules', 'dsh-amphoreus')
  const receipt = join(profile, '.amphoreus-runtime-link.json')
  let stat
  try { stat = lstatSync(link) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (stat) {
    if (!stat.isSymbolicLink() || !existsSync(receipt)) return
    const previous = JSON.parse(readFileSync(receipt, 'utf8'))
    if (resolve(readlinkSync(link)) !== resolve(previous.target)) return
    if (resolve(previous.target) === resolve(target)) return
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    if (manifest.dependencies?.['dsh-amphoreus'] === linkSpec(previous.target)) {
      manifest.dependencies['dsh-amphoreus'] = linkSpec(target)
      writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')
    }
    unlinkSync(link)
  }
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  writeFileSync(receipt, JSON.stringify({ target }) + '\n')
}

async function main() {
  const { values } = parseArgs({ options: { data: { type: 'string' }, 'debug-port': { type: 'string' } } })
  const root = dirname(fileURLToPath(import.meta.url))
  const configuration = desktopLaunchConfiguration(root, { data: values.data, debugPort: values['debug-port'] })
  prepareDesktopProfile(configuration)
  const child = spawn(configuration.executable, configuration.args, { cwd: root, env: configuration.env, stdio: 'inherit', windowsHide: false })
  await new Promise((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`Desktop exited with code ${code}`)))
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
