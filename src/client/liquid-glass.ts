import type { GrammarLayer } from './grammar-layer.ts'
import { createGlassRefractionMap } from './glass-refraction-map.ts'
import { mountGlassFilterBank } from './visual-shell.ts'

type SurfaceKind = 'composer' | 'welcome' | 'controls'
interface Surface {
  readonly element: HTMLElement
  kind: SurfaceKind
  filter?: SVGFilterElement | undefined
  image?: SVGFEImageElement | undefined
  geometry?: string | undefined
  rect: DOMRect
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const MAX_FILTERS = 3
const MAX_DEVICE_PIXELS = 3_000_000
const VARIABLES = ['--amph-liquid-refraction', '--amph-light-x', '--amph-light-y', '--amph-light-active'] as const
const installations = new WeakMap<Document, () => void>()
let nextId = 0

function radiusFor(style: CSSStyleDeclaration, width: number, height: number): number {
  const limit = Math.min(width, height) / 2
  const values = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius]
  return Math.min(limit, Math.max(0, ...values.map(value => {
    const number = Number.parseFloat(value)
    return Number.isFinite(number) ? value.includes('%') ? number * Math.min(width, height) / 100 : number : 0
  })))
}

export function installLiquidGlass(grammar: Pick<GrammarLayer, 'getSnapshot' | 'subscribe'>): () => void {
  installations.get(document)?.()
  const prefix = `amph-liquid-${++nextId}-${Math.random().toString(36).slice(2, 9)}`
  const surfaces = new Map<HTMLElement, Surface>()
  const media = ['(prefers-reduced-motion: reduce)', '(prefers-reduced-transparency: reduce)', '(prefers-contrast: more)', '(forced-colors: active)']
    .map(query => window.matchMedia(query))
  const chromium = /(?:Chrome|Chromium|Edg)\/\d+/u.test(navigator.userAgent)
  const supports = chromium && typeof CSS !== 'undefined' && CSS.supports('backdrop-filter', 'url("#amph-liquid-probe")')
  let bank: SVGSVGElement | undefined
  let disposed = false
  let enabled = false
  let frame: number | undefined
  let resizeTimer: number | undefined
  let resizing = false
  let scanNeeded = false
  let pointer: { x: number; y: number } | undefined
  let filterCounter = 0

  const hidden = (): boolean => document.visibilityState === 'hidden'
  const interactive = (): boolean => enabled && !hidden() && grammar.getSnapshot().prefs.ambient && !media.some(query => query.matches)
  const removeFilter = (surface: Surface): void => {
    surface.element.style.removeProperty('--amph-liquid-refraction')
    surface.filter?.remove()
    surface.filter = undefined
    surface.image = undefined
    surface.geometry = undefined
  }
  const removeSurface = (surface: Surface): void => {
    for (const name of VARIABLES) surface.element.style.removeProperty(name)
    surface.element.removeAttribute('data-amph-liquid')
    surface.filter?.remove()
    resize.unobserve(surface.element)
    surfaces.delete(surface.element)
  }
  const clearLight = (): void => {
    pointer = undefined
    for (const surface of surfaces.values()) surface.element.style.setProperty('--amph-light-active', '0')
  }
  const cancelFrame = (): void => {
    if (frame !== undefined) window.cancelAnimationFrame(frame)
    frame = undefined
  }
  const clear = (): void => {
    cancelFrame()
    if (resizeTimer !== undefined) window.clearTimeout(resizeTimer)
    resizeTimer = undefined
    resizing = false
    pointer = undefined
    for (const surface of [...surfaces.values()]) removeSurface(surface)
    bank?.remove()
    bank = undefined
  }

  const filterFor = (surface: Surface, width: number, height: number, radius: number): void => {
    const key = `${Math.round(width / 4)}/${Math.round(height / 4)}/${Math.round(radius * 2)}`
    if (surface.geometry === key) return
    removeFilter(surface)
    surface.geometry = key
    try {
      const map = createGlassRefractionMap(width, height, radius, 16)
      const canvas = document.createElement('canvas')
      canvas.width = map.width
      canvas.height = map.height
      const context = canvas.getContext('2d')
      if (context === null) return
      const image = context.createImageData(map.width, map.height)
      image.data.set(map.pixels)
      context.putImageData(image, 0, 0)
      const url = canvas.toDataURL('image/png')
      canvas.width = canvas.height = 0
      const filter = document.createElementNS(SVG_NS, 'filter')
      const id = `${prefix}-${++filterCounter}`
      for (const [name, value] of Object.entries({ id, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', x: '0', y: '0', width: String(width), height: String(height), 'color-interpolation-filters': 'sRGB' })) filter.setAttribute(name, value)
      const input = document.createElementNS(SVG_NS, 'feImage')
      for (const [name, value] of Object.entries({ x: '0', y: '0', width: String(width), height: String(height), preserveAspectRatio: 'none', href: url, result: 'map' })) input.setAttribute(name, value)
      const balance = document.createElementNS(SVG_NS, 'feComponentTransfer')
      balance.setAttribute('in', 'map')
      balance.setAttribute('result', 'balanced')
      for (const channel of ['feFuncR', 'feFuncG']) {
        const transfer = document.createElementNS(SVG_NS, channel)
        transfer.setAttribute('type', 'linear')
        transfer.setAttribute('slope', '1')
        transfer.setAttribute('intercept', '-0.00196078431372549')
        balance.appendChild(transfer)
      }
      const displacement = document.createElementNS(SVG_NS, 'feDisplacementMap')
      for (const [name, value] of Object.entries({ in: 'SourceGraphic', in2: 'balanced', scale: '24', xChannelSelector: 'R', yChannelSelector: 'G' })) displacement.setAttribute(name, value)
      filter.append(input, balance, displacement)
      bank ??= mountGlassFilterBank(prefix)
      bank.appendChild(filter)
      surface.filter = filter
      surface.image = input
      surface.element.style.setProperty('--amph-liquid-refraction', `url("#${id}")`)
    } catch { /* Keep the ordinary glass recipe when rasterization is unavailable. */ }
  }

  const scan = (): void => {
    scanNeeded = false
    const found = new Map<HTMLElement, SurfaceKind>()
    const add = (selector: string, kind: SurfaceKind): void => {
      for (const element of document.querySelectorAll<HTMLElement>(selector)) if (!found.has(element)) found.set(element, kind)
    }
    const bars = [...document.querySelectorAll<HTMLElement>('[data-amph-inputbar]')]
    const composer = bars.find(element => element.querySelector('[data-amph-stats]') !== null && element.getClientRects().length > 0)
      ?? [...document.querySelectorAll<HTMLElement>('[data-amph-composer]')].find(element => element.getClientRects().length > 0)
    if (composer !== undefined) found.set(composer, 'composer')
    add('[data-content-phase="hero"] [class*="titleGroup"]', 'welcome')
    add('[data-content-phase="hero"] [class*="heroWorkspaceRow"]', 'controls')
    const measured: { element: HTMLElement; kind: SurfaceKind; rect: DOMRect; radius: number }[] = []
    for (const [element, kind] of found) {
      if (!element.isConnected || element.closest('[hidden]') !== null) continue
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      if (!Number.isFinite(rect.width * rect.height) || rect.width < 2 || rect.height < 2 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth || style.visibility === 'hidden' || style.display === 'none') continue
      measured.push({ element, kind, rect, radius: radiusFor(style, rect.width, rect.height) })
    }
    const retained = new Set(measured.map(item => item.element))
    for (const surface of [...surfaces.values()]) if (!retained.has(surface.element)) removeSurface(surface)
    const ratio = Number.isFinite(window.devicePixelRatio) ? Math.max(1, window.devicePixelRatio) : 1
    let pixels = 0, count = 0
    const snapshot = grammar.getSnapshot()
    const refract = supports && interactive() && (snapshot.wallpaperActive === true || snapshot.codeBackgroundActive === true)
    for (const item of measured) {
      let surface = surfaces.get(item.element)
      if (surface === undefined) {
        surface = { element: item.element, kind: item.kind, rect: item.rect }
        surfaces.set(item.element, surface)
        resize.observe(item.element)
        item.element.style.setProperty('--amph-light-active', '0')
      }
      surface.kind = item.kind
      surface.rect = item.rect
      if (item.element.getAttribute('data-amph-liquid') !== item.kind) item.element.setAttribute('data-amph-liquid', item.kind)
      const area = item.rect.width * item.rect.height * ratio * ratio
      const blocked = item.element.closest('[inert], [aria-hidden="true"]') !== null
      if (refract && !blocked && count < MAX_FILTERS && pixels + area <= MAX_DEVICE_PIXELS) {
        const width = Math.ceil(item.rect.width), height = Math.ceil(item.rect.height)
        for (const node of [surface.filter, surface.image]) {
          if (node === undefined) continue
          if (node.getAttribute('width') !== String(width)) node.setAttribute('width', String(width))
          if (node.getAttribute('height') !== String(height)) node.setAttribute('height', String(height))
        }
        if (!resizing || surface.filter === undefined) filterFor(surface, width, height, item.radius)
        if (surface.filter !== undefined) { count++; pixels += area }
      } else removeFilter(surface)
    }
    if (bank !== undefined && bank.childElementCount === 0) { bank.remove(); bank = undefined }
  }

  const flush = (): void => {
    frame = undefined
    if (disposed || !enabled || hidden()) return
    const scanned = scanNeeded
    if (scanned) scan()
    const point = interactive() ? pointer : undefined
    const measured = [...surfaces.values()].map(surface => ({ surface, rect: scanned ? surface.rect : surface.element.getBoundingClientRect() }))
    for (const { surface, rect } of measured) {
      const active = point !== undefined && surface.element.closest('[inert], [aria-hidden="true"]') === null
        && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
      if (active) {
        surface.element.style.setProperty('--amph-light-x', `${Math.round(point.x - rect.left)}px`)
        surface.element.style.setProperty('--amph-light-y', `${Math.round(point.y - rect.top)}px`)
      }
      surface.element.style.setProperty('--amph-light-active', active ? '1' : '0')
    }
  }
  const schedule = (scanTargets = false): void => {
    scanNeeded ||= scanTargets
    if (disposed || !enabled || hidden() || frame !== undefined) return
    frame = window.requestAnimationFrame(flush)
  }
  const resized = (): void => {
    if (disposed || !enabled || hidden()) return
    resizing = true
    if (resizeTimer !== undefined) window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      resizeTimer = undefined
      resizing = false
      schedule(true)
    }, 100)
    schedule(true)
  }
  const resize = new ResizeObserver(resized)
  const observer = new MutationObserver(records => {
    if (bank !== undefined && records.every(record => record.target === bank || bank!.contains(record.target))) return
    schedule(true)
  })
  const observe = (): void => observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['data-amph-inputbar', 'data-amph-composer', 'data-amph-stats', 'data-content-phase', 'data-amph-hero', 'hidden', 'aria-hidden'] })
  const sync = (): void => {
    if (disposed) return
    const next = grammar.getSnapshot().prefs.enabled
    if (!next) { enabled = false; observer.disconnect(); resize.disconnect(); clear(); return }
    if (!enabled) { enabled = true; observe() }
    if (!interactive()) clearLight()
    schedule(true)
  }
  const move = (event: PointerEvent): void => {
    if (!interactive()) return
    if (event.pointerType === 'touch') { clearLight(); return }
    pointer = { x: event.clientX, y: event.clientY }
    schedule()
  }
  const leave = (): void => { clearLight(); if (!scanNeeded) cancelFrame() }
  const visibility = (): void => {
    if (hidden()) clear()
    else sync()
  }
  const unsubscribe = grammar.subscribe(sync)
  document.addEventListener('pointermove', move, { passive: true })
  document.addEventListener('pointerleave', leave)
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('blur', leave)
  window.addEventListener('resize', resized, { passive: true })
  for (const query of media) query.addEventListener('change', sync)
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    enabled = false
    unsubscribe()
    observer.disconnect()
    resize.disconnect()
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerleave', leave)
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('blur', leave)
    window.removeEventListener('resize', resized)
    for (const query of media) query.removeEventListener('change', sync)
    clear()
    if (installations.get(document) === dispose) installations.delete(document)
  }
  installations.set(document, dispose)
  sync()
  return dispose
}
