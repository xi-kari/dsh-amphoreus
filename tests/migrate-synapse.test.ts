import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { migrateSynapse, planSynapseMigration } from '../src/host/migrate-synapse.ts'
import { INITIAL_GLOBAL, type AmphoreusGlobal, type AmphoreusStores, type CanvasRecord } from '../src/host/store.ts'

const SESSION_A = 'session-00000000-0000-0000-0000-000000000001'
const SESSION_B = 'session-00000000-0000-0000-0000-000000000002'

test('host awaits migration after stores open and before seat directories', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
  const opened = source.indexOf('stores = await openAmphoreusStores(ctx)')
  const migrated = source.indexOf('await migrateSynapse(stores, resolveDshHome(), ctx.logger)')
  const seatDirs = source.indexOf('seatDirs = await ensureSeatDirs')
  assert.ok(opened >= 0 && opened < migrated && migrated < seatDirs)
  assert.match(source, /migrateSynapse[\s\S]*catch\(error => ctx\.logger\.warn/)
})

test('planner accepts only canonical unique sessions with finite clamped positions', () => {
  const doc = {
    version: 4,
    workspaces: [
      null,
      { threads: [
        { dshSessionId: SESSION_A, position: { x: 5000.6, y: -2000.6 }, messages: ['never migrate'] },
        { dshSessionId: SESSION_A, position: { x: 1, y: 2 } },
        { dshSessionId: 'session-------------------------------------', position: { x: 1, y: 2 } },
        { dshSessionId: 'session-00000000-0000-0000-0000-00000000000g', position: { x: 1, y: 2 } },
        { dshSessionId: SESSION_B, position: { x: 3, y: 4 } },
        { dshSessionId: 'session-00000000-0000-0000-0000-000000000004', position: { x: Number.NaN, y: 2 } },
        { dshSessionId: 'session-00000000-0000-0000-0000-000000000005', position: { x: 2, y: Number.POSITIVE_INFINITY } },
        { dshSessionId: 'SESSION-00000000-0000-0000-0000-000000000003', position: { x: 1.4, y: 1.5 } },
        { dshSessionId: null },
      ] },
      { broken: true },
    ],
  }
  const plan = planSynapseMigration(doc, new Set([SESSION_B]))
  assert.equal(plan.length, 2)
  assert.equal(plan[0]?.sessionId, SESSION_A)
  assert.deepEqual(plan[0]?.record.positions, { [`${SESSION_A}:turn-index:0`]: { x: 5000, y: -2000 } })
  assert.deepEqual(plan[0]?.record.collapsed, [])
  assert.deepEqual(plan[0]?.record.branchAnchors, {})
  assert.equal(plan[1]?.record.positions['SESSION-00000000-0000-0000-0000-000000000003:turn-index:0']?.x, 1)
  assert.equal(plan[1]?.record.positions['SESSION-00000000-0000-0000-0000-000000000003:turn-index:0']?.y, 2)
  assert.equal(JSON.stringify(plan).includes('messages'), false)
  assert.equal(planSynapseMigration(doc, new Set([SESSION_A, SESSION_B, 'SESSION-00000000-0000-0000-0000-000000000003'])).length, 0)
  assert.deepEqual(planSynapseMigration({ version: 4, workspaces: 'bad' }, new Set()), [])
  assert.deepEqual(planSynapseMigration({ version: 3, workspaces: [] }, new Set()), [])
})

test('full migration writes a per-record wrapper once and never touches the source', async () => {
  const home = await mkdtemp(join(tmpdir(), 'amphoreus-migrate-full-'))
  try {
    const source = await writeSource(home, { version: 4, workspaces: [{ threads: [
      { dshSessionId: SESSION_A, position: { x: 12.4, y: 18.6 } },
      { dshSessionId: null, position: { x: 1, y: 2 } },
    ] }] })
    const before = await sourceIdentity(source)
    const fixture = await storesFixture(home)
    await migrateSynapse(fixture.stores, home, fixture.logger)

    const wrapper = JSON.parse(await readFile(fixture.fileFor(SESSION_A), 'utf8')) as { version: number; record: CanvasRecord }
    assert.equal(wrapper.version, 1)
    assert.deepEqual(wrapper.record.positions, { [`${SESSION_A}:turn-index:0`]: { x: 12, y: 19 } })
    assert.match(fixture.global().synapseMigratedFrom ?? '', new RegExp(`${escapeRegex(source)}@\\d`))
    assert.deepEqual(fixture.info, ['amphoreus synapse migration: 1 positions folded'])
    assert.deepEqual(await sourceIdentity(source), before)

    const firstMtime = (await stat(fixture.fileFor(SESSION_A))).mtimeMs
    await migrateSynapse(fixture.stores, home, fixture.logger)
    assert.equal((await stat(fixture.fileFor(SESSION_A))).mtimeMs, firstMtime)
    assert.equal(fixture.puts.get(SESSION_A), 1)
    assert.deepEqual(await sourceIdentity(source), before)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('concurrent migration calls share one complete critical section', async () => {
  const home = await mkdtemp(join(tmpdir(), 'amphoreus-migrate-concurrent-'))
  try {
    const source = await writeSource(home, { version: 4, workspaces: [{ threads: [
      { dshSessionId: SESSION_A, position: { x: 5, y: 6 } },
    ] }] })
    const before = await sourceIdentity(source)
    const fixture = await storesFixture(home)
    await Promise.all([
      migrateSynapse(fixture.stores, home, fixture.logger),
      migrateSynapse(fixture.stores, home, fixture.logger),
    ])

    assert.equal(fixture.puts.get(SESSION_A), 1)
    assert.deepEqual(fixture.info, ['amphoreus synapse migration: 1 positions folded'])
    assert.deepEqual(await sourceIdentity(source), before)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('partial failure leaves no marker and retries only missing records', async () => {
  const home = await mkdtemp(join(tmpdir(), 'amphoreus-migrate-partial-'))
  try {
    const source = await writeSource(home, { version: 4, workspaces: [{ threads: [
      { dshSessionId: SESSION_A, position: { x: 1, y: 2 } },
      { dshSessionId: SESSION_B, position: { x: 3, y: 4 } },
    ] }] })
    const before = await sourceIdentity(source)
    const fixture = await storesFixture(home, { failOnce: new Set([SESSION_B]) })
    const results = await Promise.allSettled([
      migrateSynapse(fixture.stores, home, fixture.logger),
      migrateSynapse(fixture.stores, home, fixture.logger),
    ])
    assert.equal(results[0]?.status, 'rejected')
    assert.match(String(results[0]?.status === 'rejected' ? results[0].reason : ''), /fixture put failure/)
    assert.equal(results[1]?.status, 'fulfilled')
    assert.equal(fixture.canvas.has(SESSION_A), true)
    assert.equal(fixture.canvas.has(SESSION_B), true)
    assert.equal(fixture.puts.get(SESSION_A), 1)
    assert.equal(fixture.puts.get(SESSION_B), 2)
    assert.match(fixture.global().synapseMigratedFrom ?? '', /workspaces\.json@\d/)
    assert.deepEqual(await sourceIdentity(source), before)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('unsupported versions mark through serialized RMW without changing other global fields', async () => {
  const home = await mkdtemp(join(tmpdir(), 'amphoreus-migrate-unsupported-'))
  try {
    const source = await writeSource(home, { version: 3, workspaces: [] })
    const initial: AmphoreusGlobal = structuredClone(INITIAL_GLOBAL)
    initial.prefs.lastSeat = 'keep-seat'
    const fixture = await storesFixture(home, { initial })
    await migrateSynapse(fixture.stores, home, fixture.logger)
    assert.equal(fixture.global().prefs.lastSeat, 'keep-seat')
    assert.equal(fixture.global().synapseMigratedFrom, `${source}@unsupported-v3`)
    assert.deepEqual(fixture.warn, ['amphoreus synapse migration: unsupported version 3'])
    assert.equal(fixture.canvas.size, 0)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('ENOENT is silent, malformed JSON never marks, and other stat errors propagate', async () => {
  const missingHome = await mkdtemp(join(tmpdir(), 'amphoreus-migrate-missing-'))
  const badHome = await mkdtemp(join(tmpdir(), 'amphoreus-migrate-bad-'))
  const statHome = await mkdtemp(join(tmpdir(), 'amphoreus-migrate-stat-'))
  try {
    const missing = await storesFixture(missingHome)
    await migrateSynapse(missing.stores, missingHome, missing.logger)
    assert.equal(missing.global().synapseMigratedFrom, undefined)
    assert.deepEqual([...missing.info, ...missing.warn], [])

    const badSource = await writeSource(badHome, '{broken', true)
    const badBefore = await sourceIdentity(badSource)
    const bad = await storesFixture(badHome)
    await assert.rejects(migrateSynapse(bad.stores, badHome, bad.logger), SyntaxError)
    assert.equal(bad.global().synapseMigratedFrom, undefined)
    assert.deepEqual(await sourceIdentity(badSource), badBefore)

    const statFailure = await storesFixture(statHome)
    await assert.rejects(migrateSynapse(statFailure.stores, '\0', statFailure.logger), error => (error as NodeJS.ErrnoException).code !== 'ENOENT')
    assert.equal(statFailure.global().synapseMigratedFrom, undefined)
  } finally {
    await Promise.all([missingHome, badHome, statHome].map(path => rm(path, { recursive: true, force: true })))
  }
})

test('an existing marker returns before touching even an invalid source path', async () => {
  const home = await mkdtemp(join(tmpdir(), 'amphoreus-migrate-marker-'))
  try {
    const initial = structuredClone(INITIAL_GLOBAL)
    initial.synapseMigratedFrom = 'already-done'
    const fixture = await storesFixture(home, { initial })
    await migrateSynapse(fixture.stores, '\0', fixture.logger)
    assert.equal(fixture.global().synapseMigratedFrom, 'already-done')
  } finally { await rm(home, { recursive: true, force: true }) }
})

async function writeSource(home: string, value: unknown, raw = false): Promise<string> {
  const directory = join(home, 'synapse')
  await mkdir(directory, { recursive: true })
  const file = join(directory, 'workspaces.json')
  await writeFile(file, raw ? String(value) : JSON.stringify(value), 'utf8')
  return file
}

async function sourceIdentity(file: string): Promise<{ hash: string; mtimeMs: number }> {
  const content = await readFile(file)
  return { hash: createHash('sha256').update(content).digest('hex'), mtimeMs: (await stat(file)).mtimeMs }
}

async function storesFixture(home: string, options: { failOnce?: Set<string>; initial?: AmphoreusGlobal } = {}) {
  const canvasDirectory = join(home, 'stored-canvas')
  await mkdir(canvasDirectory, { recursive: true })
  let global = structuredClone(options.initial ?? INITIAL_GLOBAL)
  const canvas = new Map<string, CanvasRecord>()
  const puts = new Map<string, number>()
  const failures = new Set(options.failOnce ?? [])
  const info: string[] = []
  const warn: string[] = []
  const stores = {
    main: {
      global: {
        get: () => global,
        set: async (next: AmphoreusGlobal) => { global = next },
      },
    },
    canvas: {
      table: () => ({
        entries: () => canvas.entries(),
        put: async (sessionId: string, value: CanvasRecord) => {
          puts.set(sessionId, (puts.get(sessionId) ?? 0) + 1)
          if (failures.delete(sessionId)) throw new Error(`fixture put failure: ${sessionId}`)
          canvas.set(sessionId, value)
          await writeFile(join(canvasDirectory, `${sessionId}.json`), JSON.stringify({ version: 1, record: value }), 'utf8')
        },
      }),
    },
    close: async () => {},
  } as unknown as AmphoreusStores
  return {
    stores,
    canvas,
    puts,
    info,
    warn,
    logger: { info: (message: string) => info.push(message), warn: (message: string) => warn.push(message) },
    global: () => global,
    fileFor: (sessionId: string) => join(canvasDirectory, `${sessionId}.json`),
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
