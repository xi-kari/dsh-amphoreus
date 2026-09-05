import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  currentOrdinaryWorkspace,
  orphanSeatWorkspacePath,
  sameWorkspacePath,
  syncWorkspaceSession,
  waitForReadySnapshot,
  withoutSeatWorkspaces,
  workspacePathKey,
} from '../src/client/workspace-routing.ts'

interface Workspace {
  readonly workspaceId: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

const workspace = (workspaceId: string, path: string, sessionIds: string[] = []): Workspace => ({
  workspaceId,
  path,
  sessionIds,
})

test('Workspace path keys fold separators and case only for Windows paths', () => {
  assert.equal(workspacePathKey('D:\\Work\\Seat\\'), 'd:/work/seat')
  assert.equal(sameWorkspacePath('D:\\Work\\Seat', 'd:/work/seat/'), true)
  assert.equal(sameWorkspacePath('\\\\Server\\Share\\Seat', '//server/share/seat/'), true)

  assert.equal(workspacePathKey('/srv/Seats/Anaxa/'), '/srv/Seats/Anaxa')
  assert.equal(sameWorkspacePath('/srv/Seats/Anaxa', '/srv/seats/anaxa'), false)
})

test('seat Workspace filtering preserves a case-distinct POSIX Workspace', () => {
  const rows = [
    workspace('seat-exact', '/srv/Seats/Anaxa'),
    workspace('ordinary-case-distinct', '/srv/seats/anaxa'),
    workspace('ordinary', '/srv/project'),
  ]
  assert.deepEqual(
    withoutSeatWorkspaces(rows, ['/srv/Seats/Anaxa']).map(item => item.workspaceId),
    ['ordinary-case-distinct', 'ordinary'],
  )
})

test('current Workspace selection never guesses another ordinary Workspace', () => {
  const rows = [
    workspace('ordinary-other', '/srv/other', ['session-other']),
    workspace('seat-current', '/srv/Seats/Anaxa', ['session-current']),
  ]
  const seatDirectories = ['/srv/Seats/Anaxa']

  assert.equal(
    currentOrdinaryWorkspace(rows, seatDirectories, 'session-current'),
    undefined,
  )
  assert.equal(
    currentOrdinaryWorkspace(rows, seatDirectories, 'session-other')?.workspaceId,
    'ordinary-other',
  )
  assert.equal(currentOrdinaryWorkspace(rows, seatDirectories, undefined), undefined)
})

function snapshotSource<T>(initial: T) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: (): T => snapshot,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish: (next: T): void => {
      snapshot = next
      for (const listener of listeners) listener()
    },
    listenerCount: (): number => listeners.size,
  }
}

test('Workspace routing waits for the authoritative baseline and releases its subscription', async () => {
  const source = snapshotSource<{ phase: 'pending' | 'ready'; state: 'loading' | 'idle'; items: Workspace[] }>({
    phase: 'pending', state: 'loading', items: [],
  })
  let resolved = false
  const ready = waitForReadySnapshot(source, '工作区').then(snapshot => {
    resolved = true
    return snapshot
  })
  await Promise.resolve()
  assert.equal(resolved, false)
  assert.equal(source.listenerCount(), 1)
  source.publish({ phase: 'ready', state: 'loading', items: [] })
  await Promise.resolve()
  assert.equal(resolved, false)
  source.publish({ phase: 'ready', state: 'idle', items: [workspace('project', '/srv/project', ['current'])] })
  assert.equal(currentOrdinaryWorkspace((await ready).items, [], 'current')?.workspaceId, 'project')
  assert.equal(source.listenerCount(), 0)
})

test('initialization errors and timeouts reject visibly without retaining listeners', async () => {
  const source = snapshotSource<{ phase: 'pending' | 'error'; error?: string }>({ phase: 'pending' })
  const ready = waitForReadySnapshot(source, '席位')
  source.publish({ phase: 'error', error: 'state unavailable' })
  await assert.rejects(ready, /席位 初始化失败：state unavailable/)
  assert.equal(source.listenerCount(), 0)

  const pending = snapshotSource({ phase: 'pending' as const })
  await assert.rejects(waitForReadySnapshot(pending, '工作区', 5), /工作区 初始化超时/)
  assert.equal(pending.listenerCount(), 0)
})

test('only a same-directory orphan is eligible for seat Workspace adoption', () => {
  const rows = [workspace('normal-owner', 'D:/project', ['normal'])]
  assert.equal(orphanSeatWorkspacePath(rows, 'normal', 'D:/seat', 'D:/seat'), undefined)
  assert.equal(orphanSeatWorkspacePath(rows, 'orphan', 'D:/seat', 'd:\\seat\\'), 'd:\\seat\\')
  assert.equal(orphanSeatWorkspacePath(rows, 'orphan', 'D:/project', 'D:/seat'), undefined)
  assert.equal(orphanSeatWorkspacePath(rows, 'orphan', '/srv/Seat', '/srv/seat'), undefined)
  assert.equal(orphanSeatWorkspacePath(rows, 'orphan', undefined, 'D:/seat'), undefined)
})

test('session membership is read back when the independent Workspace follow is late', async () => {
  const source = snapshotSource({ phase: 'ready' as const, state: 'idle', items: [workspace('seat', 'D:/seat')] })
  const calls: string[] = []
  await syncWorkspaceSession({
    list: source,
    create: async ({ path }) => {
      calls.push(path)
      const attached = workspace('seat', path, ['new-session'])
      source.publish({ ...source.getSnapshot(), items: [attached] })
      return attached
    },
  }, 'seat', 'new-session')
  assert.deepEqual(calls, ['D:/seat'])
  assert.equal(source.getSnapshot().items[0]?.sessionIds.includes('new-session'), true)

  await syncWorkspaceSession({ list: source, create: async () => { throw new Error('unexpected readback') } }, 'seat', 'new-session')
})

test('membership readback rejects a missing attachment or a replaced Workspace', async () => {
  const source = snapshotSource({ phase: 'ready' as const, items: [workspace('seat', 'D:/seat')] })
  for (const row of [workspace('seat', 'D:/seat'), workspace('replacement', 'D:/seat', ['new-session'])]) {
    await assert.rejects(syncWorkspaceSession({ list: source, create: async () => row }, 'seat', 'new-session', 5), /工作区关联(?:尚未完成| 初始化超时)/)
  }
  await assert.rejects(syncWorkspaceSession({ list: source, create: async () => source.getSnapshot().items[0]! }, 'missing', 'new-session'), /工作区已移除/)
})

test('a membership update arriving after the unary echo is awaited before opening may continue', async () => {
  const original = workspace('seat', 'D:/seat')
  const source = snapshotSource({ phase: 'ready' as const, items: [original] })
  let finished = false
  const synchronization = syncWorkspaceSession({ list: source, create: async () => original }, 'seat', 'new-session')
    .then(() => { finished = true })
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(finished, false)
  source.publish({ phase: 'ready', items: [workspace('seat', 'D:/seat', ['new-session'])] })
  await synchronization
  assert.equal(finished, true)
  assert.equal(source.listenerCount(), 0)
})
