import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const MAX_IMAGE_BYTES = 64 * 1024 * 1024
const DEFAULT_VISUAL_PREFS = {
  wallpaperCursor: 0,
  backgroundMode: 'preset',
  magazineMode: 'full',
  grammar: { frostScale: 1, mascot: 'reactive', ambient: true },
  codeBackground: { enabled: true, intensity: 0.7, interactive: true },
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function portablePath(root, path) {
  if (typeof path !== 'string' || path === '' || isAbsolute(path) || path.includes('\\') || path.includes(':')
    || path.split('/').some(part => part === '' || part === '.' || part === '..')) throw new Error(`Invalid bundled asset path: ${String(path)}`)
  return join(root, ...path.split('/'))
}

function within(root, path) {
  const rel = relative(realpathSync(root), realpathSync(path))
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Bundled asset escapes its declared source directory.')
  return path
}

function imageBytes(path) {
  const info = statSync(path)
  if (!info.isFile() || info.size === 0 || info.size > MAX_IMAGE_BYTES) throw new Error(`Invalid bundled image size: ${path}`)
  const bytes = readFileSync(path)
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  const gif = /^GIF8[79]a$/u.test(bytes.toString('ascii', 0, 6))
  if (!png && !jpeg && !webp && !gif) throw new Error(`Unsupported bundled image bytes: ${path}`)
  return bytes
}

function writeAsset(source, sourceRoot, output, path, files) {
  const bytes = imageBytes(within(sourceRoot, source))
  const target = portablePath(output, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, bytes, { flag: 'wx' })
  files.push({ path, bytes: bytes.length, sha256: hash(bytes) })
}

export function validateBundledAssets(root) {
  const manifestPath = join(root, 'bundled-assets.json')
  if (!existsSync(manifestPath)) return undefined
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('Invalid bundled assets manifest.')
  const seen = new Set()
  for (const record of manifest.files) {
    if (seen.has(record.path)) throw new Error(`Duplicate bundled asset: ${record.path}`)
    seen.add(record.path)
    if (!record.path.startsWith('assets/') && !record.path.startsWith('assets-cache/') && record.path !== 'assets-preferences.json' && record.path !== 'ASSETS-NOTICE.txt') throw new Error(`Unexpected bundled asset: ${record.path}`)
    const path = portablePath(root, record.path)
    const bytes = readFileSync(within(root, path))
    if (bytes.length !== record.bytes || hash(bytes) !== record.sha256) throw new Error(`Bundled asset integrity mismatch: ${record.path}`)
  }
  if (!seen.has('assets-preferences.json')) throw new Error('Bundled assets omit their clean preference template.')
  return manifest
}

export async function bundleDesktopAssets(assetsRoot, cacheRoot, output) {
  if (!assetsRoot && !cacheRoot) return undefined
  if (!assetsRoot || !cacheRoot) throw new Error('Bundled artwork requires both the original assets root and derived cache.')
  assetsRoot = realpathSync(resolve(assetsRoot))
  cacheRoot = realpathSync(resolve(cacheRoot))
  output = resolve(output)
  for (const name of ['assets', 'assets-cache', 'assets-preferences.json', 'bundled-assets.json', 'ASSETS-NOTICE.txt']) {
    if (existsSync(join(output, name))) throw new Error(`Refusing to replace existing bundled asset output: ${name}`)
  }
  const { assetsInventory } = await import('../src/host/assets-check.ts')
  const { resolveGlobalWallpaperDir, MAX_HOME_WALLPAPERS } = await import('../src/host/derive.ts')
  const { HERO_VISUALS, GLOBAL_WALLPAPERS, CHIMERA_STICKERS } = await import('../src/shared/heroes.ts')
  const { GlobalSchema, INITIAL_GLOBAL } = await import('../src/host/store.ts')
  if (INITIAL_GLOBAL.dataVersion !== 1) throw new Error('The bundled preference template needs a schema update.')
  const inventory = assetsInventory(await resolveGlobalWallpaperDir(assetsRoot))
  const originals = [...inventory.required, ...inventory.optional].filter(item => !item.segments.at(-1).toLowerCase().endsWith('.zip'))
  const derived = []
  for (const hero of HERO_VISUALS) {
    for (const filename of ['cover-34.webp', 'cover-169.webp', 'card.webp', 'chronicle.webp', 'sticker.webp']) derived.push(`${hero.heroId}/${filename}`)
  }
  for (let index = 0; index < GLOBAL_WALLPAPERS.length; index += 1) derived.push(`_global/wallpaper-${index}.webp`)
  derived.push('_global/sticker-brand.webp')
  for (let index = 0; index < CHIMERA_STICKERS.length; index += 1) derived.push(`_global/sticker-chimera-${String(index + 1).padStart(2, '0')}.webp`)
  for (const owner of [...HERO_VISUALS.map(hero => hero.heroId), '_global']) {
    for (let index = 0; index < MAX_HOME_WALLPAPERS; index += 1) {
      const path = `${owner}/home-${String(index).padStart(2, '0')}.webp`
      if (existsSync(portablePath(cacheRoot, path))) derived.push(path)
    }
  }
  const files = []
  for (const item of originals) writeAsset(join(assetsRoot, ...item.segments), assetsRoot, output, `assets/${item.segments.join('/')}`, files)
  for (const path of derived) writeAsset(portablePath(cacheRoot, path), cacheRoot, output, `assets-cache/${path}`, files)
  const initial = GlobalSchema.parse({ ...structuredClone(INITIAL_GLOBAL), prefs: { ...structuredClone(INITIAL_GLOBAL.prefs), ...DEFAULT_VISUAL_PREFS } })
  const envelope = { unit: { name: 'amphoreus', version: 1 }, global: initial, tables: { seats: {}, bindings: {}, memory: {}, observations: {}, suite_events: {} } }
  const template = Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`)
  writeFileSync(join(output, 'assets-preferences.json'), template, { flag: 'wx' })
  files.push({ path: 'assets-preferences.json', bytes: template.length, sha256: hash(template) })
  const notice = Buffer.from('图片素材说明\n\n本桌面包中的图像来自用户提供的《崩坏：星穹铁道》相关本地素材，包括角色宣传图、壁纸、表情和 CHRYSOS 杂志封面裁切。派生 WebP 用于界面显示；不包含完整杂志压缩包、技能正文或用户会话数据。\n\n《崩坏：星穹铁道》相关名称与官方美术归其权利人所有，二创素材的权利归各自作者。现有素材资料未逐项确认全部作者及再分发许可证，因此不对这些图像声明 MIT 授权。项目的 MIT 代码许可证不扩展至随包图像。\n\n素材来自用户指定的本地资源；本文件不提供原图下载链接。bundled-assets.json 记录本包包含文件的相对路径、大小与 SHA-256，可用于核对交付内容。\n')
  writeFileSync(join(output, 'ASSETS-NOTICE.txt'), notice, { flag: 'wx' })
  files.push({ path: 'ASSETS-NOTICE.txt', bytes: notice.length, sha256: hash(notice) })
  const stats = { originals: originals.length, derived: derived.length, bytes: files.filter(file => file.path.startsWith('assets/') || file.path.startsWith('assets-cache/')).reduce((total, file) => total + file.bytes, 0) }
  const manifest = { schemaVersion: 1, ...stats, files: files.sort((left, right) => left.path.localeCompare(right.path, 'en')) }
  writeFileSync(join(output, 'bundled-assets.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  validateBundledAssets(output)
  return stats
}

function ensurePlainDirectory(root, parts) {
  mkdirSync(root, { recursive: true })
  let path = root
  for (const part of parts) {
    path = join(path, part)
    if (existsSync(path)) {
      if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw new Error(`Asset seeding needs a plain directory: ${path}`)
    } else mkdirSync(path)
  }
  return path
}

export function seedDesktopAssets(root, home) {
  const manifest = validateBundledAssets(root)
  if (!manifest) return undefined
  const cache = ensurePlainDirectory(home, ['amphoreus', 'assets-cache'])
  for (const record of manifest.files) {
    if (!record.path.startsWith('assets-cache/')) continue
    const parts = record.path.slice('assets-cache/'.length).split('/')
    const filename = parts.pop()
    const directory = ensurePlainDirectory(cache, parts)
    const target = join(directory, filename)
    try { copyFileSync(portablePath(root, record.path), target, constants.COPYFILE_EXCL) }
    catch (error) { if (error.code !== 'EEXIST') throw error }
  }
  const storage = ensurePlainDirectory(home, ['storages'])
  try { copyFileSync(join(root, 'assets-preferences.json'), join(storage, 'amphoreus.json'), constants.COPYFILE_EXCL) }
  catch (error) { if (error.code !== 'EEXIST') throw error }
  return resolve(root, 'assets')
}
