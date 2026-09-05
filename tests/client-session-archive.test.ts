import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { assertSessionUnarchived, createSessionArchiveAction } from '../src/client/session-archive.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test('stale actions reject an archived session while its unarchived branch remains usable', () => {
  assert.throws(() => assertSessionUnarchived('parent', ['parent']), /会话已归档，请新建会话继续/u)
  assert.doesNotThrow(() => assertSessionUnarchived('branch', ['parent']))
})

test('archiving the current blank session clears it once without creating another session', async () => {
  const calls: string[] = []
  let current: string | undefined = 'blank'
  const archive = createSessionArchiveAction({
    archive: async id => { calls.push(`archive:${id}`) },
    current: () => current,
    clear: () => { calls.push('clear'); current = undefined },
  })
  await archive('blank')
  assert.deepEqual(calls, ['archive:blank', 'clear'])
  assert.equal(current, undefined)
})

test('duplicate clicks share one operation, while different sessions can be archived independently', async () => {
  const gate = deferred()
  const calls: string[] = []
  const archive = createSessionArchiveAction({
    archive: async id => { calls.push(`archive:${id}`); await gate.promise },
    current: () => undefined,
    clear: () => assert.fail('no selected session to clear'),
  })
  const first = archive('one')
  assert.equal(archive('one'), first)
  const second = archive('two')
  await Promise.resolve()
  assert.deepEqual(calls, ['archive:one', 'archive:two'])
  gate.resolve()
  await Promise.all([first, second])
  assert.deepEqual(calls.sort(), ['archive:one', 'archive:two'])
})

test('a session selected while the archive is in flight remains selected', async () => {
  const gate = deferred()
  let current = 'old'
  const archive = createSessionArchiveAction({
    archive: async () => gate.promise,
    current: () => current,
    clear: () => assert.fail('the newly selected session must stay open'),
  })
  const attempt = archive('old')
  current = 'new'
  gate.resolve()
  await attempt
  assert.equal(current, 'new')
})

test('host archive failure preserves navigation and can be retried', async () => {
  let attempts = 0
  const calls: string[] = []
  const failure = new Error('host unavailable')
  const archive = createSessionArchiveAction({
    archive: async () => { if (++attempts === 1) throw failure },
    current: () => 'one',
    clear: () => { calls.push('clear') },
  })
  await assert.rejects(archive('one'), error => error === failure)
  assert.deepEqual(calls, [])
  await archive('one')
  assert.equal(attempts, 2)
  assert.deepEqual(calls, ['clear'])
})

test('client wiring archives only through the official Workspace service without cascade hiding branches', async () => {
  const source = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  const inject = /export const inject = \[([^\]]+)\]/u.exec(source)?.[1] ?? ''
  assert.match(inject, /'workspaces'/u)
  assert.match(inject, /'sessions'/u)
  assert.match(source, /inject: \(\): SeatBrowserInjected => \(\{[\s\S]*?archiveSession,/u)
  const start = source.indexOf('const archiveSession = createSessionArchiveAction(')
  const end = source.indexOf('\n  const sessionList', start)
  assert.ok(start >= 0 && end > start)
  const javascript = transpileModule(`${source.slice(start, end)}\nglobalThis.archiveSession = archiveSession`, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText
  const archived: string[] = []
  let current: string | undefined = 'blank'
  const context = vm.createContext({
    createSessionArchiveAction,
    ctx: {
      workspaces: { archiveSession: async (id: string) => { archived.push(id) } },
      sessions: { clear: () => { current = undefined } },
    },
    sessionsFace: { list: { getSnapshot: () => ({ current }) } },
    fetch: async () => assert.fail('session archive must not hide workbench branches or delete bindings'),
  })
  vm.runInContext(javascript, context)
  await context.archiveSession('blank')
  assert.deepEqual(archived, ['blank'])
  assert.equal(current, undefined)
})
