import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveAssets } from '../lib/derive.js'

const KINDS = ['covers', 'chronicle', 'cards', 'stickers', 'wallpapers', 'home']
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function contained(root, child) {
  const fold = value => process.platform === 'win32' ? value.toLowerCase() : value
  const base = fold(resolve(root))
  const target = fold(resolve(child))
  const rel = relative(base, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function parseArgs(argv) {
  const parsed = { force: false }
  const seen = new Set()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--force') {
      if (seen.has(arg)) throw new Error(`duplicate option: ${arg}`)
      seen.add(arg)
      parsed.force = true
      continue
    }
    if (!['--assets-root', '--data-dir', '--only', '--magick'].includes(arg)) throw new Error(`unknown option: ${arg}`)
    if (seen.has(arg)) throw new Error(`duplicate option: ${arg}`)
    seen.add(arg)
    const value = argv[index + 1]
    if (value === undefined || value === '' || value.startsWith('--')) throw new Error(`missing value for ${arg}`)
    index += 1
    if (arg === '--assets-root') parsed.assetsRoot = value
    else if (arg === '--data-dir') parsed.dataDir = value
    else if (arg === '--magick') parsed.magick = value
    else {
      const only = value.split(',').map(item => item.trim())
      if (only.length === 0 || only.some(item => !KINDS.includes(item))) throw new Error(`invalid --only value: ${value}`)
      parsed.only = [...new Set(only)]
    }
  }
  if (parsed.assetsRoot === undefined) throw new Error('--assets-root is required')
  return parsed
}

function displayPath(value) {
  return value.replaceAll('\\', '/')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const dataDir = resolve(args.dataDir ?? join(resolveDshHome(), 'amphoreus'))
  const cacheDir = join(dataDir, 'assets-cache')
  console.log(`data-dir: ${displayPath(dataDir)}`)
  if (args.dataDir === undefined && !process.env.DSH_HOME) {
    console.log(`DSH_HOME is not set in this shell; deriving into ${displayPath(dataDir)}. The running service may use a different dataDir — pass --data-dir explicitly.`)
  }
  if (contained(PACKAGE_ROOT, cacheDir)) throw new Error('dataDir must not place assets-cache inside the package directory')
  const result = await deriveAssets({
    assetsRoot: resolve(args.assetsRoot),
    cacheDir,
    force: args.force,
    ...(args.only === undefined ? {} : { only: args.only }),
    ...(args.magick === undefined ? {} : { magick: args.magick }),
    onProgress: progress => {
      const suffix = progress.error === undefined ? '' : ` ERROR ${progress.error}`
      console.log(`[${progress.kind} ${progress.done}/${progress.total}] ${progress.current}${suffix}`)
    },
  })
  console.log(`written=${result.written} skipped=${result.skipped} failed=${result.failed.length} elapsed=${result.finishedAt - result.startedAt}ms`)
  if (result.failed.length > 0) process.exitCode = 1
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
