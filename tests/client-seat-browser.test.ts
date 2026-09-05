import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import * as seatModel from '../src/client/seat-model.ts'
import * as workspaceRouting from '../src/client/workspace-routing.ts'
import { zh } from '../src/client/locales.ts'

interface Element {
  type: string
  props: Record<string, any>
}

const source = readFileSync(new URL('../src/client/seat-browser.tsx', import.meta.url), 'utf8')

function harness(options: {
  seats?: number
  directoryBlank?: boolean
  internalUnbound?: boolean
  start?: (skill: string) => Promise<string>
  open?: (id: string, skill?: string) => Promise<void>
  archive?: (id: string) => Promise<void>
  remove?: (workspaceId: string) => Promise<void>
  /** Put the bound seat sessions into the directory workspace too (what a conference does). */
  directoryHoldsSeats?: boolean
} = {}) {
  const state: unknown[] = []
  let cursor = 0
  const sessions = Object.fromEntries(Array.from({ length: options.seats ?? 0 }, (_, index) => [
    `seat-${index}`, { displayTitle: `Seat ${index}`, updatedAt: 100 - index, blank: index === 0 },
  ]))
  if (options.directoryBlank) sessions.blank = { displayTitle: '', updatedAt: 0, blank: true }
  if (options.internalUnbound) sessions['internal-blank'] = { displayTitle: 'Internal draft', updatedAt: 0, blank: true }
  const list = { ids: Object.keys(sessions), byId: sessions, current: 'seat-0' }
  const workspaces = {
    archivedSessionIds: [] as string[],
    items: [
      ...(options.directoryBlank ? [{ workspaceId: 'directory', title: 'Directory', path: 'D:/directory', sessionIds: ['blank', ...(options.directoryHoldsSeats ? Object.keys(sessions).filter(id => id.startsWith('seat-')) : [])] }] : []),
      ...(options.internalUnbound ? [{ workspaceId: 'internal', title: 'Cyrene', path: 'D:/seat-cyrene', sessionIds: ['internal-blank', ...Object.keys(sessions).filter(id => id.startsWith('seat-'))] }] : []),
    ],
  }
  const snapshot = {
    phase: 'ready',
    state: {
      seats: [{ skillName: 'amphoreus-cyrene', heroId: 'cyrene', displayName: '昔涟', status: 'deployed', order: 0 }],
      bindings: Object.keys(sessions).filter(id => id.startsWith('seat-')).map(sessionId => ({ sessionId, skillName: 'amphoreus-cyrene' })),
      seatDirs: options.internalUnbound ? [{ skillName: 'amphoreus-cyrene', dir: 'D:/seat-cyrene' }] : [],
      suite: { level: 'L1', cards: [] },
      effectiveConfig: { assetsConfigured: false },
    },
  }
  const runtime = {
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
      return [state[index], (next: unknown) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
    },
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in state)) state[index] = { current: initial }
      return state[index]
    },
    useSyncExternalStore(_subscribe: unknown, getSnapshot: () => unknown) { return getSnapshot() },
  }
  const jsx = (type: string, props: Element['props']) => ({ type, props })
  const modules: Record<string, unknown> = {
    react: runtime,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    './seat-model.ts': seatModel,
    './workspace-routing.ts': workspaceRouting,
    './seat-browser.module.css': { default: new Proxy({}, { get: (_target, key) => key }) },
  }
  const context = vm.createContext({
    Error, exports: {}, require: (id: string) => {
      assert.ok(id in modules, `unexpected dependency ${id}`)
      return modules[id]
    },
  })
  vm.runInContext(transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, jsx: JsxEmit.ReactJSX, esModuleInterop: false },
  }).outputText, context)
  const props = {
    wide: true, expandSidebar: () => {},
    useSessions: (selector: (value: typeof list) => unknown) => selector(list),
    useWorkspaces: (selector: (value: typeof workspaces) => unknown) => selector(workspaces),
    model: { subscribe: () => () => {}, getSnapshot: () => snapshot },
    openSession: options.open ?? (async () => {}), startSeatSession: options.start ?? (async () => 'new'), startDirectorySession: () => {},
    createDirectoryWorkspace: async () => {},
    removeDirectoryWorkspace: options.remove ?? (async () => {}),
    archiveSession: options.archive ?? (async () => {}),
    t: (key: keyof typeof zh) => zh[key],
  }
  return {
    workspaces,
    render: (): Element => { cursor = 0; return context.exports.SeatBrowser(props) },
  }
}

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (node === null || typeof node !== 'object' || !('props' in node)) return []
  const element = node as Element
  return [element, ...elements(element.props.children)]
}

function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join('')
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'object') return text((node as Element).props?.children)
  return String(node)
}

function button(tree: Element, label: string): Element {
  const found = elements(tree).find(item => item.type === 'button' && (item.props['aria-label'] === label || text(item.props.children) === label))
  assert.ok(found, `button missing: ${label}`)
  return found
}

const settle = () => new Promise(resolve => setImmediate(resolve))

test('all seat conversations, including blanks and entries after the first five, have visible archive controls', () => {
  const app = harness({ seats: 7 })
  elements(app.render()).find(item => item.type === 'button' && text(item.props.children).startsWith('昔涟'))!.props.onClick()
  let tree = app.render()
  assert.equal(elements(tree).filter(item => item.type === 'button' && String(item.props['aria-label']).startsWith('归档会话：')).length, 5)
  button(tree, '展开全部 7 段会话').props.onClick()
  tree = app.render()
  assert.equal(elements(tree).filter(item => item.type === 'button' && String(item.props['aria-label']).startsWith('归档会话：')).length, 7)
  assert.ok(button(tree, '归档会话：Seat 0'))
  assert.ok(button(tree, '归档会话：Seat 6'))
  button(tree, '只显示最近 5 段').props.onClick()
  assert.equal(elements(app.render()).filter(item => item.type === 'button' && String(item.props['aria-label']).startsWith('归档会话：')).length, 5)
})

test('directory blank conversations can be archived and archived IDs disappear', () => {
  const app = harness({ directoryBlank: true })
  assert.ok(button(app.render(), '归档会话：新对话'))
  app.workspaces.archivedSessionIds.push('blank')
  assert.equal(elements(app.render()).filter(item => item.type === 'button' && item.props['aria-label'] === '归档会话：新对话').length, 0)
})

test('archive confirmation can be cancelled, and repeat confirmation clicks send one request', async () => {
  let calls = 0
  let complete!: () => void
  const app = harness({ directoryBlank: true, archive: async id => {
    assert.equal(id, 'blank')
    calls += 1
    await new Promise<void>(resolve => { complete = resolve })
  } })
  button(app.render(), '归档会话：新对话').props.onClick()
  button(app.render(), '取消').props.onClick()
  assert.equal(calls, 0)
  button(app.render(), '归档会话：新对话').props.onClick()
  const confirm = button(app.render(), '确认归档')
  confirm.props.onClick()
  confirm.props.onClick()
  await settle()
  assert.equal(calls, 1)
  assert.equal(button(app.render(), '归档会话：新对话').props.disabled, true)
  complete()
  await settle()
  assert.equal(button(app.render(), '归档会话：新对话').props.disabled, false)
})

test('archive failure retains the conversation and a working retry action', async () => {
  let calls = 0
  const app = harness({ directoryBlank: true, archive: async id => {
    calls += 1
    if (calls === 1) throw new Error('temporarily offline')
    app.workspaces.archivedSessionIds.push(id)
  } })
  button(app.render(), '归档会话：新对话').props.onClick()
  button(app.render(), '确认归档').props.onClick()
  await settle()
  const tree = app.render()
  assert.match(text(tree), /temporarily offline/)
  assert.ok(button(tree, '归档会话：新对话'))
  button(tree, '重试').props.onClick()
  await settle()
  assert.equal(calls, 2)
  assert.equal(elements(app.render()).some(item => item.props.role === 'alert'), false)
  assert.equal(elements(app.render()).some(item => item.props['aria-label'] === '归档会话：新对话'), false)
})

test('rapid plus and empty-seat entry share one pending creation and allow another after it finishes', async () => {
  let calls = 0
  let complete!: (id: string) => void
  const app = harness({ start: async skill => {
    assert.equal(skill, 'amphoreus-cyrene')
    calls += 1
    return await new Promise<string>(resolve => { complete = resolve })
  } })
  const initial = app.render()
  const plus = button(initial, '在此席新建会话')
  const enter = elements(initial).find(item => item.type === 'button' && text(item.props.children).startsWith('昔涟'))!
  plus.props.onClick()
  plus.props.onClick()
  enter.props.onClick()
  await settle()
  assert.equal(calls, 1)
  assert.equal(button(app.render(), '在此席新建会话').props.disabled, true)
  assert.equal(elements(app.render()).find(item => item.type === 'button' && text(item.props.children).startsWith('昔涟'))!.props.disabled, true)
  complete('one')
  await settle()
  assert.equal(button(app.render(), '在此席新建会话').props.disabled, false)
  button(app.render(), '在此席新建会话').props.onClick()
  await settle()
  assert.equal(calls, 2)
  complete('two')
  await settle()
})

test('failed seat creation unlocks both controls so a new attempt can succeed', async () => {
  let calls = 0
  const app = harness({ start: async () => {
    if (++calls === 1) throw new Error('creation unavailable')
    return 'created'
  } })
  button(app.render(), '在此席新建会话').props.onClick()
  await settle()
  assert.match(text(app.render()), /creation unavailable/u)
  assert.equal(button(app.render(), '在此席新建会话').props.disabled, false)
  elements(app.render()).find(item => item.type === 'button' && text(item.props.children).startsWith('昔涟'))!.props.onClick()
  await settle()
  assert.equal(calls, 2)
  assert.equal(elements(app.render()).some(item => item.props.role === 'alert'), false)
})

test('unbound internal drafts are visible and open without a role, while bound and archived entries stay excluded', async () => {
  const opened: [string, string | undefined][] = []
  const app = harness({ seats: 1, internalUnbound: true, open: async (id, skill) => { opened.push([id, skill]) } })
  let tree = app.render()
  const group = elements(tree).find(item => item.props['data-group'] === 'unbound-sessions')!
  assert.ok(group)
  assert.match(text(group), /未绑定角色的对话/u)
  assert.equal(elements(group).filter(item => item.type === 'button' && String(item.props['aria-label']).startsWith('归档会话：')).length, 1)
  button(group, 'Internal draft').props.onClick()
  await settle()
  assert.deepEqual(opened, [['internal-blank', undefined]])
  assert.ok(button(tree, '归档会话：Internal draft'))
  app.workspaces.archivedSessionIds.push('internal-blank')
  tree = app.render()
  assert.equal(elements(tree).some(item => item.props['data-group'] === 'unbound-sessions'), false)
})

test('directory workspaces list only plain conversations; seat-bound sessions stay under their seats with a count note', () => {
  const app = harness({ seats: 3, directoryBlank: true, directoryHoldsSeats: true })
  const tree = app.render()
  const directories = elements(tree).find(item => item.props['data-group'] === 'directories')!
  const rows = elements(directories).filter(item => item.type === 'button' && String(item.props['aria-label']).startsWith('归档会话：'))
  assert.equal(rows.length, 1, 'only the blank plain conversation is archivable inside the directory')
  assert.match(text(directories), /3 段黄金裔会话已归入席位/u)
  const seats = elements(tree).find(item => item.props['data-group'] === 'seats')
  assert.ok(seats === undefined || elements(tree).some(item => item.type === 'button' && text(item.props.children).startsWith('昔涟')))
})

test('a directory workspace can be removed after confirmation through the official delete, once per click burst', async () => {
  let calls = 0
  let complete!: () => void
  const app = harness({ directoryBlank: true, remove: async id => {
    assert.equal(id, 'directory')
    calls += 1
    await new Promise<void>(resolve => { complete = resolve })
  } })
  button(app.render(), '移除目录工作区：Directory').props.onClick()
  button(app.render(), '取消').props.onClick()
  assert.equal(calls, 0)
  button(app.render(), '移除目录工作区：Directory').props.onClick()
  const confirm = button(app.render(), '确认移除')
  confirm.props.onClick()
  confirm.props.onClick()
  await settle()
  assert.equal(calls, 1)
  assert.equal(button(app.render(), '移除目录工作区：Directory').props.disabled, true)
  complete()
  await settle()
  assert.equal(button(app.render(), '移除目录工作区：Directory').props.disabled, false)
})

test('directory removal failure surfaces the error and keeps the directory listed', async () => {
  const app = harness({ directoryBlank: true, remove: async () => { throw new Error('workspace busy') } })
  button(app.render(), '移除目录工作区：Directory').props.onClick()
  button(app.render(), '确认移除').props.onClick()
  await settle()
  const tree = app.render()
  assert.match(text(tree), /workspace busy/u)
  assert.ok(button(tree, '移除目录工作区：Directory'))
})
