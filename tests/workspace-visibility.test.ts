import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { activateSeatWorkspaces, requireWorkspaceRegistry } from '../src/host/workspace-visibility.ts'

test('stock host registry needs only the public workspace list capability', () => {
  const registry = { list: () => [] }
  assert.equal(requireWorkspaceRegistry(registry), registry)
  assert.throws(() => requireWorkspaceRegistry(undefined), /workspaceRegistry\.list/u)
  assert.throws(() => requireWorkspaceRegistry({ list: [] }), /workspaceRegistry\.list/u)
})

test('stock host activation and disposal preserve seat workspaces and session ownership', async () => {
  const items = [
    Object.freeze({ id: 'seat', path: '/unavailable/seat', sessionIds: Object.freeze(['active-session']), order: 1 }),
    Object.freeze({ id: 'project', path: '/user/project', sessionIds: Object.freeze(['ordinary-session']), order: 2 }),
  ]
  const before = structuredClone(items)
  let reads = 0
  const registry = {
    list() { reads += 1; return items },
    remove() { assert.fail('stock workspaces must not be removed') },
    update() { assert.fail('stock workspaces must not be rewritten') },
  }
  const disable = await activateSeatWorkspaces(requireWorkspaceRegistry(registry), [
    { heroId: 'anaxa', skillName: 'amphoreus-anaxa', dir: '/unavailable/seat' },
  ])
  await disable()
  assert.deepEqual(items, before)
  assert.equal(reads, 0)
})

test('enable restores only its owner; disable resolves current IDs and hides only exact seat directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amph-visibility-'))
  try {
    const dir = join(root, 'seats', 'anaxa')
    await mkdir(dir, { recursive: true })
    const path = await realpath(dir)
    const writes: unknown[] = []
    const items = [{ id: 'seat-before', path }, { id: 'normal', path: root }, { id: 'child-project', path: join(path, 'project') }]
    const registry = {
      items,
      writes,
      list() { return this.items },
      async setHiddenByOwner(owner: string, ids: readonly string[]) { this.writes.push([owner, ids]) },
    }
    const disable = await activateSeatWorkspaces(registry, [{ heroId: 'anaxa', skillName: 'amphoreus-anaxa', dir }])
    assert.deepEqual(writes, [['dsh-amphoreus', []]])
    items[0] = { id: 'seat-current', path }
    await disable()
    assert.deepEqual(writes[1], ['dsh-amphoreus', ['seat-current']])
    assert.equal(items.length, 3)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
