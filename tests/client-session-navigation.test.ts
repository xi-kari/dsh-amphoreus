import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import * as navigation from '../src/client/session-navigation.ts'
import * as seatModel from '../src/client/seat-model.ts'
import * as workspaceRouting from '../src/client/workspace-routing.ts'
import * as sessionAdapter from '../src/client/session-adapter.ts'
import { zh } from '../src/client/locales.ts'

test('navigation filters archived and hidden ownership, preserves ungrouped sessions and searches real metadata', () => {
  const rows = navigation.navigationSessions({
    sessions: { a: { displayTitle: 'Alpha 设计', updatedAt: 3 }, b: { displayTitle: 'Beta', updatedAt: 2 }, hidden: { displayTitle: 'Secret', updatedAt: 9 }, archived: { displayTitle: 'Old', updatedAt: 8 }, ungrouped: { displayTitle: 'Loose', updatedAt: 1 } },
    bindings: [{ sessionId: 'a', skillName: 'amphoreus-anaxa' }],
    roles: [{ skillName: 'amphoreus-anaxa', displayName: '那刻夏', deployed: true, hidden: false }],
    workspaces: [{ title: 'Notes', path: 'D:/notes', sessionIds: ['b'] }, { title: 'Hidden', path: 'D:/hidden', sessionIds: ['hidden'], hidden: true }],
    archived: ['archived'], untitled: 'Untitled',
  })
  assert.deepEqual(rows.map(row => row.id), ['a', 'b', 'ungrouped'])
  assert.deepEqual(navigation.filterNavigationSessions(rows, 'ＡＬＰＨＡ 那刻夏').map(row => row.id), ['a'])
  assert.deepEqual(navigation.filterNavigationSessions(rows, 'notes').map(row => row.id), ['b'])
  const merged = navigation.mergeMessageSearch(rows.slice(0, 1), rows, [{ sessionId: 'b', snippet: '<b>正文匹配</b>' }, { sessionId: 'hidden', snippet: 'private' }, { sessionId: 'a', snippet: 'match' }])
  assert.deepEqual(merged.map(row => row.id), ['a', 'b'])
  assert.equal(merged[1]!.snippet, '<b>正文匹配</b>')
})

test('pin storage contains only bounded unique IDs and survives invalid or unavailable storage', () => {
  let stored = ''
  const storage = { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value } }
  assert.equal(navigation.saveSessionPins(['a', 'a', 'b'], storage), true)
  assert.equal(stored, '["a","b"]')
  assert.deepEqual(navigation.readSessionPins(storage), ['a', 'b'])
  stored = '{broken'
  assert.deepEqual(navigation.readSessionPins(storage), [])
  assert.deepEqual(navigation.normalizeSessionPins(['a', { title: 'secret' }, '', '\n', ' b ', 'b']), ['a', 'b'])
  assert.equal(navigation.normalizeSessionPins(Array.from({ length: 400 }, (_, i) => `s-${i}`)).length, navigation.MAX_SESSION_PINS)
  assert.equal(navigation.saveSessionPins(['a'], { setItem() { throw new Error('unavailable') } }), false)
})

test('pin reorder uses IDs and target edges without changing the member set', () => {
  assert.deepEqual(navigation.reorderSessionPin(['a', 'b', 'c'], 'a', 'c', 'after'), ['b', 'c', 'a'])
  assert.deepEqual(navigation.reorderSessionPin(['a', 'b', 'c'], 'c', 'a', 'before'), ['c', 'a', 'b'])
  assert.deepEqual(navigation.reorderSessionPin(['a', 'b'], 'foreign', 'b', 'after'), ['a', 'b'])
  assert.deepEqual(navigation.reorderSessionPin(['a', 'b'], 'a', 'a', 'after'), ['a', 'b'])
  assert.deepEqual(navigation.setSessionPinned(['a', 'b'], 'a', false), ['b'])
})

interface Element { type: string; props: Record<string, any> }
const source = readFileSync(new URL('../src/client/seat-browser.tsx', import.meta.url), 'utf8')
const settle = () => new Promise(resolve => setImmediate(resolve))
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (value === null || typeof value !== 'object' || !('props' in value)) return []
  const node = value as Element
  return [node, ...nodes(node.props.children)]
}
function content(value: any): string { return Array.isArray(value) ? value.map(content).join('') : value?.props ? content(value.props.children) : value == null || typeof value === 'boolean' ? '' : String(value) }

function harness(searchMessages: (query: string, signal: AbortSignal) => Promise<navigation.MessageSearchResult> = async () => ({ items: [], hasMore: false })) {
  const slots: any[] = [], effects = new Map<number, { deps: unknown[]; cleanup?: () => void }>(), store = new Map<string, string>()
  let cursor = 0, writes = 0, changes = 0, created = 0
  const opened: string[] = []
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { writes++; store.set(key, value) } }
  const runtime = {
    useState(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (value: any) => { changes++; slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
    useRef(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index] },
    useSyncExternalStore(_subscribe: unknown, read: () => unknown) { return read() },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const index = cursor++, previous = effects.get(index)
      if (previous && deps.every((value, i) => value === previous.deps[i])) return
      previous?.cleanup?.(); effects.set(index, { deps, cleanup: effect() })
    },
  }
  const jsx = (type: string, props: Element['props']) => ({ type, props })
  const modules: Record<string, unknown> = {
    react: runtime, 'react/jsx-runtime': { jsx, jsxs: jsx }, './seat-model.ts': seatModel,
    './workspace-routing.ts': workspaceRouting, './session-adapter.ts': sessionAdapter,
    './session-navigation.ts': { ...navigation, readSessionPins: () => navigation.readSessionPins(storage), saveSessionPins: (ids: string[]) => navigation.saveSessionPins(ids, storage) },
    './seat-browser.module.css': { default: new Proxy({}, { get: (_target, key) => key }) },
  }
  const context = vm.createContext({ exports: {}, Error, AbortController, require: (id: string) => { assert.ok(id in modules, id); return modules[id] } })
  vm.runInContext(transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, jsx: JsxEmit.ReactJSX, esModuleInterop: false } }).outputText, context)
  const list = { ids: ['a', 'b', 'c'], byId: Object.fromEntries(['a', 'b', 'c'].map((id, i) => [id, { id, displayTitle: ['Alpha', 'Beta', 'Gamma'][i], updatedAt: 3 - i, blank: false, retainedBy: {} }])) }
  const workspaces = { items: [{ workspaceId: 'ordinary', title: 'Notes', path: 'D:/notes', sessionIds: ['c'] }], archivedSessionIds: [] as string[] }
  const snapshot = { phase: 'ready', state: { seats: [{ skillName: 'amphoreus-cyrene', heroId: 'cyrene', displayName: '昔涟', status: 'deployed', order: 0 }], bindings: ['a', 'b'].map(sessionId => ({ sessionId, skillName: 'amphoreus-cyrene' })), seatDirs: [], suite: { level: 'L1', cards: [] }, effectiveConfig: { assetsConfigured: false } } }
  const props = { wide: true, expandSidebar() {}, useSessions: (fn: any) => fn(list), useWorkspaces: (fn: any) => fn(workspaces), model: { subscribe: () => () => {}, getSnapshot: () => snapshot },
    openSession: async (id: string) => { opened.push(id) }, startSeatSession: async () => { created++; return 'new' }, startDirectorySession() { created++ }, createDirectoryWorkspace: async () => {}, removeDirectoryWorkspace: async () => {}, archiveSession: async () => {}, searchMessages,
    t: (key: keyof typeof zh, args: Record<string, string> = {}) => Object.entries(args).reduce((s, [name, value]) => s.replaceAll(`{${name}}`, value), zh[key]),
  }
  const render = (): Element => { cursor = 0; return context.exports.SeatBrowser(props) }
  const input = () => nodes(render()).find(node => node.type === 'input' && node.props.type === 'search')!
  const button = (label: string) => { const node = nodes(render()).find(node => node.type === 'button' && (node.props['aria-label'] === label || content(node.props.children) === label)); assert.ok(node, label); return node }
  const query = (value: string) => { input().props.onChange({ currentTarget: { value } }) }
  const pin = (title: string) => button(`固定「${title}」`).props.onClick()
  return { render, input, button, query, pin, props, list, workspaces, opened, stored: () => store.get(navigation.SESSION_PINS_KEY), writes: () => writes, changes: () => changes, created: () => created, unmount() { for (const effect of effects.values()) effect.cleanup?.() } }
}

test('typing, pinning and keyboard reordering never create or open a conversation', async () => {
  const app = harness()
  app.query('Alpha'); app.pin('Alpha')
  app.query('Beta'); app.pin('Beta')
  app.query('')
  assert.equal(app.stored(), '["a","b"]')
  app.button('调整「Alpha」的固定顺序').props.onKeyDown({ key: 'ArrowDown', altKey: true, preventDefault() {}, stopPropagation() {} })
  assert.equal(app.stored(), '["b","a"]')
  assert.equal(app.created(), 0)
  assert.deepEqual(app.opened, [])
  const pinned = nodes(app.render()).find(node => node.props['data-group'] === 'pinned')!
  nodes(pinned).find(node => node.type === 'button' && node.props.className === 'navigationOpen')!.props.onClick()
  await settle()
  assert.deepEqual(app.opened, ['b'])
  app.workspaces.archivedSessionIds.push('b')
  assert.equal(nodes(app.render()).some(node => node.props['data-pinned-session'] === 'b'), false)
  assert.equal(app.created(), 0)
})

test('message search uses Host results, filters stale IDs, exposes hasMore and opens only an explicit result', async () => {
  const calls: string[] = []
  const app = harness(async query => { calls.push(query); return { items: [{ sessionId: 'b', snippet: '<b>真实索引片段</b>' }, { sessionId: 'missing', snippet: 'stale' }], hasMore: true } })
  app.query('正文')
  assert.deepEqual(calls, [])
  nodes(app.render()).find(node => node.type === 'form')!.props.onSubmit({ preventDefault() {} })
  await settle()
  assert.deepEqual(calls, ['正文'])
  const rows = nodes(app.render()).filter(node => node.props['data-search-session'])
  assert.deepEqual(rows.map(row => row.props['data-search-session']), ['b'])
  assert.ok(content(rows[0]).includes('<b>真实索引片段</b>'))
  assert.equal(nodes(rows[0]).some(node => 'dangerouslySetInnerHTML' in node.props), false)
  assert.ok(content(app.render()).includes(zh['seats.searchHasMore']))
  assert.deepEqual(app.opened, [])
  rows[0]!.props.onClick(); await settle()
  assert.deepEqual(app.opened, ['b'])
  assert.equal(app.created(), 0)
  assert.equal(app.writes(), 0)
})

test('message search failure stays distinct from no matches and remains retryable', async () => {
  let attempts = 0
  const app = harness(async () => {
    if (attempts++ === 0) throw new Error('legacy index unavailable')
    return { items: [{ sessionId: 'b', snippet: 'recovered index' }], hasMore: false }
  })
  app.query('needle')
  nodes(app.render()).find(node => node.type === 'form')!.props.onSubmit({ preventDefault() {} })
  await settle()
  assert.ok(content(app.render()).includes(zh['seats.searchUnavailable']))
  assert.equal(content(app.render()).includes(zh['seats.searchEmpty']), false)
  assert.ok(content(app.render()).includes('legacy index unavailable'))
  nodes(app.render()).find(node => node.type === 'form')!.props.onSubmit({ preventDefault() {} })
  await settle()
  assert.equal(nodes(app.render()).some(node => node.props.role === 'alert'), false)
  assert.ok(content(app.render()).includes('recovered index'))
  assert.equal(app.created(), 0)
})

test('query changes and unmount abort pending searches and ignore late results', async () => {
  const pending: Array<{ signal: AbortSignal; resolve: (value: navigation.MessageSearchResult) => void }> = []
  const app = harness(async (_query, signal) => new Promise(resolve => pending.push({ signal, resolve })))
  app.query('first'); nodes(app.render()).find(node => node.type === 'form')!.props.onSubmit({ preventDefault() {} }); await settle()
  app.query('second'); assert.equal(pending[0]!.signal.aborted, true)
  nodes(app.render()).find(node => node.type === 'form')!.props.onSubmit({ preventDefault() {} }); await settle()
  pending[0]!.resolve({ items: [{ sessionId: 'a', snippet: 'old' }], hasMore: false }); await settle()
  assert.equal(nodes(app.render()).some(node => node.props['data-search-session'] === 'a'), false)
  app.unmount(); assert.equal(pending[1]!.signal.aborted, true)
  const changes = app.changes()
  pending[1]!.resolve({ items: [{ sessionId: 'b', snippet: 'late' }], hasMore: false }); await settle()
  assert.equal(app.changes(), changes)
  assert.deepEqual(app.opened, [])
})

class Target {
  callbacks = new Map<string, Set<(event: any) => void>>()
  captured: number | null = null
  ownerDocument: Target = this
  addEventListener(type: string, fn: (event: any) => void) { const set = this.callbacks.get(type) ?? new Set(); set.add(fn); this.callbacks.set(type, set) }
  removeEventListener(type: string, fn: (event: any) => void) { this.callbacks.get(type)?.delete(fn) }
  setPointerCapture(id: number) { this.captured = id }
  releasePointerCapture() { this.captured = null }
  focus() {}
  emit(type: string, fields: Record<string, unknown>) { const event = { type, pointerId: 1, isPrimary: true, button: 0, clientX: 180, clientY: 20, preventDefault() {}, stopPropagation() {}, ...fields }; for (const fn of [...(this.callbacks.get(type) ?? [])]) fn(event); return event }
}

test('real pin drag helper enforces deadzone, ignores external drops and releases every cancellation path', () => {
  for (const finish of ['drop', 'outside', 'Escape', 'pointercancel', 'lostpointercapture', 'dispose']) {
    const handle = new Target(), doc = handle.ownerDocument = new Target(), commits: navigation.PinDropTarget[] = []
    const event = handle.emit('pointerdown', {})
    const stop = navigation.beginSessionPinDrag(event as unknown as PointerEvent, handle as unknown as HTMLElement, { id: 'a',
      rows: () => [{ id: 'a', left: 0, right: 200, top: 0, bottom: 40 }, { id: 'b', left: 0, right: 200, top: 40, bottom: 80 }], preview() {}, commit: target => commits.push(target), finish() {} })
    doc.emit('pointermove', { clientX: 182, clientY: 21 }); assert.equal(commits.length, 0)
    doc.emit('pointermove', { clientY: 70 })
    if (finish === 'drop') doc.emit('pointerup', { clientY: 70 })
    else if (finish === 'outside') doc.emit('pointerup', { clientX: 500, clientY: 70 })
    else if (finish === 'Escape') doc.emit('keydown', { key: 'Escape' })
    else if (finish === 'lostpointercapture') handle.emit(finish, {})
    else if (finish === 'dispose') stop()
    else doc.emit(finish, {})
    assert.deepEqual(commits, finish === 'drop' ? [{ id: 'b', edge: 'after' }] : [])
    assert.equal(handle.captured, null)
    assert.ok([...doc.callbacks.values()].every(set => set.size === 0))
  }
})
