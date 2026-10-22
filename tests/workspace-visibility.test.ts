import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { activateSeatWorkspaces, requireWorkspaceVisibility } from '../src/host/workspace-visibility.ts'

test('workspace visibility rejects an unsupported host before mounting', () => {
  assert.throws(() => requireWorkspaceVisibility({ list: () => [] }), /Stock dsh-v0.2.1-rc.2/u)
  assert.throws(() => requireWorkspaceVisibility(undefined), /setHiddenByOwner/u)
})

test('enable restores only its owner; disable resolves current IDs and hides only exact seat directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'amph-visibility-'))
  try {
    const dir = join(root, 'seats', 'anaxa')
    await mkdir(dir, { recursive: true })
    const path = await realpath(dir)
    const writes: unknown[] = []
    const items = [{ id: 'seat-before', path }, { id: 'normal', path: root }, { id: 'child-project', path: join(path, 'project') }]
    const registry = { list: () => items, setHiddenByOwner: async (owner: string, ids: readonly string[]) => { writes.push([owner, ids]) } }
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
