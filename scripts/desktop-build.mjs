import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, globSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, matchesGlob, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { bundleDesktopAssets } from './bundled-assets.mjs'

const SOURCE_COMMIT = '687f282e8625c6b8d11ff58211a90524be2e4317'
const HOST_VERSION = '0.2.1-rc.2'
const json = file => JSON.parse(readFileSync(file, 'utf8'))
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n')

export function safeRelative(root, value) {
  if (typeof value !== 'string' || value === '' || value.includes('\\') || value.includes(':') || value.split('/').some(p => p === '..' || p === '.' || p === '')) {
    throw new Error(`Invalid artifact path: ${value}`)
  }
  const target = resolve(root, value)
  if (!target.startsWith(resolve(root) + sep)) throw new Error(`Artifact path escapes root: ${value}`)
  return target
}

export function sourceIndex(root) {
  const index = new Map()
  for (const file of globSync(['packages/*/*/package.json', 'apps/*/package.json', 'vendor/*/package.json', 'native/system/package.json', 'native/system/packages/*/package.json'], { cwd: root })) {
    const manifest = json(join(root, file))
    if (manifest.name) index.set(manifest.name, { directory: dirname(join(root, file)), manifest })
  }
  return index
}

function normalizedManifest(manifest, index) {
  const result = structuredClone(manifest)
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, range] of Object.entries(result[section] ?? {})) {
      if (!range.startsWith('workspace:')) continue
      const version = index.get(name)?.manifest.version
      if (!version) throw new Error(`Missing workspace package ${name}`)
      result[section][name] = range === 'workspace:*' ? version : range.replace('workspace:', '') + version
    }
  }
  delete result.devDependencies
  delete result.scripts
  return result
}

export function materializePackage(source, destination, index, license) {
  const manifest = normalizedManifest(source.manifest, index)
  const previous = existsSync(join(destination, 'package.json')) ? normalizedManifest(json(join(destination, 'package.json')), index) : undefined
  if (previous && (previous.name !== manifest.name || previous.version !== manifest.version)) throw new Error(`Package identity differs: ${manifest.name}`)
  if (previous) for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, range] of Object.entries(manifest[section] ?? {})) {
      if (previous[section]?.[name] !== range) throw new Error(`Official dependency differs: ${manifest.name} ${name}`)
    }
  }
  if (!Array.isArray(manifest.files)) throw new Error(`No explicit package files: ${manifest.name}`)
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(destination)) if (entry !== 'node_modules') rmSync(join(destination, entry), { recursive: true, force: true })
  const exclusions = manifest.files.filter(pattern => pattern.startsWith('!')).map(pattern => pattern.slice(1))
  const included = globSync(manifest.files.filter(pattern => !pattern.startsWith('!')), { cwd: source.directory, exclude: exclusions })
  for (const file of included) {
    const from = join(source.directory, file)
    const target = join(destination, file)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(from, target, { recursive: true, dereference: true, filter: path => {
      const packagePath = relative(source.directory, path).split(sep).join('/')
      return !packagePath.split('/').includes('node_modules') && !path.endsWith('.map')
        && !exclusions.some(pattern => matchesGlob(packagePath, pattern) || packagePath.startsWith(pattern + '/'))
    } })
  }
  cpSync(existsSync(join(source.directory, 'LICENSE')) ? join(source.directory, 'LICENSE') : license, join(destination, 'LICENSE'))
  if (existsSync(join(source.directory, 'NOTICE'))) cpSync(join(source.directory, 'NOTICE'), join(destination, 'NOTICE'))
  writeJson(join(destination, 'package.json'), manifest)
  return manifest
}

export function copyPluginDependencies(plugin, destination) {
  const manifest = json(join(plugin, 'package.json'))
  const require = createRequire(join(plugin, 'package.json'))
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    let file
    try { file = require.resolve(`${name}/package.json`) } catch {
      let directory = dirname(require.resolve(name))
      while (!existsSync(join(directory, 'package.json'))) {
        const parent = dirname(directory)
        if (parent === directory) throw new Error(`Cannot locate dependency manifest: ${name}`)
        directory = parent
      }
      file = join(directory, 'package.json')
    }
    const dependency = json(file)
    if (dependency.name !== name) throw new Error(`Dependency package identity differs: ${name}`)
    const target = join(destination, 'node_modules', name)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(dirname(file), target, { recursive: true, dereference: true, filter: path => !relative(dirname(file), path).split(sep).includes('node_modules') })
    copyPluginDependencies(dirname(file), target)
  }
}

export function inventory(root) {
  const files = []
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      const name = relative(root, file).split(sep).join('/')
      if (name === 'desktop-runtime.json') continue
      if (entry.isDirectory()) visit(file)
      else if (entry.isFile()) files.push({ path: name, bytes: lstatSync(file).size, sha256: hash(file), executable: false })
      else throw new Error(`Nonportable runtime link: ${name}`)
    }
  }
  visit(root)
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

async function main() {
  const { values } = parseArgs({ options: Object.fromEntries(['source', 'official-desktop', 'host-kit', 'plugin', 'out', 'assets', 'cache'].map(name => [name, { type: 'string' }])) })
  for (const name of ['source', 'official-desktop', 'host-kit', 'plugin', 'out']) if (!values[name]) throw new Error(`--${name} is required`)
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This builder currently supports Windows x64')
  const source = resolve(values.source)
  const official = resolve(values['official-desktop'])
  const hostKit = resolve(values['host-kit'])
  const plugin = resolve(values.plugin)
  const out = resolve(values.out)
  if (existsSync(out)) throw new Error('Output must be a new directory')
  if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim() !== SOURCE_COMMIT) throw new Error('Source checkout is not the required DSH commit')
  const patch = readFileSync(join(plugin, 'compat', 'dsh-v0.2.1-rc.2-workspace-visibility.patch'))
  const diff = execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: source })
  const normalize = buffer => buffer.toString().replaceAll('\r\n', '\n').trim()
  if (normalize(patch) !== normalize(diff)) throw new Error('Source changes do not exactly match the compatibility patch')
  const packages = json(join(hostKit, 'host-packages.json'))
  if (packages.host.commit !== SOURCE_COMMIT || packages.host.version !== HOST_VERSION) throw new Error('Host package set identity differs')
  for (const entry of packages.packages) if (hash(safeRelative(hostKit, entry.path)) !== entry.sha256) throw new Error(`Host package integrity failed: ${entry.name}`)
  const asarEntry = globSync('node_modules/.pnpm/@electron+asar@*/node_modules/@electron/asar/lib/asar.js', { cwd: source })[0]
  if (!asarEntry) throw new Error('Build source dependencies are not installed')
  const asar = (await import(pathToFileURL(join(source, asarEntry)))).default
  const archive = join(official, 'resources', 'app.asar')
  const officialManifest = JSON.parse(asar.extractFile(archive, 'package.json'))
  if (officialManifest.version !== HOST_VERSION) throw new Error('Official desktop version differs')
  mkdirSync(out, { recursive: true })
  console.log('Extracting licensed official dependency and native runtime payloads')
  const app = join(out, 'app')
  asar.extractAll(archive, app)
  cpSync(join(official, 'resources', 'runtime'), join(out, 'runtime'), { recursive: true })
  rmSync(join(out, 'runtime', 'cli'), { recursive: true, force: true })
  const electron = join(out, 'electron')
  mkdirSync(join(electron, 'resources'), { recursive: true })
  for (const entry of readdirSync(official, { withFileTypes: true })) {
    if (entry.isFile() && (/\.(dll|pak|dat|bin)$/i.test(entry.name) || /^LICENSE/i.test(entry.name) || entry.name === 'vk_swiftshader_icd.json')) cpSync(join(official, entry.name), join(electron, entry.name))
  }
  cpSync(join(official, 'DeepSeek Harness.exe'), join(electron, 'electron.exe'))
  cpSync(join(official, 'locales'), join(electron, 'locales'), { recursive: true })
  cpSync(join(official, 'resources', 'default_app.asar'), join(electron, 'resources', 'default_app.asar'))
  const index = sourceIndex(source)
  const runtime = join(app, 'dsh')
  const descriptor = json(join(runtime, 'desktop-runtime.json'))
  const rebuilt = []
  for (const entry of descriptor.sharedPackages) {
    const found = index.get(entry.name)
    if (!found || !Array.isArray(found.manifest.files) || found.directory.startsWith(join(source, 'native') + sep)) continue
    materializePackage(found, safeRelative(runtime, entry.path), index, join(source, 'LICENSE'))
    rebuilt.push(entry.name)
  }
  console.log(`Materialized ${rebuilt.length} exact-source workspace packages`)
  for (const entry of packages.packages) {
    const destination = join(runtime, 'node_modules', entry.name)
    execFileSync('tar', ['-xzf', safeRelative(hostKit, entry.path), '-C', destination, '--strip-components=1'], { windowsHide: true })
  }
  const pluginManifest = materializePackage({ directory: plugin, manifest: json(join(plugin, 'package.json')) }, join(runtime, 'node_modules', 'dsh-amphoreus'), index, join(plugin, 'LICENSE'))
  copyPluginDependencies(plugin, join(runtime, 'node_modules', 'dsh-amphoreus'))
  if (!descriptor.sharedPackages.some(entry => entry.name === 'dsh-amphoreus')) descriptor.sharedPackages.push({ name: 'dsh-amphoreus', version: pluginManifest.version, path: 'node_modules/dsh-amphoreus' })
  descriptor.sharedPackages.sort((a, b) => a.name.localeCompare(b.name))
  descriptor.files = inventory(runtime)
  writeJson(join(runtime, 'desktop-runtime.json'), descriptor)
  for (const entry of readdirSync(join(app, 'node_modules', '@deepseek-ai'))) {
    const found = index.get(`@deepseek-ai/${entry}`)
    if (found) materializePackage(found, join(app, 'node_modules', '@deepseek-ai', entry), index, join(source, 'LICENSE'))
  }
  cpSync(join(source, 'apps', 'desktop', 'lib'), join(app, 'lib'), { recursive: true, filter: path => !path.includes(`${sep}types${sep}`) && basename(path) !== 'types' && !path.endsWith('.map') && !path.endsWith('.tsbuildinfo') })
  cpSync(join(source, 'apps', 'desktop', 'scripts', 'node-bin'), join(app, 'scripts', 'node-bin'), { recursive: true })
  cpSync(join(source, 'apps', 'desktop', 'resources'), join(app, 'resources'), { recursive: true })
  cpSync(join(source, 'apps', 'desktop', 'renderer'), join(app, 'renderer'), { recursive: true })
  for (const file of [join(app, 'lib', 'main.js'), join(app, 'lib', 'welcome', 'welcome.js')]) {
    writeFileSync(file, readFileSync(file, 'utf8').replaceAll('DeepSeek Harness', 'dsh-amphoreus Desktop Host'))
  }
  const sharp = createRequire(join(source, 'apps', 'desktop', 'package.json'))('sharp')
  await sharp(join(plugin, 'icon.svg')).resize(256, 256).png().toFile(join(app, 'resources', 'icon-windows.png'))
  cpSync(join(app, 'resources', 'icon-windows.png'), join(app, 'resources', 'icon.png'))
  const tray = await sharp(join(plugin, 'icon.svg')).resize(32, 32).png().toBuffer()
  const ico = Buffer.alloc(22)
  ico.writeUInt16LE(1, 2)
  ico.writeUInt16LE(1, 4)
  ico[6] = 32
  ico[7] = 32
  ico.writeUInt16LE(1, 10)
  ico.writeUInt16LE(32, 12)
  ico.writeUInt32LE(tray.length, 14)
  ico.writeUInt32LE(22, 18)
  writeFileSync(join(app, 'resources', 'tray-windows.ico'), Buffer.concat([ico, tray]))
  writeJson(join(app, 'package.json'), { name: 'dsh-amphoreus-desktop-host', productName: 'dsh-amphoreus Desktop Host', version: HOST_VERSION, private: true, type: 'module', main: 'amphoreus-main.mjs', license: 'MIT', dependencies: officialManifest.dependencies, dshDesktopAppId: 'io.github.xi-kari.dsh-amphoreus.desktop', dshBuildCommit: SOURCE_COMMIT, dshBuildDirty: true })
  writeFileSync(join(app, 'amphoreus-main.mjs'), "import { app } from 'electron'\napp.setName('dsh-amphoreus Desktop Host')\nawait import('./lib/main.js')\n")
  cpSync(join(source, 'LICENSE'), join(out, 'LICENSE-DSH.txt'))
  cpSync(join(plugin, 'LICENSE'), join(out, 'LICENSE-Amphoreus.txt'))
  cpSync(join(plugin, 'NOTICE'), join(out, 'NOTICE'))
  cpSync(join(plugin, 'scripts', 'desktop-launch.mjs'), join(out, 'desktop-launch.mjs'))
  cpSync(join(plugin, 'scripts', 'desktop-cli.mjs'), join(out, 'desktop-cli.mjs'))
  cpSync(join(plugin, 'scripts', 'bundled-assets.mjs'), join(out, 'bundled-assets.mjs'))
  const bundledAssets = await bundleDesktopAssets(values.assets, values.cache, out)
  if (bundledAssets) console.log(`Bundled ${bundledAssets.originals} original assets and ${bundledAssets.derived} derived images`)
  writeFileSync(join(out, 'Start-Amphoreus.cmd'), '@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0electron\\electron.exe" "%~dp0desktop-launch.mjs" %*\r\n')
  writeFileSync(join(out, 'dsh.cmd'), '@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0electron\\electron.exe" --expose-internals "%~dp0desktop-cli.mjs" %*\r\n')
  writeFileSync(join(out, 'README.md'), `# dsh-amphoreus Desktop Host\n\n基于 DSH ${HOST_VERSION} 构建的非官方 Windows x64 便携宿主，内含 dsh-amphoreus ${pluginManifest.version} 及其工作区可见性兼容层。\n\n解压到独立目录后，双击 Start-Amphoreus.cmd。完成宿主首次启动设置后，左侧显示黄金裔席位与 δ-me13 总览。插件不附带技能正文。${bundledAssets ? `本包已包含 ${bundledAssets.originals} 张原图与 ${bundledAssets.derived} 张界面派生图，首次启动自动配置杂志界面、壁纸与互动效果。` : '素材在插件设置中指定。'}技能会读取本机 ~/.claude/skills 和 ~/.codex/skills，可在插件设置中调整技能和素材路径。\n\n默认数据位于 %LOCALAPPDATA%/dsh-amphoreus-desktop/${pluginManifest.version}/，包含 home 和 electron 两个子目录。需要指定其他位置时运行：\n\n\`\`\`bat\nStart-Amphoreus.cmd --data "D:\\Amphoreus Data"\n\`\`\`\n\n移动程序目录后继续使用同一个数据目录即可；启动器只更新自己创建的插件链接，并保留已经单独安装的插件目录。关闭窗口可能保留托盘进程，退出请使用应用菜单。\n\n命令行入口为本目录的 dsh.cmd，例如：\n\n\`\`\`bat\ndsh.cmd --help\ndsh.cmd plugin --profile desktop list\n\`\`\`\n\n若桌面使用自定义数据目录，请在运行命令前设置相同的 AMPHOREUS_DESKTOP_DATA 环境变量。这个便携宿主使用 DSH 官方的开发模式，自动更新处于关闭状态。更新时使用本项目提供的完整配套宿主包。它不会覆盖已经安装的官方 DSH Desktop，也不使用官方 ~/.dsh 会话目录。\n\n构建来源、兼容补丁和文件摘要见 desktop-host.json；许可证和第三方通知随包保留。\n`)
  const pluginDiff = execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: plugin })
  writeJson(join(out, 'desktop-host.json'), { schemaVersion: 1, product: 'dsh-amphoreus Desktop Host', unofficial: true, platform: 'win32', arch: 'x64', pluginVersion: pluginManifest.version, pluginCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: plugin, encoding: 'utf8' }).trim(), pluginDirty: execFileSync('git', ['status', '--porcelain'], { cwd: plugin, encoding: 'utf8' }).trim() !== '', pluginSourceDiffSha256: createHash('sha256').update(pluginDiff).digest('hex'), pluginHostSha256: hash(join(runtime, 'node_modules', 'dsh-amphoreus', 'lib', 'index.js')), pluginClientSha256: hash(join(runtime, 'node_modules', 'dsh-amphoreus', 'lib', 'client.js')), hostVersion: HOST_VERSION, sourceCommit: SOURCE_COMMIT, compatibilityPatchSha256: hash(join(plugin, 'compat', 'dsh-v0.2.1-rc.2-workspace-visibility.patch')), officialPayloadBuildCommit: officialManifest.dshBuildCommit, officialArchiveSha256: hash(archive), officialElectronSha256: hash(join(official, 'DeepSeek Harness.exe')), officialRuntimeVersions: json(join(official, 'resources', 'runtime', 'versions.json')), materializedSourcePackages: rebuilt, runtimeDescriptorSha256: hash(join(runtime, 'desktop-runtime.json')), autoUpdate: 'disabled-by-official-unpackaged-mode', ...(bundledAssets ? { bundledAssets, bundledAssetsManifestSha256: hash(join(out, 'bundled-assets.json')) } : {}) })
  console.log(`Desktop host kit ready: ${out}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1 })
