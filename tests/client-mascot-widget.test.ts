import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { JsxEmit, ModuleKind, transpileModule } from 'typescript'
import * as position from '../src/client/mascot-position.ts'

type Tree = { type: any; props: Record<string, any>; key?: string }
function flatten(tree: any): Tree[] {
  if (Array.isArray(tree)) return tree.flatMap(flatten)
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...flatten(tree.props?.children)]
}

function harness(initial: Record<string, any> = {}, stored = new Map<string, string>(), protectedRects: any[] = []) {
  const exports: Record<string, any> = {}
  const slots: any[] = []
  const effects: { deps?: any[]; cleanup?: () => void }[] = []
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const timers = new Map<number, () => void>()
  const captures = new Set<number>()
  const nodes = new Map<string, any>()
  let cursor = 0, pending: (() => void)[] = [], tree: any, key: string | undefined
  let props = { heroKey: 'amphoreus-anaxa', heroLabel: '那刻夏', imageUrl: '/anaxa.webp', ...initial }
  const eventTarget = (prefix: string) => ({
    addEventListener: (name: string, fn: (...args: any[]) => void) => {
      const all = listeners.get(prefix + name) ?? new Set(); all.add(fn); listeners.set(prefix + name, all)
    },
    removeEventListener: (name: string, fn: (...args: any[]) => void) => listeners.get(prefix + name)?.delete(fn),
  })
  const protectedNodes = protectedRects.map(rect => ({ getBoundingClientRect: () => rect }))
  const doc = { ...eventTarget('document:'), activeElement: null as any, layers: [] as { role: string; ariaModal?: boolean }[],
    querySelectorAll: () => protectedNodes,
    querySelector: (selector: string) => selector.startsWith('[data-composer-card') ? protectedNodes[0] ?? null
      : doc.layers.find(layer => layer.role === 'menu' || (layer.role === 'dialog' && layer.ariaModal === true)) ?? null }
  const viewport = { width: 1000, height: 700, offsetLeft: 0, offsetTop: 0, ...eventTarget('viewport:') }
  const win = { innerWidth: 1000, innerHeight: 700, visualViewport: viewport, ...eventTarget('window:'),
    setTimeout: (fn: () => void) => { const id = timers.size + 1; timers.set(id, fn); return id },
    clearTimeout: (id: number) => timers.delete(id),
  }
  const useState = (initial: any) => {
    const index = cursor++
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
    return [slots[index], (next: any) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }]
  }
  const useRef = (value: any) => { const index = cursor++; return slots[index] ??= { current: value } }
  const useEffect = (fn: () => any, deps: any[]) => {
    const index = cursor++
    const prev = effects[index]
    if (prev && deps?.every((value, i) => Object.is(value, prev.deps?.[i]))) return
    pending.push(() => { prev?.cleanup?.(); effects[index] = { deps, cleanup: fn() } })
  }
  const jsx = (type: unknown, props: Record<string, any>, key?: string) => ({ type, props, key })
  const source = readFileSync(new URL('../src/client/mascot-widget.tsx', import.meta.url), 'utf8')
  const code = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code, { exports, window: win, document: doc,
    localStorage: { getItem: (name: string) => stored.get(name) ?? null, setItem: (name: string, value: string) => stored.set(name, value), removeItem: (name: string) => stored.delete(name) },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    require: (name: string) => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (name === 'react') return { useState, useRef, useEffect, useLayoutEffect: useEffect, useId: () => 'widget-test' }
      if (name.endsWith('mascot-position.ts')) return position
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, prop) => prop }) }
      throw new Error(`Unexpected import ${name}`)
    },
  })
  const cleanup = () => { for (const effect of effects) effect?.cleanup?.(); effects.length = 0; slots.length = 0 }
  function render(next: Record<string, any> = {}) {
    props = { ...props, ...next }
    cursor = 0; pending = []
    const outer = exports.MascotWidget(props)
    if (key !== outer?.key) { cleanup(); cursor = 0; key = outer?.key }
    tree = outer && typeof outer.type === 'function' ? outer.type(outer.props) : outer
    for (const item of flatten(tree)) {
      if (!item.props.ref) continue
      const name = item.props.id ?? item.props.className ?? item.type
      const node = nodes.get(name) ?? {
        contains: (target: any) => [...nodes.values()].includes(target),
        getBoundingClientRect: () => ({ width: 296, height: 220 }),
        focus: () => { doc.activeElement = node },
        setPointerCapture: (id: number) => captures.add(id), hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => captures.delete(id),
      }
      nodes.set(name, node)
      if (typeof item.props.ref === 'function') item.props.ref(node)
      else item.props.ref.current = node
    }
    const scheduled = pending; pending = []; scheduled.forEach(fn => fn())
    return tree
  }
  function find(predicate: (node: Tree) => boolean) { const found = flatten(tree).find(predicate); assert.ok(found); return found }
  const button = () => find(node => node.type === 'button' && node.props['aria-haspopup'] === 'dialog')
  const fire = (name: string, event: any = {}) => { for (const fn of listeners.get(name) ?? []) fn(event) }
  const event = (override = {}) => ({ pointerId: 1, button: 0, isPrimary: true, clientX: 950, clientY: 650, detail: 1,
    preventDefault() {}, stopPropagation() {}, currentTarget: button().props.ref.current, ...override })
  render(); render()
  return { render, find, button, event, fire, stored, timers, captures, viewport, doc, cleanup,
    get tree() { return tree }, get listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0) } }
}

test('default docking clears both the composer and the handoff action area above it', () => {
  const h = harness({}, new Map(), [
    { left: 200, top: 560, right: 992, bottom: 690, width: 792, height: 130 },
    { left: 200, top: 440, right: 992, bottom: 550, width: 792, height: 110 },
  ])
  assert.equal(h.tree.props.style.top, 372)
  assert.equal(h.tree.props.style.left, 932)
  h.cleanup()
  assert.equal(h.listenerCount, 0)
})

test('actual widget entry opens an accessible panel, closes on Escape and releases all listeners', () => {
  const h = harness({ data: { balance: { text: '¥12.34' }, usage: { text: '1,234 tokens' }, turn: { id: 'old', text: '¥0.01' } } })
  const button = h.button()
  assert.equal(button.props['aria-expanded'], false)
  button.props.onClick(h.event())
  h.render(); h.render()
  assert.equal(h.button().props['aria-expanded'], true)
  assert.ok(h.find(node => node.props.role === 'dialog').props['aria-labelledby'])
  assert.ok(h.find(node => node.type === 'dd' && node.props.children === '¥12.34'))
  h.fire('document:keydown', h.event({ key: 'Escape' }))
  h.render()
  assert.equal(h.button().props['aria-expanded'], false)
  assert.equal(h.doc.activeElement, h.button().props.ref.current)
  h.cleanup()
  assert.equal(h.listenerCount, 0)
  assert.equal(h.timers.size, 0)
})

test('pointer drag captures, docks, persists, mirrors only the image and suppresses the following mouse click', () => {
  const h = harness()
  h.button().props.onPointerDown(h.event())
  assert.equal(h.captures.size, 1)
  h.button().props.onPointerMove(h.event({ clientX: 20, clientY: 340 }))
  h.render()
  h.button().props.onPointerUp(h.event({ clientX: 20, clientY: 340 }))
  h.render()
  assert.equal(h.captures.size, 0)
  const saved = JSON.parse([...h.stored.values()][0]!)
  assert.equal(saved.dock, 'left')
  assert.equal(h.find(node => node.type === 'img').props['data-mirrored'], true)
  assert.equal(h.button().props['data-mirrored'], undefined)
  h.button().props.onClick(h.event()); h.render()
  assert.equal(h.button().props['aria-expanded'], false)
  h.button().props.onClick(h.event({ detail: 0 })); h.render()
  assert.equal(h.button().props['aria-expanded'], true)
  h.cleanup()
})

test('small pointer motion remains a click; cancellation restores position and keyboard movement stays usable', () => {
  const h = harness()
  h.button().props.onPointerDown(h.event())
  h.button().props.onPointerMove(h.event({ clientX: 952, clientY: 652 }))
  h.button().props.onPointerUp(h.event({ clientX: 952, clientY: 652 }))
  h.button().props.onClick(h.event()); h.render()
  assert.equal(h.button().props['aria-expanded'], true)
  h.fire('document:keydown', h.event({ key: 'Escape' })); h.render()
  h.button().props.onPointerDown(h.event())
  h.button().props.onPointerMove(h.event({ clientX: 500, clientY: 300 })); h.render()
  h.button().props.onPointerCancel(h.event()); h.render()
  assert.equal(h.stored.size, 0)
  h.button().props.onKeyDown(h.event({ key: 'ArrowLeft', shiftKey: true })); h.render()
  assert.equal(JSON.parse([...h.stored.values()][0]!).dock, 'free')
  h.button().props.onKeyDown(h.event({ key: 'Home' })); h.render()
  assert.equal(JSON.parse([...h.stored.values()][0]!).dock, 'bottom-right')
  h.cleanup()
})

test('positions are separate per role, survive remount, and resize against the mobile visual viewport', () => {
  const stored = new Map<string, string>()
  const h = harness({}, stored)
  h.button().props.onKeyDown(h.event({ key: 'ArrowLeft' })); h.render()
  const original = [...stored.values()][0]
  h.render({ heroKey: 'amphoreus-cyrene', heroLabel: '昔涟', imageUrl: '/cyrene.webp' }); h.render()
  h.button().props.onKeyDown(h.event({ key: 'ArrowUp' })); h.render()
  assert.equal(stored.size, 2)
  h.render({ heroKey: 'amphoreus-anaxa', heroLabel: '那刻夏', imageUrl: '/anaxa.webp' }); h.render()
  assert.equal([...stored.values()][0], original)
  h.viewport.width = 390; h.viewport.height = 280; h.viewport.offsetTop = 420
  h.fire('viewport:resize'); h.render()
  const root = h.find(node => node.props['data-mascot-widget'] !== undefined)
  assert.ok(root.props.style.left >= 12 && root.props.style.left <= 322)
  assert.ok(root.props.style.top >= 432 && root.props.style.top <= 632)
  h.cleanup()
})

test('new completed turns show a readable timed bubble, while old or disabled bubbles stay quiet', () => {
  const h = harness({ data: { turn: { id: 'old', text: '¥0.01' } }, autoHideSeconds: 8 })
  assert.equal(flatten(h.tree).filter(node => node.props.role === 'status').length, 0)
  h.render({ data: { turn: { id: 'new', text: '¥0.02', status: 'complete' } } }); h.render()
  assert.ok(h.find(node => node.props.role === 'status'))
  assert.equal(h.timers.size, 1)
  for (const callback of h.timers.values()) callback()
  h.render(); h.render()
  assert.equal(flatten(h.tree).filter(node => node.props.role === 'status').length, 0)
  h.render({ showTurnBubble: false, data: { turn: { id: 'newer', text: '¥0.03' } } }); h.render()
  assert.equal(flatten(h.tree).filter(node => node.props.role === 'status').length, 0)
  h.cleanup()
  assert.equal(h.timers.size, 0)
})

test('unmount while dragging releases pointer capture; absent images create no shell', () => {
  const h = harness()
  h.button().props.onPointerDown(h.event())
  h.cleanup()
  assert.equal(h.captures.size, 0)
  assert.equal(h.listenerCount, 0)
  const empty = harness({ imageUrl: null })
  assert.equal(empty.tree, null)
  assert.equal(empty.listenerCount, 0)
})

test('a running turn present at mount produces its bubble only when it completes', () => {
  const h = harness({ data: { turn: { id: 'active', text: '统计中', status: 'running' } }, autoHideSeconds: 0 })
  h.render({ data: { turn: { id: 'active', text: '¥0.07', status: 'complete' } } }); h.render()
  assert.ok(h.find(node => node.props.role === 'status'))
  assert.equal(h.timers.size, 0)
  h.cleanup()
})

test('window blur cancels an interrupted drag without changing the saved position', () => {
  const h = harness()
  h.button().props.onPointerDown(h.event())
  h.button().props.onPointerMove(h.event({ clientX: 500, clientY: 300 })); h.render()
  h.fire('window:blur'); h.render()
  assert.equal(h.captures.size, 0)
  assert.equal(h.stored.size, 0)
  assert.equal(h.find(node => node.props['data-mascot-widget'] !== undefined).props['data-dragging'], false)
  h.cleanup()
})

test('static mode keeps interaction, localization and bounded history available', () => {
  const h = harness({ reactive: false, t: (key: string) => `translated:${key}`,
    data: { history: Array.from({ length: 24 }, (_, index) => ({ id: String(index), label: `Turn ${index}`, amount: '¥0.01' })) } })
  assert.equal(h.find(node => node.props['data-mascot-widget'] !== undefined).props['data-reactive'], false)
  assert.match(h.button().props['aria-label'], /translated:mascot.open/u)
  h.button().props.onClick(h.event()); h.render(); h.render()
  assert.equal(flatten(h.tree).filter(node => node.type === 'li').length, 20)
  h.fire('document:pointerdown', { target: {} }); h.render()
  assert.equal(h.button().props['aria-expanded'], false)
  h.cleanup()
})

test('manual refresh failures remain actionable without unhandled rejection or duplicate requests', async () => {
  let count = 0
  const h = harness({ onRefresh: () => { count++; return Promise.reject(new Error('offline')) } })
  h.button().props.onClick(h.event()); h.render(); h.render()
  h.find(node => node.type === 'button' && node.props.children === '刷新').props.onClick()
  h.render()
  assert.equal(h.find(node => node.type === 'button' && node.props.children === '正在更新…').props.disabled, true)
  await new Promise(resolve => setImmediate(resolve))
  h.render()
  assert.equal(count, 1)
  assert.equal(h.find(node => node.props.role === 'alert').props.children, '更新失败，请重试')
  assert.equal(h.find(node => node.type === 'button' && node.props.children === '刷新').props.disabled, false)
  h.cleanup()
})

test('the first asynchronous snapshot does not announce a historical turn as newly completed', () => {
  const h = harness()
  h.render({ data: { turn: { id: 'historical', text: '¥0.10', status: 'complete' } } }); h.render()
  assert.equal(flatten(h.tree).filter(node => node.props.role === 'status').length, 0)
  h.render({ data: { turn: { id: 'next', text: '¥0.11', status: 'complete' } } }); h.render()
  assert.ok(h.find(node => node.props.role === 'status'))
  h.cleanup()
})

test('a foreground modal hides the widget and keeps focus and Escape ownership during panel opening', () => {
  const h = harness()
  h.button().props.onClick(h.event())
  const modal = { role: 'dialog', ariaModal: true }
  h.doc.layers = [modal]
  h.doc.activeElement = modal
  h.render(); h.render()
  assert.equal(h.doc.activeElement, modal)
  let prevented = false
  h.fire('document:keydown', h.event({ key: 'Escape', preventDefault: () => { prevented = true } })); h.render()
  assert.equal(prevented, false)
  assert.equal(h.doc.activeElement, modal)
  assert.equal(h.button().props['aria-expanded'], true)
  const styles = readFileSync(new URL('../src/client/mascot-widget.module.css', import.meta.url), 'utf8')
  assert.match(styles, /:global\(body:has\(\[aria-modal="true"\]\)\)\s+\.root\s*\{\s*display:\s*none;/u)
  h.doc.layers = [{ role: 'dialog', ariaModal: false }]
  h.fire('document:keydown', h.event({ key: 'Escape' })); h.render()
  assert.equal(h.button().props['aria-expanded'], false)
  assert.equal(h.doc.activeElement, h.button().props.ref.current)
  h.cleanup()
})

test('native menus and already handled Escape events take priority without closing or refocusing the widget', () => {
  const h = harness()
  h.button().props.onClick(h.event()); h.render(); h.render()
  const menu = { role: 'menu' }
  h.doc.layers = [menu]
  h.doc.activeElement = menu
  let prevented = false
  h.fire('document:keydown', h.event({ key: 'Escape', preventDefault: () => { prevented = true } })); h.render()
  assert.equal(prevented, false)
  assert.equal(h.doc.activeElement, menu)
  assert.equal(h.button().props['aria-expanded'], true)
  h.doc.layers = []
  h.fire('document:keydown', h.event({ key: 'Escape', defaultPrevented: true })); h.render()
  assert.equal(h.button().props['aria-expanded'], true)
  h.fire('document:keydown', h.event({ key: 'Escape' })); h.render()
  assert.equal(h.button().props['aria-expanded'], false)
  h.cleanup()
})
