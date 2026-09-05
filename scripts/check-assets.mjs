import { checkAssets, summarizeAssetsCheck } from '../src/host/assets-check.ts'

const rootArgument = process.argv[2]
if (typeof rootArgument !== 'string' || rootArgument.trim() === '') {
  console.error('Usage: node scripts/check-assets.mjs "<assetsRoot>"')
  process.exit(2)
}

try {
  const report = await checkAssets(rootArgument)
  for (const item of [...report.required, ...report.optional]) console.log(`${item.status}  ${item.path}`)
  for (const folder of report.home) {
    const status = folder.count < 0 ? 'optional-missing' : folder.count === 0 ? 'empty' : 'ok'
    console.log(`${status}  ${folder.path}/ (${Math.max(0, folder.count)} home wallpapers for ${folder.owner})`)
  }
  console.log(summarizeAssetsCheck(report))
  if (!report.ok) process.exitCode = 1
} catch (error) {
  console.error(`assets: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
