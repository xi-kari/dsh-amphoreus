import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { AmphoreusClientModel } from './state.ts'

const LIGHT_BASE = [244, 242, 248] as const
const DARK_BASE = [26, 22, 49] as const

export function globalThemeTokens(lightAlpha = 0.22, darkAlpha = 0.4): ThemeTokenOverrides {
  const surface = { light: rgba(LIGHT_BASE, lightAlpha), dark: rgba(DARK_BASE, darkAlpha) }
  return {
    '--dsw-alias-bg-base': surface,
    '--dsw-specific-sidebar-fill': { light: rgba(LIGHT_BASE, lightAlpha - 0.12), dark: rgba(DARK_BASE, darkAlpha - 0.12) },
    '--dsw-alias-bg-layer-1': { light: 'rgba(250, 249, 252, 0.76)', dark: 'rgba(35, 30, 63, 0.78)' },
    '--dsw-alias-bg-layer-2': { light: 'rgba(247, 245, 250, 0.86)', dark: 'rgba(43, 37, 74, 0.86)' },
    '--dsw-alias-bg-layer-3': { light: 'rgba(253, 252, 254, 0.94)', dark: 'rgba(51, 44, 84, 0.94)' },
    '--dsw-alias-border-l1': { light: 'rgba(138, 104, 28, 0.12)', dark: 'rgba(208, 177, 102, 0.14)' },
    '--dsw-alias-border-l2': { light: 'rgba(138, 104, 28, 0.24)', dark: 'rgba(208, 177, 102, 0.25)' },
    '--dsw-alias-border-l3': { light: 'rgba(138, 104, 28, 0.4)', dark: 'rgba(208, 177, 102, 0.38)' },
    '--dsw-alias-brand-primary': { light: 'rgb(138, 104, 28)', dark: 'rgb(208, 177, 102)' },
    '--dsw-alias-brand-primary-invert': { light: 'rgb(250, 248, 242)', dark: 'rgb(26, 22, 49)' },
    '--dsw-alias-brand-text': { light: 'rgb(55, 48, 94)', dark: 'rgb(244, 242, 248)' },
    '--dsw-alias-label-primary': { light: 'rgb(55, 48, 94)', dark: 'rgb(244, 242, 248)' },
    '--dsw-alias-label-secondary': { light: 'rgb(83, 75, 119)', dark: 'rgb(213, 207, 226)' },
    '--dsw-alias-label-tertiary': { light: 'rgb(111, 103, 143)', dark: 'rgb(178, 169, 201)' },
    '--dsw-alias-label-caption': { light: 'rgb(126, 117, 154)', dark: 'rgb(154, 145, 179)' },
    '--dsw-alias-button-primary-fill': { light: 'rgb(55, 48, 94)', dark: 'rgb(104, 91, 154)' },
    '--dsw-alias-button-primary-hover': { light: 'rgb(43, 37, 77)', dark: 'rgb(122, 107, 177)' },
    '--dsw-alias-button-primary-dimmed': { light: 'rgba(55, 48, 94, 0.16)', dark: 'rgba(244, 242, 248, 0.16)' },
    '--dsw-alias-button-elevated-fill': { light: 'rgba(253, 252, 254, 0.86)', dark: 'rgba(48, 41, 79, 0.88)' },
    '--dsw-alias-button-floating-fill': { light: 'rgba(253, 252, 254, 0.9)', dark: 'rgba(43, 37, 73, 0.9)' },
    '--dsw-alias-button-floating-hover': { light: 'rgba(244, 242, 248, 0.94)', dark: 'rgba(61, 52, 96, 0.94)' },
    '--dsw-alias-interactive-bg-hover': { light: 'rgba(55, 48, 94, 0.07)', dark: 'rgba(244, 242, 248, 0.09)' },
    '--dsw-alias-interactive-bg-active': { light: 'rgba(138, 104, 28, 0.13)', dark: 'rgba(208, 177, 102, 0.15)' },
    '--dsw-alias-interactive-bg-hover-accent': { light: 'rgba(138, 104, 28, 0.17)', dark: 'rgba(208, 177, 102, 0.2)' },
    '--dsw-specific-sidebar-nav-item-active': { light: 'rgba(138, 104, 28, 0.13)', dark: 'rgba(208, 177, 102, 0.15)' },
    '--dsw-specific-sidebar-nav-item-active-accent': { light: 'rgba(138, 104, 28, 0.22)', dark: 'rgba(208, 177, 102, 0.22)' },
    '--dsw-specific-sidebar-nav-item-hover': { light: 'rgba(55, 48, 94, 0.07)', dark: 'rgba(244, 242, 248, 0.09)' },
    '--dsw-specific-input-major': { light: 'rgba(253, 252, 254, 0.84)', dark: 'rgba(43, 37, 73, 0.86)' },
    '--dsw-specific-bubble': { light: 'rgba(244, 242, 248, 0.8)', dark: 'rgba(48, 41, 79, 0.84)' },
    '--dsw-specific-bubble-highlight': { light: 'rgba(235, 229, 241, 0.9)', dark: 'rgba(65, 55, 101, 0.9)' },
    '--dsw-specific-menu': { light: 'rgba(253, 252, 254, 0.95)', dark: 'rgba(51, 44, 84, 0.96)' },
    '--dsw-specific-selector': { light: 'rgba(239, 235, 244, 0.9)', dark: 'rgba(58, 49, 92, 0.92)' },
    '--dsw-specific-tip': { light: 'rgba(246, 243, 249, 0.92)', dark: 'rgba(50, 43, 82, 0.94)' },
  }
}

export function registerGlobalTheme(ctx: ClientContext, model: AmphoreusClientModel): () => void {
  let currentAlpha = ''
  let disposeLayer = () => {}
  const apply = (): void => {
    const wallpaper = model.getSnapshot().state?.effectiveConfig.wallpaper
    const light = wallpaper?.surfaceAlpha.light ?? 0.22
    const dark = wallpaper?.surfaceAlpha.dark ?? 0.4
    const key = `${light}/${dark}`
    if (key !== currentAlpha) {
      currentAlpha = key
      disposeLayer()
      disposeLayer = ctx.theme.overrideTokens('dsh-amphoreus/global', globalThemeTokens(light, dark))
    }
    const state = model.getSnapshot().state
    const layer = document.getElementById('amphoreus-wallpaper')
    if (layer instanceof HTMLElement && state !== undefined) {
      layer.hidden = !state.effectiveConfig.wallpaper.enabled
      layer.dataset.revision = String(state.revision)
    }
    if (state !== undefined) document.body.dataset.amphoreusWallpaper = state.effectiveConfig.wallpaper.enabled ? 'on' : 'off'
    if (state?.suite !== undefined) document.body.dataset.amphoreusSuite = state.suite.level
  }
  apply()
  const unsubscribe = model.subscribe(apply)
  return () => {
    unsubscribe()
    disposeLayer()
    delete document.body.dataset.amphoreusSuite
    delete document.body.dataset.amphoreusWallpaper
  }
}

function rgba(rgb: readonly [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, alpha))})`
}
