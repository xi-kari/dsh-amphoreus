import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from 'typescript'

const file = new URL('../src/client/workbench.tsx', import.meta.url)
const compiled = transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2024, jsx: JsxEmit.ReactJSX },
}).outputText
const requireSource = createRequire(file)

function observable<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next: T, notify = true) => { value = next; if (notify) for (const listener of listeners) listener() },
  }
}

test('real bridge entry synchronizes once per frame load and still publishes later state and reopened frames', () => {
  const effects: Array<() => undefined | (() => void)> = []
  const listeners = new Set<(event: unknown) => void>()
  const messages: Array<{ type: string; revision?: number }> = []
  const target = () => ({ postMessage: (message: { type: string; revision?: number }) => messages.push(message) })
  const frameRef = { current: { contentWindow: target() } }
  const origin = 'http://localhost'
  const module = { exports: {} as { useWorkbenchBridge: (frame: unknown, deps: unknown, handlers: unknown) => { onFrameLoad(): void } } }
  const hooks = {
    useRef: (current: unknown) => ({ current }),
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => undefined | (() => void)) => { effects.push(effect) },
  }
  const context = {
    console, module, exports: module.exports,
    require: (name: string) => name === 'react' ? hooks : name.endsWith('.css') ? {} : requireSource(name),
    window: {
      location: { origin },
      addEventListener: (type: string, listener: (event: unknown) => void) => { if (type === 'message') listeners.add(listener) },
      removeEventListener: (type: string, listener: (event: unknown) => void) => { if (type === 'message') listeners.delete(listener) },
    },
  }
  vm.runInNewContext(compiled, context)
  const snapshot = (revision: number) => ({ phase: 'ready', state: {
    revision, bindings: [], seats: [], observations: [], memory: [],
    effectiveConfig: { workbench: { cardTextLimit: 8000 } },
  } })
  const model = observable(snapshot(1))
  const list = observable({ current: undefined, byId: {} })
  const workspaces = observable({ seats: [], sessions: [], archivedSessionIds: [], assetsConfigured: false })
  const bridge = module.exports.useWorkbenchBridge(frameRef, {
    model, sessions: { list }, workspaces, setSeat() {},
  }, {})
  const cleanup = effects.map(effect => effect()).filter((value): value is () => void => typeof value === 'function')
  const ready = (source = frameRef.current.contentWindow) => {
    for (const listener of listeners) listener({ origin, source, data: { source: 'dsh-amphoreus', type: 'amphoreus:map-ready' } })
  }
  const states = () => messages.filter(message => message.type === 'amphoreus:state')
  const rosters = () => messages.filter(message => message.type === 'amphoreus:workspaces')
  try {
    messages.length = 0
    bridge.onFrameLoad()
    ready(); ready()
    assert.equal(states().length, 1)
    assert.equal(rosters().length, 1)
    model.set(snapshot(2))
    assert.equal(states().at(-1)?.revision, 2)
    assert.equal(states().length, 2)
    model.set(snapshot(3), false)
    bridge.onFrameLoad()
    ready(); ready()
    assert.equal(states().length, 3)
    assert.equal(states().at(-1)?.revision, 3)
    assert.equal(rosters().length, 2)
    const oldDocument = frameRef.current.contentWindow
    frameRef.current = { contentWindow: target() }
    model.set(snapshot(4), false)
    bridge.onFrameLoad()
    ready(oldDocument)
    assert.equal(states().length, 3)
    ready(); ready()
    assert.equal(states().length, 4)
    assert.equal(states().at(-1)?.revision, 4)
    assert.equal(rosters().length, 3)
  } finally {
    for (const dispose of cleanup.reverse()) dispose()
  }
})
