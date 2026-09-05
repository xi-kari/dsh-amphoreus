import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { isFreshSession, registerSeatPermission, seatPermissionFor } from '../src/host/seat-permission.ts'
import type { AmphoreusStores, BindingRecord, SeatRecord } from '../src/host/store.ts'

const SESSION = 'session-00000000-0000-0000-0000-000000000031'
const SKILL = 'amphoreus-aglaea'

type Listener = (...args: any[]) => unknown

class FakeContext {
  readonly listeners = new Map<string, Listener[]>()
  readonly warnings: string[] = []
  readonly services = new Map<string, unknown>()
  readonly logger = { warn: (message: string) => { this.warnings.push(message) } }

  on(name: string, listener: Listener): () => void {
    const list = this.listeners.get(name) ?? []
    list.push(listener)
    this.listeners.set(name, list)
    return () => { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(item => item !== listener)) }
  }

  get(name: string): unknown {
    return this.services.get(name)
  }

  emit(name: string, ...args: any[]): void {
    for (const listener of this.listeners.get(name) ?? []) listener(...args)
  }
}

const seat = (preset?: SeatRecord['preset']): SeatRecord => ({
  skillName: SKILL, heroId: 'aglaea', displayName: '阿格莱雅', aliases: [], duties: [], status: 'deployed', order: 1, firstSeenAt: 1, lastSeenAt: 1,
  ...(preset === undefined ? {} : { preset }),
})

/** A brand-new session as announced by SessionStore.announce right after `sessions.create`. */
const fresh = (id: string, extra: Partial<{ firstLiveSeq: number; parentSession: string }> = {}) => ({
  id,
  firstLiveSeq: extra.firstLiveSeq ?? 0,
  header: { id, ...(extra.parentSession === undefined ? {} : { parentSession: extra.parentSession }) },
})

const binding = (): BindingRecord => ({ sessionId: SESSION, skillName: SKILL, boundAt: 1, source: 'seat-new', injection: { state: 'pending' } })

function stores(seats: Map<string, SeatRecord>, bindings: Map<string, BindingRecord>): AmphoreusStores {
  return {
    main: {
      table: (name: string) => {
        if (name === 'seats') return { get: (key: string) => seats.get(key) }
        if (name === 'bindings') return { get: (key: string) => bindings.get(key) }
        throw new Error(`unexpected table ${name}`)
      },
    },
  } as unknown as AmphoreusStores
}

test('seatPermissionFor resolves binding → seat → preset.permission and nothing else', () => {
  const seats = new Map([[SKILL, seat({ permission: 'read-only', agentPreset: 'standard' })]])
  assert.equal(seatPermissionFor(stores(seats, new Map([[SESSION, binding()]])), SESSION), 'read-only')
  assert.equal(seatPermissionFor(stores(seats, new Map()), SESSION), undefined, 'unbound session')
  assert.equal(seatPermissionFor(stores(new Map([[SKILL, seat({ agentPreset: 'standard' })]]), new Map([[SESSION, binding()]])), SESSION), undefined, 'seat without a permission tier')
  assert.equal(seatPermissionFor(stores(new Map(), new Map([[SESSION, binding()]])), SESSION), undefined, 'binding to an unknown seat')
})

test('session/created applies the seat permission AFTER a previously registered default pin, so the seat value wins', () => {
  const ctx = new FakeContext()
  const calls: string[] = []
  ctx.services.set('permissionPresets', { set: (session: { id: string }, name: string) => { calls.push(`seat:${session.id}:${name}`) } })
  // The platform's own pin registers first (base bundle row precedes the amphoreus patch row).
  ctx.on('session/created', (session: { id: string }) => { calls.push(`pin:${session.id}`) })
  const dispose = registerSeatPermission(ctx as unknown as Context, {
    stores: stores(new Map([[SKILL, seat({ permission: 'danger-full-access' })]]), new Map([[SESSION, binding()]])),
  })
  ctx.emit('session/created', fresh(SESSION))
  assert.deepEqual(calls, [`pin:${SESSION}`, `seat:${SESSION}:danger-full-access`])
  ctx.emit('session/created', fresh('session-00000000-0000-0000-0000-000000000099'))
  assert.equal(calls.length, 3, 'an unbound session only receives the platform pin')
  assert.deepEqual(ctx.warnings, [])
  dispose()
  ctx.emit('session/created', fresh(SESSION))
  assert.equal(calls.length, 4, 'after dispose only the platform pin remains')
})

test('resumed / restored / forked sessions never receive the tier: a manual /permission switch survives reopen', () => {
  const ctx = new FakeContext()
  const calls: string[] = []
  ctx.services.set('permissionPresets', { set: (_session: unknown, name: string) => { calls.push(name) } })
  registerSeatPermission(ctx as unknown as Context, {
    stores: stores(new Map([[SKILL, seat({ permission: 'danger-full-access' })]]), new Map([[SESSION, binding()]])),
  })
  // Resume: the constructor seed is the full stored log (announce fires again on every publish source).
  ctx.emit('session/created', fresh(SESSION, { firstLiveSeq: 12 }))
  // Handoff fork child whose binding already exists at announce time.
  ctx.emit('session/created', fresh(SESSION, { parentSession: 'session-00000000-0000-0000-0000-000000000001' }))
  assert.deepEqual(calls, [], 'a session with seed events or a parent keeps its effective knobs')
  assert.deepEqual(ctx.warnings, [])
  ctx.emit('session/created', fresh(SESSION))
  assert.deepEqual(calls, ['danger-full-access'], 'only the brand-new session is pinned')

  assert.equal(isFreshSession({ firstLiveSeq: 0, header: {} }), true)
  assert.equal(isFreshSession({ firstLiveSeq: 1, header: {} }), false)
  assert.equal(isFreshSession({ firstLiveSeq: 0, header: { parentSession: 'x' } }), false)
})

test('a missing permission service or a refused preset is warned, never thrown', () => {
  const ctx = new FakeContext()
  const options = { stores: stores(new Map([[SKILL, seat({ permission: 'made-up' })]]), new Map([[SESSION, binding()]])) }
  registerSeatPermission(ctx as unknown as Context, options)
  assert.doesNotThrow(() => ctx.emit('session/created', fresh(SESSION)))
  assert.equal(ctx.warnings.length, 1)
  assert.match(ctx.warnings[0]!, /permission service not composed/u)

  ctx.services.set('permissionPresets', { set: () => { throw new Error('unknown permission preset "made-up"') } })
  assert.doesNotThrow(() => ctx.emit('session/created', fresh(SESSION)))
  assert.equal(ctx.warnings.length, 2)
  assert.match(ctx.warnings[1]!, /refused for session-.*unknown permission preset/u)

  const broken = { stores: { main: { table: () => { throw new Error('table offline') } } } as unknown as AmphoreusStores }
  const ctx2 = new FakeContext()
  registerSeatPermission(ctx2 as unknown as Context, broken)
  assert.doesNotThrow(() => ctx2.emit('session/created', fresh(SESSION)))
  assert.match(ctx2.warnings[0]!, /table offline/u)
})

test('host wiring: seat-permission is registered at host-register, disposed at host-dispose, and stays type-only towards the platform', () => {
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.match(index, /const disposeSeatPermission = stores === undefined \? \(\) => \{\} : registerSeatPermission\(ctx, \{ stores \}\)/u)
  assert.ok(index.indexOf('// @anchor host-register') < index.indexOf('const disposeSeatPermission'))
  assert.ok(index.indexOf('// @anchor host-dispose') < index.indexOf('disposeSeatPermission()'))
  const module = readFileSync(new URL('../src/host/seat-permission.ts', import.meta.url), 'utf8')
  for (const statement of module.matchAll(/^import[\s\S]*?from\s+['"](@deepseek-ai\/[^'"]+)['"]$/gmu)) {
    assert.match(statement[0], /^import type\b/u, statement[1])
  }
  assert.match(module, /ctx\.get\('permissionPresets'\)/u)
  assert.doesNotMatch(module, /inject\s*=\s*\[/u)
})
