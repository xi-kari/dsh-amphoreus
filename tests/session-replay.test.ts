import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspectColdSession, listColdHeaders, type ColdPersistence } from '../src/host/session-replay.ts'

const header = { id: 'session-one', cwd: 'D:/workspace' }
const events = [{ type: 'user', seq: 0, time: 1 }]

test('legacy persistence preserves headers and inherited events', async () => {
  const signal = new AbortController().signal
  const persistence: ColdPersistence = {
    async list(received) { assert.equal(received, signal); return [header] },
    async inspect(id, received) {
      assert.equal(id, header.id)
      assert.equal(received, signal)
      return { meta: header, inheritedEventCount: 1, events }
    },
  }
  assert.deepEqual(await listColdHeaders(persistence, signal), [header])
  assert.deepEqual(await inspectColdSession(persistence, header.id, signal), {
    meta: header, inheritedEventCount: 1, events,
  })
})

for (const readShape of ['array', 'detached', 'shared-frozen'] as const) {
  for (const failRead of [false, true]) {
    test(`${readShape} handle persistence releases read ownership when read ${failRead ? 'fails' : 'succeeds'}`, async () => {
      const signal = new AbortController().signal
      let closed = 0
      const persistence: ColdPersistence = {
        async list(options) { assert.equal(options?.signal, signal); return [{ header }] },
        async open(id, access, options) {
          assert.equal(id, header.id)
          assert.equal(access, 'read')
          assert.equal(options?.signal, signal)
          return {
            header, inheritedEventCount: 1,
            async read(offset, length, options) {
              assert.equal(offset, undefined)
              assert.equal(length, undefined)
              assert.equal(options?.signal, signal)
              if (failRead) throw new Error('read failed')
              return readShape === 'array' ? events : { eventState: readShape, events }
            },
            async close() { closed += 1 },
          }
        },
      }
      assert.deepEqual(await listColdHeaders(persistence, signal), [header])
      if (failRead) await assert.rejects(inspectColdSession(persistence, header.id, signal), /read failed/)
      else assert.deepEqual(await inspectColdSession(persistence, header.id, signal), {
        meta: header, inheritedEventCount: 1, events,
      })
      assert.equal(closed, 1)
    })
  }
}
