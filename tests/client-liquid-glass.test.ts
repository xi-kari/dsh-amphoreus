import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { ModuleKind, transpileModule } from 'typescript'
import { createGlassRefractionMap } from '../src/client/glass-refraction-map.ts'

function harness() {
  const callbacks = new Map<number, () => void>(), banks: Element[] = [], maps: unknown[] = [], observers: any[] = [], sizes: any[] = []
  const timers = new Map<number, () => void>()
  let nextFrame = 0
  class Target {
    events = new Map<string, Set<(event?: any) => void>>()
    addEventListener(name: string, callback: (event?: any) => void) { const listeners = this.events.get(name) ?? new Set(); listeners.add(callback); this.events.set(name, listeners) }
    removeEventListener(name: string, callback: (event?: any) => void) { this.events.get(name)?.delete(callback) }
    emit(name: string, event?: any) { for (const callback of [...this.events.get(name) ?? []]) callback(event) }
    get listeners() { return [...this.events.values()].reduce((sum, value) => sum + value.size, 0) }
  }
  class Element {
    attrs = new Map<string, string>(); children: Element[] = []; parent: Element | undefined
    styles = new Map<string, string>(); isConnected = true; hasStats = false
    writes: string[] = []
    computed = { display: 'block', visibility: 'visible', borderTopLeftRadius: '24px', borderTopRightRadius: '24px', borderBottomLeftRadius: '24px', borderBottomRightRadius: '24px' }
    rect = { x: 0, y: 0, left: 0, top: 0, right: 500, bottom: 200, width: 500, height: 200 }
    style = { setProperty: (name: string, value: string) => { this.writes.push(name); this.styles.set(name, value) }, removeProperty: (name: string) => { this.writes.push(name); this.styles.delete(name) } }
    setAttribute(name: string, value: string) { this.writes.push(name); this.attrs.set(name, value) }
    getAttribute(name: string) { return this.attrs.get(name) ?? null }
    removeAttribute(name: string) { this.writes.push(name); this.attrs.delete(name) }
    getClientRects() { return this.isConnected ? [this.rect] : [] }
    getBoundingClientRect() { return this.rect }
    querySelector(selector: string) { return selector === '[data-amph-stats]' && this.hasStats ? {} : null }
    blocked = false
    closest(selector: string) { return this.blocked && selector.includes('inert') ? this : null }
    appendChild(child: Element) { this.children.push(child); child.parent = this; return child }
    append(...children: Element[]) { children.forEach(child => this.appendChild(child)) }
    remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this) }
    contains(node: unknown): boolean { return node === this || this.children.some(child => child.contains(node)) }
    get childElementCount() { return this.children.length }
    geometry(width: number, height: number) { this.rect = { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height } }
  }
  const settings = new Element(), plugin = new Element(), bar = new Element(), card = new Element(), header = new Element(), sidebar = new Element(), body = new Element()
  const welcome = new Element(), controls = new Element()
  settings.geometry(800, 600); plugin.geometry(800, 650); bar.geometry(720, 160); card.geometry(720, 130); header.geometry(720, 64); sidebar.geometry(260, 980); bar.hasStats = true
  welcome.geometry(720, 100); controls.geometry(720, 64)
  const selectors = new Map([
    ['[data-amph-settings]', [settings]], ['[class*="centerCol"]:has(> [data-slot="main"] [data-plugin-panel])', [plugin]],
    ['[data-amph-inputbar]', [bar]], ['[data-amph-composer]', [card]], ['[data-amph-header]', [header]], ['[data-amph-sidebar]', [sidebar]],
    ['[data-content-phase="hero"] [class*="titleGroup"]', [welcome]], ['[data-content-phase="hero"] [class*="heroWorkspaceRow"]', [controls]],
  ])
  const document = Object.assign(new Target(), { visibilityState: 'visible', documentElement: new Element(), body,
    querySelectorAll: (selector: string) => selectors.get(selector) ?? [],
    createElementNS: () => new Element(),
    createElement: (tag: string) => { assert.equal(tag, 'canvas'); return { width: 0, height: 0,
      getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }), toDataURL: () => 'data:image/png;base64,AA==' } },
  })
  const media = Array.from({ length: 4 }, () => Object.assign(new Target(), { matches: false }))
  let mediaIndex = 0
  const window = Object.assign(new Target(), { innerWidth: 2400, innerHeight: 1800, devicePixelRatio: 1,
    matchMedia: () => media[(mediaIndex++) % 4],
    requestAnimationFrame: (callback: () => void) => { const id = ++nextFrame; callbacks.set(id, callback); return id },
    cancelAnimationFrame: (id: number) => callbacks.delete(id),
    setTimeout: (callback: () => void, delay: number) => { assert.equal(delay, 100); const id = ++nextFrame; timers.set(id, callback); return id },
    clearTimeout: (id: number) => timers.delete(id),
  })
  const navigator = { userAgent: 'Mozilla/5.0 Chrome/156.0.0.0' }
  const grammar = { prefs: { enabled: true, ambient: true }, wallpaperActive: true, codeBackgroundActive: false }, listeners = new Set<() => void>()
  const exports: Record<string, any> = {}
  const code = transpileModule(readFileSync(new URL('../src/client/liquid-glass.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(code, { exports, document, window, navigator, CSS: { supports: () => true }, getComputedStyle: (element: Element) => element.computed,
    ResizeObserver: class { callback: () => void; observed = new Set<Element>(); constructor(callback: () => void) { this.callback = callback; sizes.push(this) } observe(el: Element) { this.observed.add(el) } unobserve(el: Element) { this.observed.delete(el) } disconnect() { this.observed.clear() } },
    MutationObserver: class { callback: (records: any[]) => void; active = false; options: any; constructor(callback: (records: any[]) => void) { this.callback = callback; observers.push(this) } observe(_root: unknown, options: unknown) { this.options = options; this.active = true } disconnect() { this.active = false } },
    require: (name: string) => {
      if (name.endsWith('glass-refraction-map.ts')) return { createGlassRefractionMap: (...args: Parameters<typeof createGlassRefractionMap>) => { maps.push(args); return createGlassRefractionMap(...args) } }
      if (name.endsWith('visual-shell.ts')) return { mountGlassFilterBank: (id: string) => { const bank = new Element(); bank.setAttribute('id', id); body.appendChild(bank); banks.push(bank); return bank } }
      throw new Error(name)
    },
  })
  const all = [bar, card, welcome, controls, settings, plugin, header, sidebar]
  const install = () => exports.installLiquidGlass({ getSnapshot: () => grammar, subscribe: (callback: () => void) => { listeners.add(callback); return () => listeners.delete(callback) } })
  const flush = () => { const current = [...callbacks.values()]; callbacks.clear(); current.forEach(callback => callback()) }
  const emit = () => listeners.forEach(callback => callback())
  return { install, flush, emit, all, settings, plugin, bar, card, welcome, controls, header, sidebar, selectors, maps, banks, callbacks, timers, document, window, grammar, media, observers, sizes, listeners, navigator,
    runTimers: () => { const current = [...timers.values()]; timers.clear(); current.forEach(callback => callback()) },
    mutate: () => observers.at(-1).callback([{ target: body }]),
    trueSurfaces: () => all.filter(el => el.styles.has('--amph-liquid-refraction')),
  }
}

test('liquid surfaces prioritize one composer carrier, include welcome and controls, and enforce physical-pixel and count budgets', () => {
  const h = harness(), dispose = h.install(); h.flush()
  assert.deepEqual(h.trueSurfaces(), [h.bar, h.welcome, h.controls])
  assert.equal(h.bar.attrs.get('data-amph-liquid'), 'composer')
  assert.equal(h.card.attrs.has('data-amph-liquid'), false)
  assert.equal(h.welcome.attrs.get('data-amph-liquid'), 'welcome')
  assert.equal(h.controls.attrs.get('data-amph-liquid'), 'controls')
  assert.equal(h.maps.length, 3)
  h.window.devicePixelRatio = 2; h.welcome.geometry(1000, 700); h.window.emit('resize'); h.flush()
  assert.deepEqual(h.trueSurfaces(), [h.bar, h.controls])
  assert.ok(h.trueSurfaces().reduce((sum, el) => sum + el.rect.width * el.rect.height * 4, 0) <= 3_000_000)
  h.bar.hasStats = false; h.mutate(); h.flush()
  assert.equal(h.bar.attrs.has('data-amph-liquid'), false)
  assert.equal(h.card.attrs.get('data-amph-liquid'), 'composer')
  dispose()
})

test('resize and route changes reuse unchanged maps, rebuild changed radii, and retract departed surfaces without changing their children', () => {
  const h = harness(), dispose = h.install(); h.flush()
  const children = h.welcome.children.slice(), first = h.maps.length
  h.sizes[0].callback(); h.mutate(); assert.equal(h.callbacks.size, 1); h.flush()
  assert.equal(h.maps.length, first)
  h.runTimers(); h.flush()
  h.welcome.computed.borderTopLeftRadius = '36px'; h.emit(); h.flush()
  assert.equal(h.maps.length, first + 1)
  h.selectors.set('[data-content-phase="hero"] [class*="titleGroup"]', [])
  h.selectors.set('[data-content-phase="hero"] [class*="heroWorkspaceRow"]', []); h.mutate(); h.flush()
  assert.equal(h.welcome.attrs.has('data-amph-liquid'), false)
  assert.equal(h.welcome.styles.size, 0)
  assert.equal(h.controls.attrs.has('data-amph-liquid'), false)
  assert.equal(h.controls.styles.size, 0)
  assert.deepEqual(h.welcome.children, children)
  assert.deepEqual(h.trueSurfaces(), [h.bar])
  assert.equal(h.observers[0].options.attributeFilter.includes('style'), false)
  assert.equal(h.observers[0].options.attributeFilter.includes('data-amph-liquid'), false)
  for (const name of ['data-content-phase', 'data-amph-hero']) assert.ok(h.observers[0].options.attributeFilter.includes(name))
  for (const name of ['data-amph-sidebar', 'data-amph-header', 'data-amph-settings', 'data-plugin-panel', 'data-slot']) assert.equal(h.observers[0].options.attributeFilter.includes(name), false)
  dispose()
})

test('pointer updates use one cancellable frame and hidden, reduced motion, contrast and ambient-off states stop activity', () => {
  const h = harness(), dispose = h.install(); h.flush()
  h.document.emit('pointermove', { clientX: 70, clientY: 80, pointerType: 'mouse' })
  h.document.emit('pointermove', { clientX: 90, clientY: 100, pointerType: 'mouse' })
  assert.equal(h.callbacks.size, 1); h.flush(); assert.equal(h.callbacks.size, 0)
  assert.equal(h.bar.styles.get('--amph-light-x'), '90px')
  assert.equal(h.bar.styles.get('--amph-light-active'), '1')
  h.document.emit('pointermove', { clientX: 1, clientY: 1 }); h.document.visibilityState = 'hidden'; h.document.emit('visibilitychange')
  assert.equal(h.callbacks.size, 0); assert.equal(h.trueSurfaces().length, 0)
  assert.equal(h.timers.size, 0)
  h.document.emit('pointermove', { clientX: 1, clientY: 1 }); assert.equal(h.callbacks.size, 0)
  h.document.visibilityState = 'visible'; h.document.emit('visibilitychange'); h.flush(); assert.equal(h.trueSurfaces().length, 3)
  for (const media of h.media) {
    media.matches = true; media.emit('change'); h.flush(); assert.equal(h.trueSurfaces().length, 0)
    h.document.emit('pointermove', { clientX: 1, clientY: 1 }); assert.equal(h.callbacks.size, 0)
    media.matches = false; media.emit('change'); h.flush()
  }
  h.grammar.prefs.ambient = false; h.emit(); h.flush(); assert.equal(h.trueSurfaces().length, 0)
  dispose()
})

test('grammar disable, pending-frame disposal and repeated installation leave no variables, definitions or listeners behind', () => {
  const h = harness(), first = h.install(); const stale = [...h.callbacks.values()][0]!
  first(); stale(); assert.equal(h.banks.length, 0); assert.equal(h.callbacks.size, 0)
  const second = h.install(); h.flush(); const oldBank = h.banks.at(-1)!
  const third = h.install(); h.flush(); second()
  assert.equal(oldBank.isConnected, false)
  assert.equal(h.banks.filter(bank => bank.isConnected).length, 1)
  h.grammar.prefs.enabled = false; h.emit()
  assert.ok(h.all.every(el => el.styles.size === 0 && !el.attrs.has('data-amph-liquid')))
  assert.equal(h.banks.filter(bank => bank.isConnected).length, 0)
  assert.equal(h.callbacks.size, 0)
  h.grammar.prefs.enabled = true; h.emit(); h.flush(); assert.equal(h.trueSurfaces().length, 3)
  third()
  assert.equal(h.listeners.size, 0)
  assert.equal(h.document.listeners + h.window.listeners + h.media.reduce((sum, item) => sum + item.listeners, 0), 0)
  assert.ok(h.sizes.every(observer => observer.observed.size === 0))
  assert.ok(h.observers.every(observer => !observer.active))
  assert.equal(h.banks.filter(bank => bank.isConnected).length, 0)
})

test('unverified browser engines keep ordinary glass without allocating SVG displacement resources', () => {
  const h = harness(); h.navigator.userAgent = 'Mozilla/5.0 Version/26.0 Safari/605.1.15'
  const dispose = h.install(); h.flush()
  assert.equal(h.trueSurfaces().length, 0)
  assert.equal(h.maps.length, 0)
  assert.equal(h.welcome.attrs.get('data-amph-liquid'), 'welcome')
  dispose()
})

test('modal-inert background panes retain their material and geometry without active optics or pointer work', () => {
  const h = harness(), dispose = h.install(); h.flush()
  h.welcome.blocked = true; h.controls.blocked = true; h.mutate(); h.flush()
  assert.equal(h.welcome.attrs.get('data-amph-liquid'), 'welcome')
  assert.equal(h.controls.attrs.get('data-amph-liquid'), 'controls')
  assert.equal(h.welcome.styles.has('--amph-liquid-refraction'), false)
  h.document.emit('pointermove', { clientX: 70, clientY: 80 }); h.flush()
  assert.equal(h.welcome.styles.get('--amph-light-active'), '0')
  assert.equal(h.bar.styles.get('--amph-light-active'), '1')
  h.welcome.blocked = false; h.mutate(); h.flush()
  assert.equal(h.welcome.styles.has('--amph-liquid-refraction'), true)
  dispose()
})

test('an opaque scene without wallpaper or code keeps the shell without useless refraction maps', () => {
  const h = harness(); h.grammar.wallpaperActive = false
  const dispose = h.install(); h.flush()
  assert.equal(h.maps.length, 0)
  assert.equal(h.bar.attrs.get('data-amph-liquid'), 'composer')
  h.grammar.codeBackgroundActive = true; h.emit(); h.flush()
  assert.equal(h.trueSurfaces().length, 3)
  h.grammar.codeBackgroundActive = false; h.emit(); h.flush()
  assert.equal(h.trueSurfaces().length, 0)
  dispose()
})

test('continuous resize stretches existing filter bounds and defers map generation until its quiet period', () => {
  const h = harness(), dispose = h.install(); h.flush()
  const count = h.maps.length
  for (let width = 810; width < 910; width += 10) {
    h.welcome.geometry(width, 100)
    h.sizes[0].callback(); h.flush()
    assert.equal(h.maps.length, count)
    assert.equal(h.timers.size, 1)
  }
  h.runTimers(); h.flush()
  assert.equal(h.maps.length, count + 1)
  h.welcome.geometry(902, 100); h.sizes[0].callback(); h.flush()
  assert.equal(h.timers.size, 1)
  h.document.visibilityState = 'hidden'; h.document.emit('visibilitychange')
  assert.equal(h.timers.size, 0)
  assert.equal(h.callbacks.size, 0)
  h.document.visibilityState = 'visible'; h.document.emit('visibilitychange'); h.flush()
  assert.equal(h.trueSurfaces().length, 3)
  h.sizes[0].callback(); dispose()
  assert.equal(h.timers.size, 0)
  h.runTimers(); h.flush()
  assert.equal(h.banks.filter(bank => bank.isConnected).length, 0)
})

test('sidebar, header, settings and plugin panes receive no attributes, styles or resize observation across lifecycle changes', () => {
  const h = harness(), dispose = h.install(); h.flush()
  const excluded = [h.sidebar, h.header, h.settings, h.plugin]
  const untouched = () => {
    for (const element of excluded) {
      assert.equal(element.attrs.has('data-amph-liquid'), false)
      assert.equal(element.styles.size, 0)
      assert.deepEqual(element.writes, [])
      assert.ok(h.sizes.every(observer => !observer.observed.has(element)))
    }
  }
  untouched()
  h.document.emit('pointermove', { clientX: 70, clientY: 80 }); h.flush(); untouched()
  h.mutate(); h.flush(); untouched()
  h.grammar.prefs.enabled = false; h.emit(); untouched()
  h.grammar.prefs.enabled = true; h.emit(); h.flush(); untouched()
  dispose(); untouched()
})
