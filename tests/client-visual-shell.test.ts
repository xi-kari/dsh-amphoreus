import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { installVisualShell } from '../src/client/visual-shell.ts'
import { createFirstFrameRows } from '../src/host/firstframe.ts'
import { fixtureConfig } from './fixture-suite.ts'
import type { AmphoreusBoot } from '../src/shared/api.ts'

class Style {
  values = new Map<string, string>()
  setProperty(name: string, value: string) { this.values.set(name, value) }
  getPropertyValue(name: string) { return this.values.get(name) ?? '' }
  removeProperty(name: string) { const value = this.getPropertyValue(name); this.values.delete(name); return value }
  [Symbol.iterator]() { return this.values.keys() }
}
class Element {
  attributes = new Map<string, string>()
  children: Element[] = []
  parentElement: Element | null = null
  style = new Style()
  hidden = false
  textContent = ''
  grid = false
  readonly tagName: string
  constructor(tagName: string) { this.tagName = tagName }
  get id() { return this.getAttribute('id') ?? '' }
  set id(value: string) { this.setAttribute('id', value) }
  get firstElementChild() { return this.children[0] ?? null }
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  getAttribute(name: string) { return this.attributes.get(name) ?? null }
  removeAttribute(name: string) { this.attributes.delete(name) }
  dataset = new Proxy({} as Record<string, string>, {
    get: (_target, key: string) => this.getAttribute(`data-${key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}`) ?? undefined,
    set: (_target, key: string, value: string) => { this.setAttribute(`data-${key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}`, value); return true },
    deleteProperty: (_target, key: string) => { this.removeAttribute(`data-${key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}`); return true },
  })
  appendChild(node: Element) { node.remove(); this.children.push(node); node.parentElement = this; return node }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null }
  matches(selector: string): boolean {
    if (selector.startsWith('#')) return this.id === selector.slice(1)
    const attr = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector)
    if (attr) return attr[2] === undefined ? this.attributes.has(attr[1]!) : this.getAttribute(attr[1]!) === attr[2]
    return this.tagName.toLowerCase() === selector.toLowerCase()
  }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap(node => [...(selector.split(',').some(part => node.matches(part.trim())) ? [node] : []), ...node.querySelectorAll(selector)])
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null }
}
function environment(initialFrame: boolean, current: string | undefined = undefined, rootPresent = true) {
  const saved = new Map(['document', 'window', 'HTMLElement', 'MutationObserver', 'getComputedStyle', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const html = new Element('html'), head = html.appendChild(new Element('head')), body = html.appendChild(new Element('body'))
  const root = body.appendChild(new Element('div')); root.id = 'root'
  const grid = root.appendChild(new Element('div')); grid.grid = true
  const sidebar = grid.appendChild(new Element('div')); grid.appendChild(new Element('div')); grid.appendChild(new Element('div'))
  if (!rootPresent) root.remove()
  const document = { body, head, documentElement: html, createElement: (tag: string) => new Element(tag), getElementById: (id: string) => html.querySelector(`#${id}`), querySelectorAll: (selector: string) => html.querySelectorAll(selector) }
  const observers: Array<{ active: boolean; callback: () => void }> = []
  class Observer {
    record: { active: boolean; callback: () => void }
    constructor(callback: () => void) { this.record = { active: false, callback }; observers.push(this.record) }
    observe() { this.record.active = true }
    disconnect() { this.record.active = false }
  }
  const frames = new Map<number, () => void>()
  const window: Record<string, any> = { requestAnimationFrame: (fn: () => void) => { frames.set(frames.size + 1, fn); return frames.size }, cancelAnimationFrame: (id: number) => frames.delete(id) }
  const storage = new Map([['dsh-amphoreus:last-seat', 'anaxa']])
  const localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) }
  const getComputedStyle = (node: Element) => ({ display: node.grid ? 'grid' : 'block', gridTemplateColumns: node.grid ? '260px 1fr 0px' : 'none' })
  for (const [key, value] of Object.entries({ document, window, HTMLElement: Element, MutationObserver: Observer, getComputedStyle, localStorage })) Object.defineProperty(globalThis, key, { configurable: true, value })
  const config = fixtureConfig()
  config.wallpaper.enabled = true; config.wallpaper.global = 'fixed'; config.wallpaper.globalIndex = 2; config.wallpaper.sidebarIndex = 4
  if (initialFrame) {
    for (const row of createFirstFrameRows({ config, nonce: 'old-fixture', current: () => undefined, backgroundMode: () => 'preset' })) {
      if (row.kind === 'global') window[row.name] = row.value
      if (row.kind === 'style') { const style = head.appendChild(new Element('style')); style.textContent = row.text }
      if (row.kind === 'html') {
        const stack = [body]
        for (const tag of row.html.matchAll(/<(\/)?([a-z]+)([^>]*)>/g)) {
          if (tag[1]) { stack.pop(); continue }
          const node = stack.at(-1)!.appendChild(new Element(tag[2]!))
          for (const attr of tag[3]!.matchAll(/([\w-]+)="([^"]*)"/g)) node.setAttribute(attr[1]!, attr[2]!)
          stack.push(node)
        }
      }
      if (row.kind === 'script') vm.runInNewContext(row.text, { globalThis: window, document, localStorage, HTMLElement: Element, getComputedStyle, MutationObserver: Observer, requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame })
    }
  }
  const listeners = new Set<() => void>()
  const state = { revision: 7, nonce: 'fresh-fixture', suite: { level: 'L0' }, assets: { derived: ['_global/wallpaper-2.webp', '_global/wallpaper-4.webp'] }, effectiveConfig: { wallpaper: config.wallpaper, workbench: config.workbench, assetsConfigured: false },
    visualBoot: { revision: 7, nonce: 'fresh-fixture', level: 'L0', workbench: config.workbench,
      wallpaper: { enabled: true, url: '/amphoreus/derived/_global/wallpaper-2.webp', sidebarUrl: '/amphoreus/derived/_global/wallpaper-4.webp', darkMask: .18, lightMask: .03 } },
  }
  let ready = true
  const model = { getSnapshot: () => ({ phase: ready ? 'ready' : 'loading', refreshing: false, state: ready ? state : undefined }), subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) } }
  const foreign = head.appendChild(new Element('style')); foreign.textContent = 'body { color: red; }'
  body.style.setProperty('color', 'red')
  return { document, body, sidebar, window, storage, listeners, observers, frames, foreign,
    install: () => installVisualShell(model as never, () => current),
    boot: (): AmphoreusBoot => state.visualBoot as AmphoreusBoot,
    publish: (boot: AmphoreusBoot | undefined) => {
      ready = boot !== undefined
      if (boot !== undefined) Object.assign(state, { visualBoot: boot })
      for (const listener of listeners) listener()
    },
    restore: () => { for (const [key, value] of saved) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key) } },
  }
}

for (const firstFrame of [false, true]) test(`visual shell installs and releases owned resources with first frame=${firstFrame}`, () => {
  const fixture = environment(firstFrame)
  const initialLayer = fixture.document.getElementById('amphoreus-wallpaper')
  let dispose = () => {}
  try {
    for (let cycle = 0; cycle < 3; cycle++) {
      dispose = fixture.install()
      const layer = fixture.document.getElementById('amphoreus-wallpaper')
      assert.ok(layer)
      if (cycle === 0 && firstFrame) assert.equal(layer, initialLayer)
      assert.equal(fixture.document.querySelectorAll('#amphoreus-wallpaper').length, 1)
      assert.equal(fixture.document.querySelectorAll('[data-amph-fade]').length, 2)
      assert.equal(fixture.document.querySelectorAll('style').length, 2)
      assert.equal(fixture.sidebar.dataset.amphoreusSidebarSurface, '')
      assert.equal(fixture.body.dataset.amphoreusSeat, 'anaxa')
      assert.equal(fixture.window.__AMPHOREUS_BOOT__.nonce, 'fresh-fixture')
      assert.equal(fixture.window.__AMPHOREUS_BOOT__.wallpaper.url, '/amphoreus/derived/_global/wallpaper-2.webp')
      dispose(); dispose()
      assert.equal(fixture.document.getElementById('amphoreus-wallpaper'), null)
      assert.equal(fixture.document.querySelectorAll('[data-amph-fade]').length, 0)
      assert.deepEqual(fixture.document.querySelectorAll('style'), [fixture.foreign])
      assert.equal(fixture.sidebar.dataset.amphoreusSidebarSurface, undefined)
      assert.equal(fixture.body.dataset.amphoreusSeat, undefined)
      assert.equal([...fixture.body.style].some(name => name.startsWith('--amph')), false)
      assert.equal(fixture.body.style.getPropertyValue('color'), 'red')
      assert.equal(fixture.window.__AMPHOREUS_BOOT__, undefined)
      assert.equal(fixture.listeners.size, 0)
      assert.equal(fixture.observers.filter(observer => observer.active).length, 0)
      assert.equal(fixture.frames.size, 0)
      assert.equal(fixture.storage.get('dsh-amphoreus:last-seat'), 'anaxa')
    }
  } finally { dispose(); fixture.restore() }
})

test('an ordinary selected session does not adopt another remembered role', () => {
  const fixture = environment(true, 'ordinary-session')
  let dispose = () => {}
  try {
    dispose = fixture.install()
    assert.equal(fixture.body.dataset.amphoreusSeat, undefined)
  } finally { dispose(); fixture.restore() }
})

test('a loading or none background never flashes preset images and a later explicit background is installed', () => {
  const fixture = environment(false, 'ordinary-session')
  const imageBoot = fixture.boot()
  fixture.publish(undefined)
  let dispose = () => {}
  try {
    dispose = fixture.install()
    const layer = fixture.document.getElementById('amphoreus-wallpaper')!
    assert.equal(layer.hidden, true)
    assert.equal(fixture.body.dataset.amphoreusWallpaper, 'off')
    fixture.publish({ ...imageBoot, wallpaper: { enabled: false, darkMask: .18, lightMask: .03 } })
    assert.equal(layer.hidden, true)
    assert.equal(layer.style.getPropertyValue('--amphoreus-wallpaper-url'), 'none')
    assert.equal(fixture.body.style.getPropertyValue('--amphoreus-sidebar-wallpaper-url'), 'none')
    fixture.publish(imageBoot)
    assert.equal(layer.hidden, false)
    assert.match(layer.style.getPropertyValue('--amphoreus-wallpaper-url'), /wallpaper-2\.webp/)
    dispose()
    fixture.publish(imageBoot)
    assert.equal(fixture.document.getElementById('amphoreus-wallpaper'), null)
  } finally { dispose(); fixture.restore() }
})

test('taking over an unfinished first frame cancels its pending mount and releases the replacement observer', () => {
  const fixture = environment(true, undefined, false)
  let dispose = () => {}
  try {
    assert.equal(fixture.frames.size, 1)
    dispose = fixture.install()
    assert.equal(fixture.frames.size, 0)
    assert.equal(fixture.observers.filter(observer => observer.active).length, 1)
    dispose()
    assert.equal(fixture.observers.filter(observer => observer.active).length, 0)
  } finally { dispose(); fixture.restore() }
})

test('replacing an installation does not duplicate nodes or let an old disposer remove the new shell', () => {
  const fixture = environment(false)
  let first = () => {}, second = () => {}
  try {
    first = fixture.install()
    second = fixture.install()
    first()
    assert.equal(fixture.document.querySelectorAll('#amphoreus-wallpaper').length, 1)
    assert.equal(fixture.document.querySelectorAll('[data-amph-fade]').length, 2)
    second()
    assert.equal(fixture.document.getElementById('amphoreus-wallpaper'), null)
  } finally { first(); second(); fixture.restore() }
})
