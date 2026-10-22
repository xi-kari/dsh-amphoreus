import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('app.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
function implementation(names: string[]) {
  return names.map(name => {
    const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    assert.ok(declaration, `${name} exists in the shipped workbench`)
    return declaration.getText(parsed)
  }).join('\n')
}

class Surface {
  listeners = new Map<string, Set<(event: any) => void>>()
  attributes = new Map<string, string>()
  dataset: Record<string, string> = {}
  values = new Map<string, string>()
  style = { width: '', setProperty: (name: string, value: string) => this.values.set(name, value) }
  scrollTop = 0
  scrollHeight = 1400
  clientHeight = 400
  width = 1000
  hidden = false
  captured: number | null = null
  addEventListener(type: string, fn: (event: any) => void) { const set = this.listeners.get(type) ?? new Set(); set.add(fn); this.listeners.set(type, set) }
  removeEventListener(type: string, fn: (event: any) => void) { this.listeners.get(type)?.delete(fn) }
  emit(type: string, fields: Record<string, unknown> = {}) {
    const event = { target: this, type, button: 0, pointerId: 1, clientX: 500, key: '', defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true }, stopPropagation() {}, ...fields }
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event)
    return event
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  getBoundingClientRect() { return { width: this.width } }
  setPointerCapture(id: number) { this.captured = id }
  releasePointerCapture() { this.captured = null }
  closest() { return null }
}

function harness() {
  const observed: Array<{ callback: () => void; nodes: unknown[]; disconnected: boolean }> = []
  class Observer {
    entry: typeof observed[number]
    constructor(callback: () => void) { this.entry = { callback, nodes: [], disconnected: false }; observed.push(this.entry) }
    observe(node: unknown) { this.entry.nodes.push(node) }
    disconnect() { this.entry.disconnected = true }
  }
  const context: Record<string, any> = { ResizeObserver: Observer, performance: { now: () => 1000 } }
  vm.createContext(context)
  vm.runInContext(implementation(['readingGeometry', 'createWorkbenchReader', 'inspectorWidthBounds', 'createInspectorResizer']), context)
  return { ...context, context, observed }
}

test('readers follow near-bottom growth, preserve manual reading and offer an explicit jump', () => {
  const h = harness()
  const scroll = new Surface(), content = new Surface(), jump = new Surface()
  let time = 1000
  const saved: any[] = []
  const reader = h.createWorkbenchReader({ scroll, content, jump, previous: { top: 600, pinned: true, lastInputAt: 0 }, now: () => time, onSave: (value: unknown) => saved.push(value) })
  assert.equal(scroll.scrollTop, 1000)
  assert.equal(jump.hidden, true)
  scroll.emit('wheel')
  scroll.scrollTop = 120
  scroll.emit('scroll')
  scroll.scrollHeight = 1900
  h.observed[0]!.callback()
  assert.equal(scroll.scrollTop, 120)
  assert.equal(jump.hidden, false)
  assert.equal(scroll.values.get('--reader-fade-top'), '18px')
  assert.equal(scroll.values.get('--reader-fade-bottom'), '18px')
  time += 200
  scroll.scrollTop = 1480
  scroll.emit('scroll')
  scroll.scrollHeight = 2300
  h.observed[0]!.callback()
  assert.equal(scroll.scrollTop, 1900)
  scroll.emit('wheel'); scroll.scrollTop = 100; scroll.emit('scroll')
  jump.emit('click')
  assert.equal(scroll.scrollTop, 1900)
  assert.equal(saved.at(-1).pinned, true)
  assert.deepEqual(h.observed[0]!.nodes, [scroll, content])
  reader.dispose()
  const before = saved.length
  scroll.scrollHeight += 100
  h.observed[0]!.callback(); scroll.emit('scroll'); jump.emit('click')
  assert.equal(saved.length, before)
  assert.equal(h.observed[0]!.disconnected, true)
})

test('a user gesture near the bottom has a cooldown and positions survive panel remounts independently', () => {
  const h = harness()
  let time = 1000, saved: any
  const scroll = new Surface(), content = new Surface(), jump = new Surface()
  const reader = h.createWorkbenchReader({ scroll, content, jump, previous: { top: 980, pinned: true, lastInputAt: 0 }, now: () => time, onSave: (value: unknown) => { saved = value } })
  scroll.emit('wheel'); scroll.scrollTop = 980; scroll.emit('scroll')
  time += 50
  scroll.scrollHeight = 1500
  h.observed[0]!.callback()
  assert.equal(scroll.scrollTop, 980)
  reader.dispose()
  const remount = new Surface()
  remount.scrollHeight = 1700
  h.createWorkbenchReader({ scroll: remount, content, jump, previous: saved, now: () => time, onSave() {} })
  assert.equal(remount.scrollTop, 980)
  const other = new Surface()
  h.createWorkbenchReader({ scroll: other, content, jump: new Surface(), onSave() {} })
  assert.equal(other.scrollTop, 0)
})

test('reader clamps shrinking content and explicit card navigation pauses following', () => {
  const h = harness(), scroll = new Surface()
  const reader = h.createWorkbenchReader({ scroll, content: new Surface(), jump: new Surface(), previous: { top: 1000, pinned: true, lastInputAt: 0 }, onSave() {} })
  scroll.scrollTop = 100
  reader.hold()
  scroll.scrollHeight = 2000
  h.observed[0]!.callback()
  assert.equal(scroll.scrollTop, 100)
  scroll.scrollHeight = 450
  h.observed[0]!.callback()
  assert.equal(scroll.scrollTop, 50)
})

test('reaching the bottom during input cooldown resumes following after the cooldown without another scroll', () => {
  const h = harness(), scroll = new Surface()
  let time = 1000
  h.createWorkbenchReader({ scroll, content: new Surface(), jump: new Surface(), now: () => time, onSave() {} })
  scroll.emit('wheel')
  scroll.scrollTop = 1000
  scroll.emit('scroll')
  time += 200
  scroll.scrollHeight = 1800
  h.observed[0]!.callback()
  assert.equal(scroll.scrollTop, 1400)
  scroll.emit('wheel')
  scroll.scrollTop = 100
  scroll.emit('scroll')
  time += 200
  scroll.scrollHeight = 2200
  h.observed[0]!.callback()
  assert.equal(scroll.scrollTop, 100)
})

test('mounted detail and inspector state keeps its own identity across render replacement', () => {
  const h = harness(), content = new Surface(), jump = new Surface()
  const positions = new Map()
  let scroll = new Surface()
  const connect = (node: Surface) => Object.assign(node, {
    querySelector: () => content,
    parentElement: { querySelector: () => jump },
  })
  connect(scroll)
  Object.assign(h.context, {
    HTMLElement: Surface,
    state: { detailThreadId: 'a', inspectorCardId: null, readingPositions: positions, inspectorWidth: null },
    document: { querySelector: (selector: string) => selector === '.detail-scroll' ? scroll : null },
    disposeWorkbenchSurfaces() {}, currentDetailReader: null,
  })
  vm.runInContext(implementation(['installWorkbenchSurfaces']), h.context)
  h.context.installWorkbenchSurfaces()
  scroll.emit('wheel'); scroll.scrollTop = 140; scroll.emit('scroll')
  h.context.state.detailThreadId = 'b'
  h.context.disposeWorkbenchSurfaces()
  assert.equal(positions.get('detail:a').top, 140)
  assert.equal(positions.has('detail:b'), false)
  scroll = connect(new Surface())
  h.context.installWorkbenchSurfaces()
  assert.equal(scroll.scrollTop, 0)
  h.context.disposeWorkbenchSurfaces()
  h.context.state.detailThreadId = 'a'
  scroll = connect(new Surface())
  h.context.installWorkbenchSurfaces()
  assert.equal(scroll.scrollTop, 140)
  h.context.disposeWorkbenchSurfaces()
})

function resizer() {
  const h = harness(), handle = new Surface(), panel = new Surface(), container = new Surface(), ownerDocument = new Surface()
  const committed: number[] = []
  const control = h.createInspectorResizer({ handle, panel, container, ownerDocument, onWidth: (value: number) => committed.push(value) })
  return { h, handle, panel, container, ownerDocument, committed, control }
}

test('inspector dragging starts at four pixels, commits once and releases capture', () => {
  const r = resizer()
  r.handle.emit('pointerdown')
  r.ownerDocument.emit('pointermove', { clientX: 503 })
  assert.equal(r.panel.style.width, '460px')
  assert.equal(r.container.dataset.inspectorResizing, undefined)
  r.ownerDocument.emit('pointermove', { clientX: 510 })
  assert.equal(r.panel.style.width, '450px')
  r.ownerDocument.emit('pointermove', { clientX: 520, pointerId: 9 })
  assert.equal(r.panel.style.width, '450px')
  r.ownerDocument.emit('pointerup')
  assert.deepEqual(r.committed, [450])
  assert.equal(r.handle.captured, null)
  assert.equal(r.container.dataset.inspectorResizing, undefined)
  assert.equal(r.ownerDocument.listeners.get('pointermove')?.size, 0)
})

for (const cancel of ['Escape', 'pointercancel', 'lostpointercapture', 'dispose']) {
  test(`inspector ${cancel} restores the previous width and clears the gesture`, () => {
    const r = resizer()
    r.handle.emit('pointerdown')
    r.ownerDocument.emit('pointermove', { clientX: 480 })
    assert.equal(r.panel.style.width, '480px')
    if (cancel === 'Escape') assert.equal(r.ownerDocument.emit('keydown', { key: 'Escape' }).defaultPrevented, true)
    else if (cancel === 'dispose') r.control.dispose()
    else if (cancel === 'lostpointercapture') r.handle.emit(cancel)
    else r.ownerDocument.emit(cancel)
    assert.equal(r.panel.style.width, '460px')
    assert.equal(r.handle.captured, null)
    assert.equal(r.container.dataset.inspectorResizing, undefined)
    assert.deepEqual(r.committed, [])
  })
}

test('inspector keyboard and double-click reset work, with valid bounds in narrow containers', () => {
  const r = resizer()
  r.handle.emit('keydown', { key: 'ArrowLeft' })
  assert.equal(r.panel.style.width, '476px')
  r.handle.emit('keydown', { key: 'Home' })
  assert.equal(r.panel.style.width, '300px')
  r.handle.emit('dblclick')
  assert.equal(r.panel.style.width, '460px')
  r.container.width = 320
  r.h.observed[0]!.callback()
  assert.equal(r.panel.style.width, '304px')
  assert.ok(Number(r.handle.attributes.get('aria-valuemin')) <= Number(r.handle.attributes.get('aria-valuemax')))
  r.handle.emit('keydown', { key: 'Home' })
  assert.equal(r.panel.style.width, '240px')
  r.handle.emit('keydown', { key: 'Enter' })
  assert.equal(r.panel.style.width, '304px')
  r.container.width = 1000
  r.h.observed[0]!.callback()
  assert.equal(r.panel.style.width, '460px')
  r.handle.emit('pointerdown')
  r.h.observed[0]!.callback()
  r.ownerDocument.emit('pointermove', { clientX: 490 })
  assert.equal(r.panel.style.width, '470px')
  r.ownerDocument.emit('pointerup')
  r.control.dispose()
  assert.equal(r.h.observed[0]!.disconnected, true)
})
