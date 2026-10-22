import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStateChannel } from '../src/client/state-channel.ts'

test('a pending first state request does not hold the plugin disposer', async () => {
  let reject!: (error: Error) => void
  let closes = 0
  const errors: unknown[] = []
  const dispose = openStateChannel({ start: () => new Promise((_resolve, fail) => { reject = fail }), close: () => { closes++ } }, error => errors.push(error))
  assert.equal(typeof dispose, 'function')
  dispose(); dispose()
  assert.equal(closes, 1)
  reject(new Error('aborted on disable'))
  await Promise.resolve()
  assert.deepEqual(errors, [])
})

test('an active startup failure is reported and a new activation has its own lifecycle', async () => {
  const failure = new Error('unavailable state channel')
  const errors: unknown[] = []
  let closes = 0, starts = 0
  const model = { start: async () => { starts++; throw failure }, close: () => { closes++ } }
  const first = openStateChannel(model, error => errors.push(error))
  await Promise.resolve()
  assert.deepEqual(errors, [failure])
  first()
  const second = openStateChannel({ start: async () => { starts++ }, close: () => { closes++ } }, error => errors.push(error))
  await Promise.resolve()
  second()
  assert.equal(starts, 2)
  assert.equal(closes, 2)
})
