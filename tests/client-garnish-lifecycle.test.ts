import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installGarnish } from '../src/client/garnish.ts'

class Style {
  values = new Map<string, [string, string]>()
  cssText = ''
  get display() { return this.getPropertyValue('display') }
  set display(value: string) { this.setProperty('display', value) }
  getPropertyValue(key: string) { return this.values.get(key)?.[0] ?? '' }
  getPropertyPriority(key: string) { return this.values.get(key)?.[1] ?? '' }
  setProperty(key: string, value: string, priority = '') { this.values.set(key, [value, priority]) }
  removeProperty(key: string) { this.values.delete(key) }
}
class Element {
  nodeType = 1
  parentElement: Element | null = null
  children: Element[] = []
  dataset: Record<string, string> = {}
  style = new Style()
  className = ''
  phase = ''
  value = ''
  src = ''
  alt = ''
  readonly tag: string
  constructor(tag: string) { this.tag = tag }
  get tagName() { return this.tag.toUpperCase() }
  get firstElementChild() { return this.children.find(node => node.nodeType === 1) ?? null }
  get isConnected(): boolean { return this.tag === 'body' || this.parentElement?.isConnected === true }
  get parentNode() { return this.parentElement }
  get textContent(): string { return this.value + this.children.map(child => child.textContent).join('') }
  set textContent(value: string) { this.value = value; this.children = [] }
  setAttribute() {}
  append(node: Element) { node.parentElement = this; this.children.push(node); return node }
  prepend(node: Element) { node.parentElement = this; this.children.unshift(node) }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null }
  closest(selector: string): Element | null {
    if (selector === "[data-content-phase='hero']" && this.phase === 'hero') return this
    if (selector === '[class]' && this.className) return this
    return this.parentElement?.closest(selector) ?? null
  }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap(node => [
      ...((selector === 'svg' && node.tag === 'svg') ||
        (selector === 'span[class*="folder"]' && node.tag === 'span' && node.className.includes('folder')) ||
        (selector === '[data-amphoreus-garnish="headline"]' && node.dataset.amphoreusGarnish === 'headline') ? [node] : []),
      ...node.querySelectorAll(selector),
    ])
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null }
}
class TextNode extends Element {
  override nodeType = 3
  constructor(text: string) { super('#text'); this.value = text }
}
function fixture() {
  const names = ['document', 'window', 'HTMLElement', 'Node', 'NodeFilter', 'MutationObserver']
  const originals = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
  const body = new Element('body')
  const heroSurface = body.append(new Element('section')); heroSurface.phase = 'hero'
  const group = heroSurface.append(new Element('span')); group.className = '_titleGroup'
  const holder = group.append(new Element('span'))
  const headline = holder.append(new TextNode('探索未至之境'))
  const badge = group.append(new Element('span')); badge.value = '预览版'
  const ordinary = body.append(new Element('p')).append(new TextNode('Into the Unknown'))
  const draft = heroSurface.append(new Element('textarea')).append(new TextNode('探索未至之境'))
  const folder = body.append(new Element('div')).append(new Element('span')); folder.className = '_folder'
  const svg = folder.append(new Element('svg')); svg.style.setProperty('display', 'inline', 'important')
  const timers = new Map<number, () => void>(), listeners = new Set<() => void>()
  const observers: Array<{ active: boolean; notify: () => void }> = []
  let hero: string | null = null
  const document = { body, createElement: (tag: string) => new Element(tag), querySelectorAll: (selector: string) => body.querySelectorAll(selector),
    createTreeWalker(root: Element) { const visit = (node: Element): Element[] => node.children.flatMap(child => child.nodeType === 3 ? [child] : visit(child)); const texts = visit(root); return { nextNode: () => texts.shift() ?? null } },
  }
  class Observer {
    record: { active: boolean; notify: () => void }
    constructor(callback: (mutations: unknown[]) => void) { this.record = { active: false, notify: () => callback([{ addedNodes: [body], removedNodes: [] }]) }; observers.push(this.record) }
    observe() { this.record.active = true }
    disconnect() { this.record.active = false }
  }
  for (const [name, value] of Object.entries({ document, HTMLElement: Element, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 }, NodeFilter: { SHOW_TEXT: 4 }, MutationObserver: Observer,
    window: { setInterval: (callback: () => void) => { timers.set(1, callback); return 1 }, clearInterval: (id: number) => timers.delete(id) },
  })) Object.defineProperty(globalThis, name, { configurable: true, value })
  const install = () => installGarnish({ assetsConfigured: () => true, now: () => new Date(2026, 9, 22, 12), seat: {
    getSnapshot: () => hero, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  } })
  return { holder, headline, badge, group, ordinary, draft, folder, svg, timers, listeners, observers, install,
    switchSeat(id: string) { hero = id; for (const listener of listeners) listener() },
    restore() { for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name) } },
  }
}

test('hot disable restores the same headline node, sibling markup and original folder styling', () => {
  const h = fixture()
  let dispose = () => {}
  try {
    for (let cycle = 0; cycle < 3; cycle++) {
      dispose = h.install()
      assert.notEqual(h.headline.textContent, '探索未至之境')
      assert.equal(h.svg.style.display, 'none')
      assert.equal(h.folder.children.filter(node => node.tag === 'img').length, 1)
      h.switchSeat('aglaea')
      assert.ok(h.group.children.includes(h.badge), 'seat refresh must preserve native sibling markup')
      assert.ok(h.holder.children.includes(h.headline), 'seat refresh must preserve the native text node')
      dispose(); dispose()
      assert.equal(h.headline.textContent, '探索未至之境')
      assert.equal(h.svg.style.display, 'inline')
      assert.equal(h.svg.style.getPropertyPriority('display'), 'important')
      assert.equal(h.folder.children.filter(node => node.tag === 'img').length, 0)
      assert.equal(h.holder.dataset.amphoreusGarnish, undefined)
      assert.equal(h.folder.dataset.amphoreusGarnish, undefined)
      assert.equal(h.timers.size, 0)
      assert.equal(h.listeners.size, 0)
      assert.equal(h.observers.filter(observer => observer.active).length, 0)
    }
  } finally { dispose(); h.restore() }
})

test('a seat callback before mutation delivery restores a detached headline', () => {
  const h = fixture(); const dispose = h.install()
  try {
    h.headline.remove()
    h.switchSeat('aglaea')
    dispose()
    assert.equal(h.headline.textContent, '探索未至之境')
    assert.equal(h.holder.dataset.amphoreusGarnish, undefined)
  } finally { dispose(); h.restore() }
})

test('ordinary conversation text and hero drafts are never rewritten as greetings', () => {
  const h = fixture(); const dispose = h.install()
  try {
    h.switchSeat('aglaea')
    assert.equal(h.ordinary.textContent, 'Into the Unknown')
    assert.equal(h.draft.textContent, '探索未至之境')
  } finally { dispose(); h.restore() }
})

test('cleanup does not overwrite newer host-owned text or icon styling', () => {
  const h = fixture(); const dispose = h.install()
  try {
    h.headline.textContent = '宿主刚更新的标题'
    h.svg.style.display = 'block'
    h.switchSeat('cyrene')
    dispose()
    assert.equal(h.headline.textContent, '宿主刚更新的标题')
    assert.equal(h.svg.style.display, 'block')
  } finally { dispose(); h.restore() }
})
