/**
 * Pins the index.ts seat-switch wiring block (between `// seat-switch: begin`
 * and `// seat-switch: end`) by compiling it against a stub ctx: both landing
 * branches, the hotkey installer deps, and the degrade-style `/seat`
 * registration. Mirrors tests/client-portal.test.ts's openSeat slice.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

const clientSource = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')

function slice(): string {
  const start = clientSource.indexOf('  // seat-switch: begin')
  const end = clientSource.indexOf('  // seat-switch: end', start)
  assert.ok(start > 0 && end > start, 'seat-switch block markers present in index.ts')
  return clientSource.slice(start, end)
}

test('source pins: hotkeys via ctx.effect, /seat via ctx.inject degrade, trigger package imported type-only', () => {
  const block = slice()
  assert.match(block, /ctx\.effect\(\(\) => installSeatHotkeys\(\{/u)
  assert.match(block, /togglePortal: portal\.toggle/u)
  assert.match(block, /isBusy: seatStartGuard\.isBusy/u)
  assert.match(block, /ctx\.inject\(\['inputTriggers'\], scope => \{\s*scope\.effect\(\(\) => scope\.inputTriggers\.registerSource\(createSeatCommandSource\(\{/u)
  assert.match(block, /openPortal: portal\.open/u)
  assert.doesNotMatch(clientSource, /^import (?!type\b)[^\n]*dsh-client-ui-input-trigger/mu)
  const commandSource = readFileSync(new URL('../src/client/seat-command.ts', import.meta.url), 'utf8')
  assert.match(commandSource, /^import type \{[\s\S]*?\} from '@deepseek-ai\/dsh-client-ui-input-trigger\/client'/mu)
})

interface StubView { skillName: string; sessionIds: string[] }
interface HotkeyDeps {
  seats: () => StubView[]
  enter: (view: StubView) => Promise<void>
  togglePortal: () => void
  isBusy: (skillName: string) => boolean
}
interface SourceDeps {
  seats: () => StubView[]
  cards: () => unknown
  enter: (view: StubView) => Promise<void>
  openPortal: () => void
}
interface Fixture {
  views: StubView[]
  trace: string[]
  hotkeys: HotkeyDeps
  source: SourceDeps | undefined
}

function fixture(options: { views: StubView[]; inputTriggers?: boolean; startFails?: boolean }): Fixture {
  const compiled = transpileModule(slice(), {
    compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2024 },
  }).outputText
  const trace: string[] = []
  const state: Fixture = { views: options.views, trace, hotkeys: undefined as never, source: undefined }
  // Same semantics as the real guard, minus the clock: busy while in flight or until the snapshot shows the session.
  const started = new Set<string>()
  const inflight = new Set<string>()
  const context = {
    window: {},
    model: { getSnapshot: () => ({ state: { suite: { cards: [{ name: 'card' }] } } }) },
    sessionsFace: { list: { getSnapshot: () => ({}) } },
    ctx: {
      workspaces: { list: { getSnapshot: () => ({}) } },
      effect: (run: () => unknown, label: string) => { trace.push(`effect:${label}`); run() },
      inject: (deps: string[], run: (scope: object) => void) => {
        trace.push(`inject:${deps.join(',')}`)
        if (options.inputTriggers === false) return
        run({
          effect: (fn: () => unknown, label: string) => { trace.push(`effect:${label}`); fn() },
          inputTriggers: { registerSource: (source: SourceDeps) => { state.source = source; return () => {} } },
        })
      },
    },
    seatViewsFrom: () => state.views,
    createSeatStartGuard: (deps: { hasSession: (skillName: string) => boolean }) => {
      const isBusy = (skillName: string): boolean => inflight.has(skillName) || (started.has(skillName) && !deps.hasSession(skillName))
      return {
        isBusy,
        run: async (skillName: string, start: () => Promise<void>) => {
          if (isBusy(skillName)) return false
          inflight.add(skillName)
          try {
            await start()
            started.add(skillName)
          } finally {
            inflight.delete(skillName)
          }
          return true
        },
      }
    },
    openBoundSeatSession: async (id: string, skill: string, follow: boolean) => { trace.push(`bound:${id}:${skill}:${String(follow)}`) },
    openDirectSession: (id: string) => { trace.push(`direct:${id}`) },
    startSeatSession: async (_deps: unknown, skill: string, opts: { open?: boolean }) => {
      if (options.startFails === true) throw new Error('席位目录尚未就绪')
      trace.push(`start:${skill}:${String(opts.open)}`)
      return 'session-new'
    },
    seatDeps: {},
    installSeatHotkeys: (deps: HotkeyDeps) => { state.hotkeys = deps; return () => {} },
    orderedHotkeySeats: (views: StubView[]) => views,
    createSeatCommandSource: (deps: SourceDeps) => deps,
    portal: { toggle: () => trace.push('portal:toggle'), open: () => trace.push('portal:open') },
    t: (key: string) => key,
    console: { warn: () => {} },
  }
  vm.runInNewContext(compiled, context)
  return state
}

test('enterSeatView with a bound session mirrors the sidebar: openBoundSeatSession(latest, skill, false) then openDirectSession', async () => {
  const f = fixture({ views: [{ skillName: 'amphoreus-anaxa', sessionIds: ['s-2', 's-1'] }] })
  await f.hotkeys.enter(f.views[0]!)
  assert.deepEqual(f.trace.filter(line => !line.startsWith('effect') && !line.startsWith('inject')),
    ['bound:s-2:amphoreus-anaxa:false', 'direct:s-2'])
})

test('enterSeatView without a session starts one (open:false) and shows it; the guard blocks a second start until the snapshot refreshes', async () => {
  const f = fixture({ views: [{ skillName: 'amphoreus-anaxa', sessionIds: [] }] })
  const view = f.views[0]!
  await f.hotkeys.enter(view)
  assert.deepEqual(f.trace.filter(line => line.startsWith('start') || line.startsWith('direct')),
    ['start:amphoreus-anaxa:false', 'direct:session-new'])
  assert.equal(f.hotkeys.isBusy('amphoreus-anaxa'), true, 'snapshot still shows no session → busy')
  await f.hotkeys.enter(view)
  assert.equal(f.trace.filter(line => line.startsWith('start')).length, 1, 'no double start')
  f.views[0] = { skillName: 'amphoreus-anaxa', sessionIds: ['session-new'] }
  assert.equal(f.hotkeys.isBusy('amphoreus-anaxa'), false)
})

test('hotkeys and /seat share enterSeatView / views / portal; the /seat source registers only when inputTriggers exists', () => {
  const f = fixture({ views: [{ skillName: 'amphoreus-anaxa', sessionIds: [] }] })
  assert.ok(f.trace.includes('effect:amphoreus: seat hotkeys'))
  assert.ok(f.trace.includes('inject:inputTriggers'))
  assert.ok(f.trace.includes('effect:amphoreus: /seat'))
  assert.ok(f.source !== undefined)
  assert.equal(f.source.enter, f.hotkeys.enter)
  f.hotkeys.togglePortal()
  f.source.openPortal()
  assert.deepEqual(f.trace.filter(line => line.startsWith('portal')), ['portal:toggle', 'portal:open'])
  assert.deepEqual(f.hotkeys.seats(), f.views)
  assert.deepEqual(f.source.cards(), [{ name: 'card' }])
  const degraded = fixture({ views: [], inputTriggers: false })
  assert.equal(degraded.source, undefined)
  assert.ok(degraded.trace.includes('effect:amphoreus: seat hotkeys'), 'hotkeys never depend on the optional service')
})

test('a failing start propagates to the caller (composer notice / hotkey onError) and leaves the guard free for a retry', async () => {
  const f = fixture({ views: [{ skillName: 'amphoreus-anaxa', sessionIds: [] }], startFails: true })
  await assert.rejects(f.hotkeys.enter(f.views[0]!), /席位目录尚未就绪/u)
  assert.equal(f.hotkeys.isBusy('amphoreus-anaxa'), false)
})
