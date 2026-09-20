import assert from 'node:assert/strict'
import { test } from 'node:test'
import { subscribeRetainedSession } from '../src/client/retained-subscription.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function settle(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve))
}

function fixture() {
  const ready = deferred<string>()
  const trace: string[] = []
  const errors: unknown[] = []
  const dispose = subscribeRetainedSession(
    () => {
      trace.push('retain')
      return { ready: ready.promise, release: () => { trace.push('release') } }
    },
    binding => {
      trace.push(`connect:${binding}`)
      return () => { trace.push(`detach:${binding}`) }
    },
    error => { errors.push(error) },
  )
  return { ready, trace, errors, dispose }
}

test('retains immediately, connects only after ready, and synchronously detaches before one release', async () => {
  const row = fixture()
  assert.deepEqual(row.trace, ['retain'])
  await settle()
  assert.deepEqual(row.trace, ['retain'])
  row.ready.resolve('one')
  await settle()
  assert.deepEqual(row.trace, ['retain', 'connect:one'])
  row.dispose()
  assert.deepEqual(row.trace, ['retain', 'connect:one', 'detach:one', 'release'])
  row.dispose()
  assert.deepEqual(row.trace, ['retain', 'connect:one', 'detach:one', 'release'])
  assert.deepEqual(row.errors, [])
})

test('disposing a pending reference releases immediately and prevents a late connection', async () => {
  const row = fixture()
  row.dispose()
  row.dispose()
  assert.deepEqual(row.trace, ['retain', 'release'])
  row.ready.resolve('late')
  await settle()
  assert.deepEqual(row.trace, ['retain', 'release'])
  assert.deepEqual(row.errors, [])
})

test('switching subscriptions never connects the stale binding or releases the new reference', async () => {
  const previous = fixture()
  previous.dispose()
  const current = fixture()
  current.ready.resolve('current')
  previous.ready.resolve('stale')
  await settle()
  assert.deepEqual(previous.trace, ['retain', 'release'])
  assert.deepEqual(current.trace, ['retain', 'connect:current'])
  current.dispose()
  assert.deepEqual(current.trace, ['retain', 'connect:current', 'detach:current', 'release'])
})

test('active readiness failures release once and report the original error', async () => {
  const row = fixture()
  const error = new Error('binding unavailable')
  row.ready.reject(error)
  await settle()
  assert.deepEqual(row.trace, ['retain', 'release'])
  assert.deepEqual(row.errors, [error])
  row.dispose()
  assert.deepEqual(row.trace, ['retain', 'release'])
})

test('readiness cancellation after disposal does not report an obsolete subscription error', async () => {
  const row = fixture()
  row.dispose()
  row.ready.reject(new DOMException('Reference released', 'AbortError'))
  await settle()
  assert.deepEqual(row.trace, ['retain', 'release'])
  assert.deepEqual(row.errors, [])
})

test('connection failures release once and report the original error', async () => {
  const error = new Error('feed unavailable')
  const errors: unknown[] = []
  let released = 0
  const dispose = subscribeRetainedSession(
    () => ({ ready: Promise.resolve('one'), release: () => { released += 1 } }),
    () => { throw error },
    value => { errors.push(value) },
  )
  await settle()
  assert.equal(released, 1)
  assert.deepEqual(errors, [error])
  dispose()
  assert.equal(released, 1)
})

test('retention failure reports synchronously and returns an idempotent disposer', () => {
  const error = new Error('unknown session')
  const errors: unknown[] = []
  const dispose = subscribeRetainedSession(
    () => { throw error },
    () => { assert.fail('must not connect') },
    value => { errors.push(value) },
  )
  assert.deepEqual(errors, [error])
  dispose()
  dispose()
})

test('a throwing detach still releases synchronously and is not swallowed', async () => {
  const error = new Error('detach failed')
  let released = 0
  const dispose = subscribeRetainedSession(
    () => ({ ready: Promise.resolve('one'), release: () => { released += 1 } }),
    () => () => { throw error },
    assert.fail,
  )
  await settle()
  assert.throws(dispose, value => value === error)
  assert.equal(released, 1)
  dispose()
  assert.equal(released, 1)
})

test('connection and release failures are both reported', async () => {
  const connectError = new Error('connect failed')
  const releaseError = new Error('release failed')
  const errors: unknown[] = []
  const dispose = subscribeRetainedSession(
    () => ({ ready: Promise.resolve('one'), release: () => { throw releaseError } }),
    () => { throw connectError },
    error => { errors.push(error) },
  )
  await settle()
  assert.equal(errors.length, 1)
  assert.ok(errors[0] instanceof AggregateError)
  assert.deepEqual(errors[0].errors, [connectError, releaseError])
  dispose()
})

test('reentrant disposal during connection detaches the returned subscription', async () => {
  const trace: string[] = []
  const dispose = subscribeRetainedSession(
    () => ({ ready: Promise.resolve('one'), release: () => { trace.push('release') } }),
    () => {
      dispose()
      return () => { trace.push('detach') }
    },
    assert.fail,
  )
  await settle()
  assert.deepEqual(trace, ['release', 'detach'])
  dispose()
  assert.deepEqual(trace, ['release', 'detach'])
})
