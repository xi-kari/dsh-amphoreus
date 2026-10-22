import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { JsxEmit, ModuleKind, transpileModule } from 'typescript'
import { CODE_BACKGROUND_DEFAULTS } from '../src/shared/code-background.ts'
import { AmphoreusClientModel } from '../src/client/state.ts'
import { en, zh } from '../src/client/locales.ts'

function flatten(tree: any): any[] {
  return Array.isArray(tree) ? tree.flatMap(flatten) : tree && typeof tree === 'object' ? [tree, ...flatten(tree.props?.children)] : []
}

function harness() {
  const exports: Record<string, any> = {}
  const hooks: any[] = []
  const timers = new Map<number, () => void>()
  let timerId = 0, cursor = 0, changed = false
  let effects: Array<() => void> = []
  const code = transpileModule(readFileSync(new URL('../src/client/code-background-panel.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX },
  }).outputText
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props })
  const react = {
    useState(initial: any) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = initial
      return [hooks[index], (value: any) => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; changed = true }]
    },
    useRef(initial: any) { const index = cursor++; return hooks[index] ??= { current: initial } },
    useEffect(callback: () => (() => void) | void, dependencies: any[]) {
      const index = cursor++
      if (!hooks[index] || dependencies.some((value, i) => value !== hooks[index].dependencies[i])) {
        effects.push(() => { hooks[index]?.cleanup?.(); hooks[index] = { dependencies, cleanup: callback() } })
      }
    },
  }
  vm.runInNewContext(code, { exports, window: {
    setTimeout(callback: () => void) { const id = ++timerId; timers.set(id, callback); return id },
    clearTimeout(id: number) { timers.delete(id) },
  }, require(name: string) {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name === 'react') return react
    if (name.endsWith('/code-background.ts')) return { CODE_BACKGROUND_DEFAULTS }
    if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) }
    throw new Error(`Unexpected import ${name}`)
  } })
  return {
    render(props: any) {
      let tree: any
      for (let round = 0; round < 10; round++) {
        changed = false; cursor = 0; effects = []
        tree = exports.CodeBackgroundPanel(props)
        for (const effect of effects) effect()
        if (!changed) break
      }
      return tree
    },
    timers,
    flush() { for (const [id, callback] of [...timers]) { timers.delete(id); callback() } },
    unmount() { for (const hook of hooks) hook?.cleanup?.() },
  }
}

function props(overrides: object = {}) {
  return { prefs: CODE_BACKGROUND_DEFAULTS, busy: false, t: (key: keyof typeof zh) => zh[key], onPatch: (_patch: unknown) => {}, ...overrides }
}

function control(tree: any, id: string) {
  const found = flatten(tree).find(node => node.props.id === `amphoreus-code-background-${id}`)
  assert.ok(found, id)
  return found.props
}

test('actual code background controls default off and preserve disabled values', () => {
  const h = harness()
  let tree = h.render(props())
  assert.equal(control(tree, 'enabled').checked, false)
  assert.equal(control(tree, 'enabled').disabled, false)
  assert.equal(control(tree, 'intensity').value, 45)
  assert.equal(control(tree, 'intensity').disabled, true)
  assert.equal(control(tree, 'interactive').checked, true)
  assert.equal(control(tree, 'interactive').disabled, true)
  tree = h.render(props({ prefs: { enabled: true, intensity: 0.8, interactive: false }, busy: true }))
  for (const id of ['enabled', 'intensity', 'interactive']) assert.equal(control(tree, id).disabled, true)
  assert.equal(control(tree, 'intensity').value, 80)
  assert.equal(control(tree, 'interactive').checked, false)
  h.unmount()
})

test('actual code background controls coalesce slider changes and switches into one independent preference patch', () => {
  const h = harness(), patches: any[] = []
  const input = props({ onPatch: (patch: any) => patches.push(patch) })
  let tree = h.render(input)
  control(tree, 'enabled').onChange({ currentTarget: { checked: true } })
  tree = h.render(input)
  assert.equal(control(tree, 'intensity').disabled, false)
  control(tree, 'intensity').onChange({ currentTarget: { value: '25' } })
  control(tree, 'intensity').onChange({ currentTarget: { value: '60' } })
  control(tree, 'interactive').onChange({ currentTarget: { checked: false } })
  tree = h.render(input)
  assert.equal(control(tree, 'intensity').value, 60)
  assert.equal(h.timers.size, 1)
  assert.equal(patches.length, 0)
  h.flush()
  assert.deepEqual(JSON.parse(JSON.stringify(patches)), [{ enabled: true, intensity: 0.6, interactive: false }])
  h.unmount()
})

test('code background reset cancels pending changes and unmount cannot write a delayed override', () => {
  const h = harness(), patches: any[] = []
  const input = props({ prefs: { enabled: true, intensity: 0.8, interactive: false }, onPatch: (patch: any) => patches.push(patch) })
  let tree = h.render(input)
  control(tree, 'intensity').onChange({ currentTarget: { value: '100' } })
  flatten(tree).find(node => node.type === 'button')!.props.onClick()
  tree = h.render(input)
  assert.equal(control(tree, 'enabled').checked, false)
  assert.equal(control(tree, 'intensity').value, 45)
  h.flush()
  assert.deepEqual(patches, [null])
  control(tree, 'enabled').onChange({ currentTarget: { checked: true } })
  assert.equal(h.timers.size, 1)
  h.unmount(); h.flush()
  assert.deepEqual(patches, [null])
})

test('code background copy is localized and describes wallpaper layering and static motion', () => {
  const keys = Object.keys(zh).filter(key => key.startsWith('settings.codeBackground')) as (keyof typeof zh)[]
  assert.equal(keys.length, 7)
  for (const key of keys) { assert.ok(zh[key]); assert.ok(en[key]) }
  assert.match(zh['settings.codeBackgroundHint'], /壁纸叠加/u)
  assert.match(en['settings.codeBackgroundMotion'], /reduced motion/u)
  const source = readFileSync(new URL('../src/client/settings.tsx', import.meta.url), 'utf8')
  assert.match(source, /<CodeBackgroundPanel/u)
  assert.match(source, /model\.setCodeBackgroundPrefs\(patch\)/u)
})

test('client model persists only code background, refreshes success, and surfaces failure without an optimistic state', async () => {
  const names = ['window', 'fetch']
  const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
  const calls: { url: string; init?: RequestInit }[] = []
  let fail = false
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { __AMPHOREUS_BOOT__: { nonce: 'code-test' }, setTimeout, clearTimeout } })
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) })
    if (init?.method === 'PUT') return new Response('{}', { status: fail ? 400 : 200 })
    return Response.json({ nonce: 'code-test', assets: { running: false }, effectiveConfig: { codeBackground: { enabled: true, intensity: 0.5, interactive: false } } })
  } })
  const model = new AmphoreusClientModel()
  try {
    await model.setCodeBackgroundPrefs({ enabled: true, intensity: 0.5 })
    assert.equal(calls.length, 2)
    assert.equal(calls[0]!.url, '/amphoreus/api/prefs')
    assert.equal(calls[0]!.init!.credentials, 'include')
    assert.equal(new Headers(calls[0]!.init!.headers).get('x-amphoreus-nonce'), 'code-test')
    assert.deepEqual(JSON.parse(String(calls[0]!.init!.body)), { codeBackground: { enabled: true, intensity: 0.5 } })
    assert.equal(calls[1]!.url, '/amphoreus/api/state')
    assert.equal(model.getSnapshot().state?.effectiveConfig.codeBackground?.enabled, true)
    const before = model.getSnapshot()
    fail = true
    await assert.rejects(model.setCodeBackgroundPrefs({ interactive: true }), /HTTP 400/u)
    assert.equal(calls.length, 3)
    assert.equal(model.getSnapshot(), before)
    fail = false
    await model.setCodeBackgroundPrefs(null)
    assert.deepEqual(JSON.parse(String(calls[3]!.init!.body)), { codeBackground: null })
  } finally {
    model.close()
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
})
