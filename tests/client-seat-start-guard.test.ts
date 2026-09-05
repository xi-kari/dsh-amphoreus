import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeatStartGuard } from '../src/client/seat-start-guard.ts'

test('a start in flight is busy; a second run for the same skill is skipped, other skills proceed', async () => {
  let release: (() => void) | undefined
  const guard = createSeatStartGuard({ hasSession: () => false, now: () => 0 })
  const first = guard.run('a', () => new Promise<void>(resolve => { release = resolve }))
  assert.equal(guard.isBusy('a'), true)
  assert.equal(guard.isBusy('b'), false)
  let calls = 0
  assert.equal(await guard.run('a', async () => { calls += 1 }), false)
  assert.equal(await guard.run('b', async () => { calls += 1 }), true)
  assert.equal(calls, 1)
  release?.()
  assert.equal(await first, true)
})

test('after a start resolves the skill stays busy until the snapshot shows a session or the settle window elapses', async () => {
  let clock = 1000
  let visible = false
  const guard = createSeatStartGuard({ hasSession: () => visible, settleMs: 500, now: () => clock })
  assert.equal(await guard.run('a', async () => {}), true)
  assert.equal(guard.isBusy('a'), true, 'snapshot not refreshed yet → still busy')
  visible = true
  assert.equal(guard.isBusy('a'), false, 'snapshot shows the session → released')
  // Timeout path: snapshot never refreshes (e.g. SSE dropped) — do not wedge the seat forever.
  visible = false
  assert.equal(await guard.run('a', async () => {}), true)
  clock += 499
  assert.equal(guard.isBusy('a'), true)
  clock += 1
  assert.equal(guard.isBusy('a'), false)
})

test('a failed start releases the skill immediately so the user can retry', async () => {
  const guard = createSeatStartGuard({ hasSession: () => false, now: () => 0 })
  await assert.rejects(guard.run('a', async () => { throw new Error('boom') }), /boom/u)
  assert.equal(guard.isBusy('a'), false)
  assert.equal(await guard.run('a', async () => {}), true)
})
