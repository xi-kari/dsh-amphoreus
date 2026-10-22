import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import { ModuleKind, transpileModule } from 'typescript'
import * as heroes from '../src/shared/heroes.ts'

function harness() {
  const exports: Record<string, any> = {}, listeners = Array.from({ length: 4 }, () => new Set<() => void>())
  const attrs = new Map<string, string>(), surfaces: any[] = [], engines: any[] = []
  let dark = false, current = 'cyrene-session', seat: string | null = null
  const prefs = { enabled: false, intensity: .45, interactive: true }
  const state = { effectiveConfig: { codeBackground: prefs, grammar: { ambient: true }, wallpaper: { mode: 'none' } },
    bindings: [{ sessionId: current, skillName: 'amphoreus-cyrene' }, { sessionId: 'aglaea-session', skillName: 'amphoreus-aglaea' }] }
  const document = { body: { setAttribute: (name: string, value: string) => attrs.set(name, value), removeAttribute: (name: string) => attrs.delete(name) } }
  const code = transpileModule(readFileSync(new URL('../src/client/code-background.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(code, { exports, document, require: (name: string) => {
    if (name.endsWith('heroes.ts')) return heroes
    if (name.endsWith('code-background.ts')) return { CODE_BACKGROUND_DEFAULTS: { enabled: false, intensity: .45, interactive: true } }
    if (name.endsWith('visual-shell.ts')) return { mountCodeBackgroundSurface: () => {
      const node = { dataset: {}, style: { setProperty() {} }, removed: false, remove() { this.removed = true } }
      surfaces.push(node); return node
    } }
    if (name.endsWith('code-ripple-engine.ts')) return { createCodeRipple: (_node: any, options: any) => {
      const engine = { options, disposed: false, update(next: any) { this.options = next }, dispose() { this.disposed = true } }
      engines.push(engine); return engine
    } }
    if (name.endsWith('.css')) return { default: { root: 'code-background' } }
    throw new Error(name)
  } })
  const subscribe = (index: number) => (fn: () => void) => { listeners[index]!.add(fn); return () => listeners[index]!.delete(fn) }
  const inputs = { model: { getSnapshot: () => ({ state }), subscribe: subscribe(0) },
    sessions: { getSnapshot: () => ({ current }), subscribe: subscribe(1) },
    seat: { getSnapshot: () => seat, subscribe: subscribe(2) }, isDark: () => dark, subscribeTheme: subscribe(3) }
  const emit = (index = 0) => listeners[index]!.forEach(fn => fn())
  return { install: () => exports.installCodeBackground(inputs), prefs, state, surfaces, engines, attrs, listeners, emit,
    select(id: string, mirror: string | null) { current = id; seat = mirror; emit(1) },
    theme(value: boolean) { dark = value; emit(3) } }
}

test('code background stays independent of wallpaper and follows all seat accents including the global Cyrene binding', () => {
  assert.equal(new Set(heroes.HERO_VISUALS.map(hero => hero.palette.accent)).size, 13)
  const h = harness(), dispose = h.install()
  assert.equal(h.engines.length, 0)
  h.prefs.enabled = true; h.emit()
  assert.equal(h.engines.length, 1)
  assert.equal(h.engines[0].options.color, heroes.heroVisualById('cyrene')!.palette.accent)
  h.state.effectiveConfig.wallpaper.mode = 'preset'; h.emit()
  assert.equal(h.engines.length, 1)
  h.select('aglaea-session', 'aglaea')
  assert.equal(h.engines[0].options.color, heroes.heroVisualById('aglaea')!.palette.accent)
  for (const hero of heroes.HERO_VISUALS) {
    h.state.bindings.push({ sessionId: hero.heroId, skillName: hero.skill })
    h.select(hero.heroId, hero.heroId === 'cyrene' ? null : hero.heroId)
    assert.equal(h.engines[0].options.color, hero.palette.accent)
    assert.equal(h.surfaces[0].dataset.codeBackgroundSeat, hero.heroId)
  }
  h.theme(true); assert.equal(h.engines[0].options.dark, true)
  h.state.effectiveConfig.grammar.ambient = false; h.emit()
  assert.equal(h.engines[0].options.static, true)
  assert.equal(h.state.effectiveConfig.wallpaper.mode, 'preset')
  dispose()
  assert.equal(h.engines[0].disposed, true)
  assert.equal(h.surfaces[0].removed, true)
  assert.equal(h.attrs.size, 0)
  assert.ok(h.listeners.every(group => group.size === 0))
})

test('zero intensity, disable, hot replacement and disposal release the entire code layer without touching wallpaper', () => {
  const h = harness(); h.prefs.enabled = true
  const first = h.install()
  const second = h.install()
  assert.equal(h.engines[0].disposed, true)
  assert.equal(h.surfaces.filter(node => !node.removed).length, 1)
  first()
  assert.equal(h.engines[1].disposed, false)
  h.prefs.intensity = 0; h.emit()
  assert.equal(h.engines[1].disposed, true)
  h.prefs.intensity = .7; h.emit()
  assert.equal(h.engines.length, 3)
  h.prefs.enabled = false; h.emit()
  assert.equal(h.surfaces.filter(node => !node.removed).length, 0)
  assert.equal(h.attrs.size, 0)
  assert.equal(h.state.effectiveConfig.wallpaper.mode, 'none')
  second()
  assert.ok(h.listeners.every(group => group.size === 0))
})
