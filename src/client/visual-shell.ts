import type { AmphoreusClientModel } from './state.ts'
import type { AmphoreusBoot } from '../shared/api.ts'
import { heroVisualById } from '../shared/heroes.ts'
import { VISUAL_SHELL_NODES, WALLPAPER_SCRIPT, WALLPAPER_STYLE, type VisualShellNode } from '../shared/visual-shell.ts'
import { cssUrl } from './seat-wallpaper.ts'

const installations = new WeakMap<Document, () => void>()
const STYLE_ID = 'amphoreus-visual-shell-style'

export function mountCodeBackgroundSurface(className: string): HTMLElement {
  const surface = document.createElement('div')
  surface.id = 'amphoreus-code-background'
  surface.className = className
  surface.setAttribute('aria-hidden', 'true')
  document.body.appendChild(surface)
  return surface
}

export function mountGlassFilterBank(id: string): SVGSVGElement {
  const bank = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  bank.id = id
  bank.setAttribute('width', '0')
  bank.setAttribute('height', '0')
  bank.setAttribute('aria-hidden', 'true')
  bank.setAttribute('focusable', 'false')
  bank.style.cssText = 'position:fixed;pointer-events:none;overflow:hidden'
  document.body.appendChild(bank)
  return bank
}

function createNode(spec: VisualShellNode): HTMLElement {
  const node = document.createElement(spec.tag)
  for (const [name, value] of Object.entries(spec.attributes)) node.setAttribute(name, value)
  for (const child of spec.children ?? []) node.appendChild(createNode(child))
  return node
}

/** Adopt server-rendered visual resources, or install them on a page that enabled the plugin live. */
export function installVisualShell(model: Pick<AmphoreusClientModel, 'getSnapshot' | 'subscribe'>, currentSessionId: () => string | undefined): () => void {
  installations.get(document)?.()
  window.__AMPHOREUS_VISUAL_BOOT_DISPOSE__?.()
  delete window.__AMPHOREUS_VISUAL_BOOT_DISPOSE__
  let disposed = false
  const styles = [...document.querySelectorAll('style')].filter(node => node.id === STYLE_ID || node.textContent === WALLPAPER_STYLE)
  const style = styles.shift() ?? document.createElement('style')
  for (const duplicate of styles) duplicate.remove()
  style.id = STYLE_ID
  style.textContent = WALLPAPER_STYLE
  if (style.parentElement === null) document.head.appendChild(style)
  const nodes = VISUAL_SHELL_NODES.map(spec => {
    const selector = spec.attributes.id === undefined ? `[data-amph-fade="${spec.attributes['data-amph-fade']}"]` : `#${spec.attributes.id}`
    const matches = [...document.querySelectorAll<HTMLElement>(selector)]
    const node = matches.shift() ?? createNode(spec)
    for (const duplicate of matches) duplicate.remove()
    if (node.parentElement === null) document.body.appendChild(node)
    return node
  })
  const layer = nodes[0]!
  let remembered: string | null = null
  try { remembered = localStorage.getItem('dsh-amphoreus:last-seat')?.replace(/^seat:/u, '') ?? null } catch {}
  if (currentSessionId() === undefined && remembered !== null && remembered !== 'cyrene' && heroVisualById(remembered) !== undefined) {
    document.body.dataset.amphoreusSeat = remembered
  } else delete document.body.dataset.amphoreusSeat

  const bindSidebar = (): boolean => {
    const root = document.getElementById('root')
    if (root === null) return false
    for (const frame of root.querySelectorAll('div')) {
      if (!(frame instanceof HTMLElement) || frame.children.length < 3) continue
      const computed = getComputedStyle(frame)
      if (computed.display !== 'grid' || computed.gridTemplateColumns === 'none') continue
      const sidebar = frame.firstElementChild
      if (!(sidebar instanceof HTMLElement)) continue
      sidebar.dataset.amphoreusSidebarSurface = ''
      return true
    }
    return false
  }
  const observer = new MutationObserver(() => { if (!disposed && bindSidebar()) observer.disconnect() })
  if (!bindSidebar()) observer.observe(document.body, { childList: true, subtree: true })

  let appliedBoot: AmphoreusBoot | undefined
  const apply = (): void => {
    if (disposed) return
    const boot = model.getSnapshot().state?.visualBoot ?? window.__AMPHOREUS_BOOT__
    if (boot === appliedBoot && appliedBoot !== undefined) return
    appliedBoot = boot
    const enabled = boot?.wallpaper.enabled === true
    layer.hidden = !enabled
    document.body.dataset.amphoreusWallpaper = enabled ? 'on' : 'off'
    if (boot === undefined) return
    window.__AMPHOREUS_BOOT__ = boot
    document.body.style.setProperty('--amphoreus-sidebar-wallpaper-url', enabled && boot.wallpaper.sidebarUrl ? cssUrl(boot.wallpaper.sidebarUrl) : 'none')
    if (document.body.dataset.amphoreusSeat === undefined) {
      layer.style.setProperty('--amphoreus-wallpaper-url', enabled && boot.wallpaper.url ? cssUrl(boot.wallpaper.url) : 'none')
      document.body.style.setProperty('--amphoreus-dark-mask', String(boot.wallpaper.darkMask))
      document.body.style.setProperty('--amphoreus-light-mask', String(boot.wallpaper.lightMask))
    }
  }
  apply()
  const unsubscribe = model.subscribe(apply)
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    unsubscribe()
    observer.disconnect()
    window.__AMPHOREUS_VISUAL_BOOT_DISPOSE__?.()
    delete window.__AMPHOREUS_VISUAL_BOOT_DISPOSE__
    for (const node of nodes) node.remove()
    style.remove()
    for (const node of document.querySelectorAll('[data-amphoreus-sidebar-surface]')) node.removeAttribute('data-amphoreus-sidebar-surface')
    for (const name of [...document.body.style]) {
      if (name.startsWith('--amphoreus-') || name.startsWith('--amph-wp-')) document.body.style.removeProperty(name)
    }
    for (const name of ['amphoreusSeat', 'amphoreusWallpaper', 'amphoreusSuite']) delete document.body.dataset[name]
    for (const script of document.querySelectorAll('script')) {
      if (script.textContent === WALLPAPER_SCRIPT || script.textContent.startsWith('globalThis["__AMPHOREUS_BOOT__"] =')) script.remove()
    }
    delete window.__AMPHOREUS_BOOT__
    if (installations.get(document) === dispose) installations.delete(document)
  }
  installations.set(document, dispose)
  return dispose
}
