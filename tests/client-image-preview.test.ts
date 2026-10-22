import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { JsxEmit, ModuleKind, transpileModule } from 'typescript'
import * as geometry from '../src/client/image-preview-geometry.ts'
import { lockImagePreviewScroll } from '../src/client/image-preview-scroll.ts'

function flatten(tree: any): any[] { return Array.isArray(tree) ? tree.flatMap(flatten) : tree && typeof tree === 'object' ? [tree, ...flatten(tree.props?.children)] : [] }
function harness() {
  const exports: Record<string, any> = {}, slots: any[] = [], effects: any[] = [], nodes = new Map<string, any>(), listeners = new Map<string, Set<any>>()
  const preloads: any[] = [], observers: any[] = [], captures = new Set<number>(), changes: string[] = []
  let cursor = 0, pending: (() => void)[] = [], tree: any, closed = 0, overflow = 'clip', priority = ''
  const items = Array.from({ length: 7 }, (_, i) => ({ id: String(i), url: `/img-${i}.png`, label: `Image ${i}` }))
  let props = { items, activeId: '3', onActiveIdChange: (id: string) => changes.push(id), onClose: () => { closed++ }, t: (key: string) => key }
  const eventTarget = (prefix: string) => ({
    addEventListener: (name: string, fn: any) => { const set = listeners.get(prefix + name) ?? new Set(); set.add(fn); listeners.set(prefix + name, set) },
    removeEventListener: (name: string, fn: any) => listeners.get(prefix + name)?.delete(fn),
  })
  const document = { body: { style: { getPropertyValue: () => overflow, getPropertyPriority: () => priority,
    setProperty: (_key: string, value: string, nextPriority = '') => { overflow = value; priority = nextPriority }, removeProperty: () => { overflow = ''; return '' } } } }
  const jsx = (type: any, props: any, key: any) => ({ type, props, key })
  const useState = (initial: any) => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (next: any) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }] }
  const useRef = (value: any) => { const index = cursor++; return slots[index] ??= { current: value } }
  const useEffect = (fn: () => any, deps: any[]) => {
    const index = cursor++, old = effects[index]
    if (old && deps.every((value, i) => Object.is(value, old.deps[i]))) return
    pending.push(() => { old?.cleanup?.(); effects[index] = { deps, cleanup: fn() } })
  }
  const code = transpileModule(readFileSync(new URL('../src/client/image-preview.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code, { exports, document, window: eventTarget('window:'),
    Image: class { src = ''; removed = false; constructor() { preloads.push(this) } removeAttribute(name: string) { if (name === 'src') this.removed = true } },
    ResizeObserver: class { active = false; callback: () => void; constructor(callback: () => void) { this.callback = callback; observers.push(this) } observe() { this.active = true } disconnect() { this.active = false } },
    require: (name: string) => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (name === 'react') return { useState, useRef, useEffect, useLayoutEffect: useEffect, useId: () => 'preview-test' }
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Modal: 'native-modal' }
      if (name.endsWith('image-preview-geometry.ts')) return geometry
      if (name.endsWith('image-preview-scroll.ts')) return { lockImagePreviewScroll }
      return { default: new Proxy({}, { get: (_, key) => key }) }
    },
  })
  function render(next: Partial<typeof props> = {}) {
    props = { ...props, ...next }; cursor = 0; pending = []; tree = exports.ImagePreview(props)
    for (const item of flatten(tree)) if (item.props.ref) {
      const name = item.props.className ?? item.type
      let node = nodes.get(name)
      if (!node) { node = { ...eventTarget(`${name}:`), clientWidth: 800, clientHeight: 600, naturalWidth: 2400, naturalHeight: 1800, complete: false,
        getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }),
        setPointerCapture: (id: number) => captures.add(id), hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => captures.delete(id),
        getAttribute: (key: string) => node[key],
      }; nodes.set(name, node) }
      if (item.props.src) node.src = item.props.src
      item.props.ref.current = node
    }
    const ready = pending; pending = []; ready.forEach(fn => fn())
    return tree
  }
  const find = (predicate: (node: any) => boolean) => { const item = flatten(tree).find(predicate); assert.ok(item); return item }
  const image = () => find(node => node.type === 'img')
  const stage = () => find(node => node.props['data-image-preview-stage'] !== undefined)
  const event = (other = {}) => ({ pointerId: 1, button: 0, isPrimary: true, clientX: 500, clientY: 350, currentTarget: stage().props.ref.current, preventDefault() {}, stopPropagation() {}, nativeEvent: {}, ...other })
  const loaded = () => { image().props.onLoad({ currentTarget: image().props.ref.current }); render(); render() }
  const fire = (name: string, value: any = {}) => { for (const fn of listeners.get(name) ?? []) fn(value) }
  render(); render()
  return { render, find, image, stage, event, loaded, fire, preloads, observers, captures, changes,
    cleanup: () => { for (const effect of effects) effect?.cleanup?.() }, get tree() { return tree }, get closed() { return closed }, get overflow() { return overflow },
    get listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0) } }
}

test('the actual preview uses the native modal and bounds adjacent preloads without changing page scroll ownership', () => {
  const h = harness()
  assert.equal(h.tree.type, 'native-modal')
  assert.equal(h.tree.props.headless, true)
  assert.equal(h.overflow, 'hidden')
  assert.deepEqual(h.preloads.map(item => item.src), ['/img-1.png', '/img-2.png', '/img-4.png', '/img-5.png'])
  h.loaded()
  assert.equal(h.image().props.style.width, 800)
  assert.equal(h.image().props.style.height, 600)
  h.cleanup()
  assert.equal(h.overflow, 'clip')
  assert.equal(h.listenerCount, 0)
  assert.ok(h.preloads.every(item => item.removed))
  assert.ok(h.observers.every(item => !item.active))
})

test('actual drag events use the fixed origin and cancellation restores the pre-drag transform', () => {
  const h = harness(); h.loaded()
  h.stage().props.onDoubleClick(h.event()); h.render()
  h.stage().props.onPointerDown(h.event())
  h.stage().props.onPointerMove(h.event({ clientX: 510, clientY: 355 })); h.render()
  h.stage().props.onPointerMove(h.event({ clientX: 520, clientY: 360 })); h.render()
  assert.match(h.image().props.style.transform, /translate3d\(20px, 10px, 0\)/u)
  assert.equal(h.captures.size, 1)
  h.stage().props.onPointerCancel(h.event()); h.render()
  assert.match(h.image().props.style.transform, /translate3d\(0px, 0px, 0\)/u)
  assert.equal(h.captures.size, 0)
  h.cleanup()
})

test('Escape cancels a captured drag first and otherwise remains owned by the native modal', () => {
  const h = harness(); h.loaded(); h.stage().props.onDoubleClick(h.event()); h.render()
  h.stage().props.onPointerDown(h.event()); h.stage().props.onPointerMove(h.event({ clientX: 530 })); h.render()
  let prevented = false
  h.tree.props.onKeyDownCapture(h.event({ key: 'Escape', preventDefault: () => { prevented = true } })); h.render()
  assert.equal(prevented, true); assert.equal(h.closed, 0); assert.equal(h.captures.size, 0)
  prevented = false
  h.tree.props.onKeyDownCapture(h.event({ key: 'Escape', preventDefault: () => { prevented = true } }))
  assert.equal(prevented, false)
  h.tree.props.onClose(); assert.equal(h.closed, 1)
  h.cleanup()
})

test('load failure offers a retry, disables zoom, and deleting the active image closes cleanly', () => {
  const h = harness()
  h.image().props.onError(); h.render()
  assert.ok(h.find(node => node.props.role === 'alert'))
  assert.equal(h.find(node => node.props['aria-label'] === 'imagePreview.zoomIn').props.disabled, true)
  h.find(node => node.type === 'button' && node.props.children === 'imagePreview.retry').props.onClick(); h.render()
  h.loaded()
  assert.equal(h.find(node => node.props['aria-label'] === 'imagePreview.zoomIn').props.disabled, false)
  h.render({ items: [] }); h.render()
  assert.equal(h.tree, null)
  assert.ok(h.closed > 0)
  assert.equal(h.overflow, 'clip')
  assert.equal(h.listenerCount, 0)
  h.cleanup()
})

test('keyboard navigation and fit reset preserve image sizing and release capture on hot unmount', () => {
  const h = harness(); h.loaded()
  h.tree.props.onKeyDownCapture(h.event({ key: 'ArrowRight' })); assert.deepEqual(h.changes, ['4'])
  h.tree.props.onKeyDownCapture(h.event({ key: '+' })); h.render()
  assert.match(h.image().props.style.transform, /scale\(1.25\)/u)
  h.tree.props.onKeyDownCapture(h.event({ key: '0' })); h.render()
  assert.match(h.image().props.style.transform, /scale\(1\)/u)
  h.stage().props.onDoubleClick(h.event()); h.render(); h.stage().props.onPointerDown(h.event())
  h.cleanup()
  assert.equal(h.captures.size, 0); assert.equal(h.listenerCount, 0)
})

test('late load and error callbacks from a previous image cannot replace the current loaded image', () => {
  const h = harness()
  const oldImage = h.image()
  h.render({ activeId: '4' }); h.loaded()
  assert.equal(h.image().props.src, '/img-4.png')
  assert.equal(h.image().props.hidden, false)
  oldImage.props.onError(); h.render()
  assert.equal(h.image().props.hidden, false)
  oldImage.props.onLoad({ currentTarget: { naturalWidth: 1, naturalHeight: 1 } }); h.render()
  assert.equal(h.image().props.style.width, 800)
  assert.equal(h.image().props.hidden, false)
  h.cleanup()
})
