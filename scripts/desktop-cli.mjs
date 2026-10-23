import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { desktopLaunchConfiguration, prepareDesktopProfile } from './desktop-launch.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const configuration = desktopLaunchConfiguration(root)
prepareDesktopProfile(configuration)
process.env.DSH_HOME = configuration.home
if (configuration.env.DSH_AMPHOREUS_ASSETS_ROOT) process.env.DSH_AMPHOREUS_ASSETS_ROOT = configuration.env.DSH_AMPHOREUS_ASSETS_ROOT
const runtime = join(root, 'app', 'dsh')
const { runDesktopCli } = await import(pathToFileURL(join(runtime, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')))
await runDesktopCli(runtime, join(root, 'runtime'))
