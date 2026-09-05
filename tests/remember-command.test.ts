import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
import { registerRememberCommand, registerSeatMemory, installedSeatMemoryReader } from '../src/host/memory.ts'
import type { AmphoreusStores, BindingRecord, MemoryRecord } from '../src/host/store.ts'
import type { SuiteSnapshot } from '../src/host/suite/types.ts'
import { fixtureConfig, fixtureSnapshot } from './fixture-suite.ts'

const SESSION_A = 'session-00000000-0000-4000-8000-00000000000a'
const SESSION_B = 'session-00000000-0000-4000-8000-00000000000b'

function tables() {
  const memory = new Map<string, MemoryRecord>()
  const bindings = new Map<string, BindingRecord>()
  const seats = new Map<string, unknown>()
  const wrap = <T>(map: Map<string, T>) => ({
    get: (key: string) => map.get(key),
    entries: () => map.entries(),
    put: async (key: string, value: T) => { map.set(key, value) },
    update: async (key: string, transform: (current: T) => T) => {
      const current = map.get(key)
      if (current === undefined) throw Object.assign(new Error('missing-key'), { code: 'missing-key' })
      const next = transform(current)
      map.set(key, next)
      return next
    },
    delete: async (key: string) => map.delete(key),
  })
  const stores = {
    main: {
      table: (name: string) => {
        if (name === 'memory') return wrap(memory)
        if (name === 'bindings') return wrap(bindings)
        if (name === 'seats') return wrap(seats)
        throw new Error(`unexpected table: ${name}`)
      },
    },
  } as unknown as AmphoreusStores
  return { memory, bindings, seats, stores }
}

function fakeContext(options: { registerThrows?: Error } = {}) {
  const registered: CommandDefinition[] = []
  const warnings: string[] = []
  let disposed = 0
  const listeners = new Map<string, number>()
  const ctx = {
    logger: { warn: (message: string) => { warnings.push(message) } },
    sessions: { list: () => [] },
    on: (name: string) => {
      listeners.set(name, (listeners.get(name) ?? 0) + 1)
      return () => { listeners.set(name, (listeners.get(name) ?? 1) - 1) }
    },
    commands: {
      register: (definition: CommandDefinition) => {
        if (options.registerThrows !== undefined) throw options.registerThrows
        registered.push(definition)
        return () => { disposed++ }
      },
    },
  } as unknown as Context
  return { ctx, registered, warnings, listeners, disposed: () => disposed }
}

function invocation(sessionId: string, rawInput: string): CommandInvocation {
  return { commandId: 'cmd-1', agent: { session: { id: sessionId } }, rawInput, attachments: [], signal: new AbortController().signal } as unknown as CommandInvocation
}

test('/remember registers under the configured name and appends a user note to the bound seat', async () => {
  const { memory, bindings, stores } = tables()
  bindings.set(SESSION_A, { sessionId: SESSION_A, skillName: 'amphoreus-testcard-a', boundAt: 1, source: 'seat-new', injection: { state: 'done' } })
  const snapshot = fixtureSnapshot()
  const { ctx, registered, disposed } = fakeContext()
  const dispose = registerRememberCommand(ctx, { config: fixtureConfig(), stores, current: () => snapshot })
  assert.equal(registered.length, 1)
  const definition = registered[0]!
  assert.equal(definition.name, 'remember')
  assert.ok(definition.description.length > 0)
  assert.equal(typeof definition.input?.hint, 'string')

  const ok = await definition.handler(invocation(SESSION_A, '  开拓者喜欢晨星的比喻\n第二行 '))
  assert.equal(ok.kind, 'success')
  assert.match((ok as { text: string }).text, /晨星/)
  assert.match((ok as { text: string }).text, /开拓者喜欢晨星的比喻 第二行/)
  const record = memory.get('amphoreus-testcard-a')
  assert.equal(record?.notes.length, 1)
  assert.equal(record?.notes[0]?.author, 'user')
  assert.equal(record?.notes[0]?.sessionId, SESSION_A)
  assert.equal(record?.notes[0]?.text, '开拓者喜欢晨星的比喻 第二行')

  const unbound = await definition.handler(invocation(SESSION_B, '没有席位'))
  assert.equal(unbound.kind, 'error')
  assert.match((unbound as { text: string }).text, /未绑定/)
  const empty = await definition.handler(invocation(SESSION_A, '   '))
  assert.equal(empty.kind, 'error')
  assert.match((empty as { text: string }).text, /\/remember/)
  const long = await definition.handler(invocation(SESSION_A, '多'.repeat(201)))
  assert.equal(long.kind, 'error')
  assert.match((long as { text: string }).text, /200/)
  assert.equal(memory.get('amphoreus-testcard-a')?.notes.length, 1, 'rejected inputs write nothing')

  dispose()
  assert.equal(disposed(), 1)
})

test('invalid or colliding command names degrade to a warning instead of failing the plugin', () => {
  const { stores } = tables()
  const bad = fakeContext()
  const config = { ...fixtureConfig(), memory: { ...fixtureConfig().memory, command: 'Bad Name' } }
  registerRememberCommand(bad.ctx, { config, stores, current: () => undefined })()
  assert.equal(bad.registered.length, 0)
  assert.match(bad.warnings[0]!, /invalid/)

  const dup = fakeContext({ registerThrows: new Error('duplicate command') })
  registerRememberCommand(dup.ctx, { config: fixtureConfig(), stores, current: () => undefined })()
  assert.match(dup.warnings[0]!, /duplicate command/)
})

test('registerSeatMemory installs the prompt reader, wires command + observer and tears everything down', async () => {
  const { stores } = tables()
  const { ctx, registered, listeners, disposed } = fakeContext()
  const current = (): SuiteSnapshot | undefined => undefined
  const dispose = registerSeatMemory(ctx, { config: fixtureConfig(), stores, current })
  assert.equal(registered.length, 1)
  assert.equal(listeners.get('session/event'), 1)
  assert.equal(listeners.get('session/created'), 1)
  assert.equal(typeof installedSeatMemoryReader(stores), 'function')
  await dispose()
  assert.equal(disposed(), 1)
  assert.equal(listeners.get('session/event'), 0)
  assert.equal(listeners.get('session/created'), 0)
  assert.equal(installedSeatMemoryReader(stores), undefined)
})

test('host assembly wires seat memory after bridge.start and disposes it before the stores close', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.ok(source.indexOf('await bridge.start()') < source.indexOf('registerSeatMemory(ctx'))
  assert.ok(source.indexOf('await disposeSeatMemory()') < source.indexOf('await bridge.close()'))
  assert.ok(source.indexOf('await disposeSeatMemory()') < source.indexOf('await stores?.close()'))
  assert.match(source, /import \{ registerSeatMemory \} from '\.\/host\/memory\.ts'/)
})
