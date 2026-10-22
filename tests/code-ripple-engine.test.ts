import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { JsxEmit, ModuleKind, transpileModule } from 'typescript'
import * as math from '../src/client/code-ripple-math.ts'

const defaults = { color: '#d4a35c', dark: false, intensity: .8, interactive: true, static: false }
function harness(options: { webgl?: boolean; twoD?: boolean; shaderFails?: boolean; linkFails?: boolean; reduced?: boolean; static?: boolean } = {}) {
  const allTargets: Target[] = [], frames = new Map<number, (now: number) => void>(), timers = new Map<number, { at: number; fn: () => void }>()
  const observers: { active: boolean; callback: () => void }[] = [], alive = new Set<object>(), deleted: string[] = []
  let now = 0, sequence = 0, drawCount = 0, releases = 0, queries = 0, twoDraws = 0, measureCalls = 0
  let shaderFails = options.shaderFails === true, linkFails = options.linkFails === true
  class Target {
    listeners = new Map<string, Set<(e: any) => void>>()
    constructor() { allTargets.push(this) }
    addEventListener(name: string, fn: (e: any) => void, opts?: any) {
      const set = this.listeners.get(name) ?? new Set(); set.add(fn); this.listeners.set(name, set)
      opts?.signal?.addEventListener('abort', () => this.removeEventListener(name, fn), { once: true })
    }
    removeEventListener(name: string, fn: (e: any) => void) { this.listeners.get(name)?.delete(fn) }
    fire(name: string, event = {}) { for (const fn of [...(this.listeners.get(name) ?? [])]) fn(event) }
  }
  const resource = (kind: string) => { const value = { kind }; alive.add(value); return value }
  const remove = (value: any) => { if (value && alive.delete(value)) deleted.push(value.kind) }
  const noop = () => {}
  const gl = new Proxy({
    createShader: () => resource('shader'), createProgram: () => resource('program'), createBuffer: () => resource('buffer'), createTexture: () => resource('texture'),
    deleteShader: remove, deleteProgram: remove, deleteBuffer: remove, deleteTexture: remove,
    getShaderParameter: () => !shaderFails, getProgramParameter: () => !linkFails, getAttribLocation: () => 0,
    getUniformLocation: () => ({}), getExtension: () => ({ loseContext: () => { releases++ } }), drawArrays: () => { drawCount++ },
  } as Record<string, any>, { get: (target, key: string) => key in target ? target[key] : /^[A-Z0-9_]+$/.test(key) ? 1 : noop })
  const context = () => ({ clearRect: noop, fillRect: noop, fillText: noop, setTransform: noop, drawImage: () => { twoDraws++ }, getImageData: () => ({ data: new Uint8Array([212, 163, 92, 255]) }) })
  class Canvas extends Target {
    width = 300; height = 150; className = ''; parent: any; attributes = new Map<string, string>(); ctx = context()
    setAttribute(key: string, value: string) { this.attributes.set(key, value) }
    getContext(kind: string) { return kind === 'webgl' ? options.webgl === false ? null : gl : options.twoD === false ? null : this.ctx }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((child: unknown) => child !== this); this.parent = undefined }
  }
  const doc: any = new Target(), win: any = new Target(), motion: any = new Target()
  motion.matches = options.reduced === true
  win.matchMedia = () => motion; win.devicePixelRatio = 3; win.performance = { now: () => now }
  win.requestAnimationFrame = (fn: (now: number) => void) => { const id = ++sequence; frames.set(id, fn); return id }
  win.cancelAnimationFrame = (id: number) => frames.delete(id)
  win.setTimeout = (fn: () => void, delay: number) => { const id = ++sequence; timers.set(id, { at: now + delay, fn }); return id }
  win.clearTimeout = (id: number) => timers.delete(id)
  doc.defaultView = win; doc.visibilityState = 'visible'; doc.documentElement = new Target()
  doc.createElement = () => new Canvas(); doc.querySelectorAll = () => { queries++; return [] }
  const container = { ownerDocument: doc, isConnected: true, children: [] as Canvas[], attributes: new Map<string, string>([['unrelated', 'kept']]),
    getAttribute(key: string) { return this.attributes.get(key) ?? null }, setAttribute(key: string, value: string) { this.attributes.set(key, value) }, removeAttribute(key: string) { this.attributes.delete(key) },
    append(canvas: Canvas) { this.children.push(canvas); canvas.parent = this }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 1000 }) }
  const exports: Record<string, any> = {}
  const source = transpileModule(readFileSync(new URL('../src/client/code-ripple-engine.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ModuleKind.CommonJS, target: 9, jsx: JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(source, { exports, AbortController, window: win, ResizeObserver: class {
    active = false; callback: () => void; constructor(callback: () => void) { this.callback = callback; observers.push(this) } observe() { this.active = true } disconnect() { this.active = false }
  }, require: (name: string) => name.endsWith('code-ripple-math.ts') ? math : { default: { canvas: 'canvas' } } })
  const blockedRects = () => { measureCalls++; return [] }
  const prefs = { ...defaults, static: options.static === true, blockedRects }
  const engine = exports.createCodeRipple(container, prefs)
  const tick = (delta = 35) => {
    now += delta
    const batch = [...frames]; frames.clear(); for (const [, fn] of batch) fn(now)
    const due = [...timers].filter(([, timer]) => timer.at <= now); for (const [id, timer] of due) { timers.delete(id); timer.fn() }
  }
  return { engine, container, doc, win, motion, frames, timers, observers, alive, deleted, prefs, tick, get now() { return now },
    get draws() { return drawCount }, get twoDraws() { return twoDraws }, get releases() { return releases }, get queries() { return queries }, get measureCalls() { return measureCalls },
    setFailure: (shader: boolean, link: boolean) => { shaderFails = shader; linkFails = link },
    get listeners() { return allTargets.reduce((sum, target) => sum + [...target.listeners.values()].reduce((total, set) => total + set.size, 0), 0) } }
}

test('real engine is bounded to 30fps, throttles reading rectangles, and disposes every owned resource', () => {
  const h = harness()
  assert.equal(h.container.children.length, 1)
  const canvas = h.container.children[0]!
  assert.ok(canvas.width * canvas.height <= 3_000_000)
  assert.equal(h.container.attributes.get('data-code-ripple-renderer'), 'webgl')
  assert.equal(h.alive.size, 4)
  const before = h.draws
  for (let i = 0; i < 120; i++) h.tick(1000 / 120)
  assert.ok(h.draws - before <= 30)
  assert.ok(h.measureCalls <= 2)
  h.engine.dispose(); h.engine.dispose()
  assert.equal(h.alive.size, 0); assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0); assert.equal(h.listeners, 0)
  assert.ok(h.observers.every(observer => !observer.active)); assert.equal(h.container.children.length, 0)
  assert.equal(h.container.attributes.get('unrelated'), 'kept'); assert.equal(h.container.attributes.has('data-code-ripple-frame'), false)
})

test('static, reduced motion and hidden documents keep no animation loop and resume without a catch-up burst', () => {
  const h = harness({ static: true })
  assert.equal(h.frames.size, 0)
  const first = h.draws; h.tick(5000); assert.equal(h.draws, first)
  h.engine.update({ ...h.prefs, static: false }); assert.equal(h.frames.size, 1)
  h.tick(); assert.ok(h.draws > first)
  h.doc.visibilityState = 'hidden'; h.doc.fire('visibilitychange')
  const hidden = h.draws; h.tick(50_000); assert.equal(h.draws, hidden); assert.equal(h.frames.size, 0)
  h.doc.visibilityState = 'visible'; h.doc.fire('visibilitychange'); h.tick()
  h.motion.matches = true; h.motion.fire('change'); assert.equal(h.frames.size, 0)
  const reduced = h.draws; h.tick(5000); assert.equal(h.draws, reduced)
  h.engine.dispose()
})

test('unchanged option updates do not redraw static or active fields', () => {
  for (const isStatic of [true, false]) {
    const h = harness({ static: isStatic }), first = h.draws
    for (let i = 0; i < 30; i++) h.engine.update({ ...h.prefs })
    assert.equal(h.draws, first)
    h.engine.dispose()
  }
})

test('static scroll invalidation eventually refreshes the veil without starting a continuous loop', () => {
  const h = harness({ static: true })
  assert.equal(h.measureCalls, 1)
  h.tick(200); h.doc.fire('scroll'); h.tick(16)
  assert.equal(h.measureCalls, 1)
  h.tick(700)
  assert.equal(h.measureCalls, 2)
  assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0)
  h.engine.dispose()
})

test('context loss stops CPU/render scheduling and failed restoration falls back to Canvas 2D', () => {
  const h = harness(), canvas = h.container.children[0]!
  let prevented = 0
  canvas.fire('webglcontextlost', { preventDefault: () => { prevented++ } })
  assert.equal(prevented, 1); assert.equal(h.frames.size, 0)
  assert.equal(h.container.attributes.get('data-code-ripple-state'), 'lost')
  const before = h.draws; h.tick(1000); assert.equal(h.draws, before)
  h.setFailure(false, true); canvas.fire('webglcontextrestored')
  assert.equal(h.container.attributes.get('data-code-ripple-renderer'), '2d')
  assert.equal(h.alive.size, 0); assert.equal(h.container.children.length, 1)
  h.tick(); assert.ok(h.twoDraws > 0)
  h.engine.dispose(); assert.equal(h.listeners, 0); assert.equal(h.frames.size, 0)
})

test('shader and linker failure release partial GPU allocations before using the 2D fallback', () => {
  for (const options of [{ shaderFails: true }, { linkFails: true }]) {
    const h = harness(options)
    assert.equal(h.container.attributes.get('data-code-ripple-renderer'), '2d')
    assert.equal(h.alive.size, 0)
    assert.ok(h.releases >= 1)
    h.engine.dispose(); assert.equal(h.listeners, 0)
  }
})

test('pointer interactions are passive and disabled interaction never takes over native gestures', () => {
  const h = harness()
  const event = { pointerType: 'mouse', pointerId: 1, isPrimary: true, button: 0, clientX: 200, clientY: 300,
    preventDefault: () => { throw new Error('Native pointer behavior must remain intact') }, stopPropagation: () => { throw new Error('Do not stop native propagation') } }
  h.doc.fire('pointerdown', event); h.tick(100); h.doc.fire('pointerdown', event)
  h.doc.fire('pointermove', event); h.tick(35); h.doc.fire('pointermove', { ...event, clientX: 250 }); h.tick(35)
  h.engine.update({ ...h.prefs, interactive: false })
  h.doc.fire('pointerdown', event); h.doc.fire('pointermove', event); h.doc.fire('pointerup', event)
  h.engine.dispose()
})

test('a browser with neither canvas renderer does not schedule an empty permanent loop', () => {
  const h = harness({ webgl: false, twoD: false })
  assert.equal(h.container.attributes.get('data-code-ripple-renderer'), 'unavailable')
  assert.equal(h.frames.size, 0)
  h.engine.dispose(); assert.equal(h.listeners, 0)
})
