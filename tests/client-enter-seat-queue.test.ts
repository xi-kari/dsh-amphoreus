import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEnterSeatQueue } from '../src/client/enter-seat-queue.ts'

test('enter-seat queue takes once and preserves an optional dispatch draft', () => {
  const queue = createEnterSeatQueue()
  assert.equal(queue.take(), undefined)
  queue.set({ workspaceId: 'all', dispatchText: '整理一下日志' })
  assert.deepEqual(queue.take(), { workspaceId: 'all', dispatchText: '整理一下日志' })
  assert.equal(queue.take(), undefined)
})

test('enter-seat queue is last-write-wins and subscriptions are disposable', () => {
  const queue = createEnterSeatQueue()
  let changes = 0
  const dispose = queue.subscribe(() => { changes += 1 })
  queue.set({ workspaceId: 'seat:anaxa' })
  queue.set({ workspaceId: 'all' })
  assert.equal(changes, 2)
  assert.deepEqual(queue.take(), { workspaceId: 'all' })
  dispose()
  queue.set({ workspaceId: 'seat:aglaea' })
  assert.equal(changes, 2)
  assert.deepEqual(queue.take(), { workspaceId: 'seat:aglaea' })
})
