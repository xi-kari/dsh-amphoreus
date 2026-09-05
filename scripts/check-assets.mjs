import { readdir, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import {
  BRAND_STICKER,
  CHIMERA_STICKERS,
  GLOBAL_HOME_DIR,
  GLOBAL_WALLPAPER_DIRS,
  GLOBAL_WALLPAPERS,
  HERO_VISUALS,
  HOME_WALLPAPER_EXTENSIONS,
  HOME_WALLPAPER_ROOT,
  TRAILBLAZER_ASSETS,
} from '../src/shared/heroes.ts'

const rootArgument = process.argv[2]
if (typeof rootArgument !== 'string' || rootArgument.trim() === '') {
  console.error('Usage: node scripts/check-assets.mjs "<assetsRoot>"')
  process.exit(2)
}

const root = resolve(rootArgument)
const required = []
const optional = []

function item(directory, fileName) {
  return {
    path: join(directory, fileName),
    displayPath: join(directory, fileName).replaceAll('\\', '/'),
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

// The six global wallpapers may live under 13黄金裔壁纸/昔涟壁纸 (2026-09 batch) or the legacy flat 昔涟壁纸/.
let globalWallpaperDir = GLOBAL_WALLPAPER_DIRS[GLOBAL_WALLPAPER_DIRS.length - 1]
for (const candidate of GLOBAL_WALLPAPER_DIRS) {
  if (await isDirectory(join(root, ...candidate))) {
    globalWallpaperDir = candidate
    break
  }
}
for (const fileName of GLOBAL_WALLPAPERS) required.push(item(join(...globalWallpaperDir), fileName))

// Home-space wallpaper folders: optional, any file names; report how many images each holds.
const homeFolders = [
  ...HERO_VISUALS.map(hero => ({ owner: hero.heroId, folder: hero.assets.homeWallpaperDir })),
  { owner: '_global', folder: GLOBAL_HOME_DIR },
]
const homeReport = []
for (const { owner, folder } of homeFolders) {
  const directory = join(root, HOME_WALLPAPER_ROOT, folder)
  let count = 0
  try {
    count = (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && HOME_WALLPAPER_EXTENSIONS.includes(extname(entry.name).toLowerCase())).length
  } catch {
    count = -1
  }
  homeReport.push({ owner, displayPath: `${HOME_WALLPAPER_ROOT}/${folder}`, count })
}

for (const hero of HERO_VISUALS) {
  required.push(item('翁法罗斯英雄纪', hero.assets.chronicle))
  required.push(item('翁法罗斯如我所书卡牌', hero.assets.card))
  required.push(item('翁法罗斯日历', hero.assets.calendar))
  required.push(item('表情包', hero.assets.sticker))
  optional.push(item('黄金裔杂志_13册分册压缩包', hero.assets.magazineZip))
}

optional.push(item('表情包', BRAND_STICKER))
for (const fileName of CHIMERA_STICKERS) optional.push(item('表情包', fileName))
for (const trailblazer of Object.values(TRAILBLAZER_ASSETS)) {
  optional.push(item('翁法罗斯金卡（游戏截图）', trailblazer.goldCard))
  for (const fileName of trailblazer.stickers) optional.push(item('表情包', fileName))
}

async function inspect(entry, isRequired) {
  try {
    const value = await stat(join(root, entry.path))
    if (!value.isFile()) return { ...entry, status: isRequired ? 'missing' : 'optional-missing', present: false, large: false }
    const large = isRequired && value.size > 8 * 1024 * 1024
    return { ...entry, status: large ? 'large' : 'ok', present: true, large }
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return { ...entry, status: isRequired ? 'missing' : 'optional-missing', present: false, large: false }
    }
    throw error
  }
}

try {
  const requiredResults = await Promise.all(required.map(entry => inspect(entry, true)))
  const optionalResults = await Promise.all(optional.map(entry => inspect(entry, false)))
  for (const result of [...requiredResults, ...optionalResults]) {
    console.log(`${result.status}  ${result.displayPath}`)
  }
  for (const entry of homeReport) {
    console.log(`${entry.count < 0 ? 'optional-missing' : entry.count === 0 ? 'empty' : 'ok'}  ${entry.displayPath}/ (${Math.max(0, entry.count)} home wallpapers for ${entry.owner})`)
  }

  const requiredOk = requiredResults.filter(result => result.present).length
  const optionalOk = optionalResults.filter(result => result.present).length
  const large = requiredResults.filter(result => result.large).length
  const homeOk = homeReport.filter(entry => entry.count > 0).length
  console.log(`assets: required ${requiredOk}/${required.length} ok, optional ${optionalOk}/${optional.length} ok, large ${large}, home folders ${homeOk}/${homeReport.length} populated`)
  if (requiredOk !== required.length) process.exitCode = 1
} catch (error) {
  console.error(`assets: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
