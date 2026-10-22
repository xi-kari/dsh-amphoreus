import type { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { GLOBAL_WALLPAPERS } from '../shared/heroes.ts'
import { VISUAL_SHELL_HTML, WALLPAPER_SCRIPT, WALLPAPER_STYLE } from '../shared/visual-shell.ts'
import type { AmphoreusBoot, BackgroundMode, CustomWallpaperInfo, WorkbenchPublicConfig } from '../shared/api.ts'
import type { AmphoreusConfig } from './config.ts'
import type { SuiteSnapshot } from './suite/types.ts'

export interface FirstFrameOptions {
  readonly config: AmphoreusConfig
  readonly nonce: string
  readonly current: () => SuiteSnapshot | undefined
  readonly wallpaperIndex?: number
  readonly derivedWallpaper?: (index: number) => string | null
  /** Effective assets root (prefs override over config); defaults to config.assetsRoot. */
  readonly assetsRoot?: () => string
  readonly backgroundMode?: () => BackgroundMode
  readonly customWallpaper?: () => CustomWallpaperInfo | undefined
}

export function createBootPayload(options: FirstFrameOptions): AmphoreusBoot {
  const snapshot = options.current()
  const mode = options.backgroundMode?.() ?? 'none'
  const index = options.config.wallpaper.global === 'fixed'
    ? options.config.wallpaper.globalIndex
    : (options.wallpaperIndex ?? 0) % GLOBAL_WALLPAPERS.length
  const assetsConfigured = (options.assetsRoot?.() ?? options.config.assetsRoot).trim() !== ''
  const custom = mode === 'custom' ? options.customWallpaper?.() : undefined
  const customUrl = custom?.kind === 'image' ? custom.url : undefined
  const url = mode === 'preset'
    ? options.derivedWallpaper?.(index) ?? (assetsConfigured ? wallpaperUrl(index) : undefined)
    : mode === 'custom' ? customUrl : undefined
  const sidebarUrl = mode === 'preset'
    ? options.derivedWallpaper?.(options.config.wallpaper.sidebarIndex)
      ?? (assetsConfigured ? wallpaperUrl(options.config.wallpaper.sidebarIndex) : undefined)
    : mode === 'custom' ? customUrl : undefined
  return {
    revision: snapshot?.generation ?? 0,
    nonce: options.nonce,
    level: snapshot?.level ?? 'loading',
    workbench: publicWorkbench(options.config),
    wallpaper: {
      enabled: mode !== 'none',
      darkMask: options.config.wallpaper.darkMask,
      lightMask: options.config.wallpaper.lightMask,
      ...(url === undefined ? {} : { url }),
      ...(sidebarUrl === undefined ? {} : { sidebarUrl }),
    },
  }
}

function wallpaperUrl(index: number): string {
  return `/amphoreus/wallpaper/${encodeURIComponent(GLOBAL_WALLPAPERS[index]!)}`
}

export function createFirstFrameRows(options: FirstFrameOptions): IndexInjection[] {
  const boot = createBootPayload(options)
  const rows: IndexInjection[] = [{ kind: 'global', name: '__AMPHOREUS_BOOT__', value: boot }]
  if (!boot.wallpaper.enabled) return rows
  rows.push(
    { kind: 'style', text: WALLPAPER_STYLE },
    { kind: 'html', placement: 'body', html: VISUAL_SHELL_HTML },
    { kind: 'script', placement: 'body', text: WALLPAPER_SCRIPT },
  )
  return rows
}

export function registerFirstFrame(ctx: Context, options: FirstFrameOptions): () => void {
  return ctx.on('webserver/index-inject', table => {
    table.push(...createFirstFrameRows(options))
  })
}

export function publicWorkbench(config: AmphoreusConfig): WorkbenchPublicConfig {
  const { enabled, host, defaultView, cardTextLimit, autoProjection } = config.workbench
  return { enabled, host, defaultView, cardTextLimit, autoProjection }
}
