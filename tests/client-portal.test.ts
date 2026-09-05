import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { createPortalStore } from '../src/client/portal-store.ts'

const portalSource = readFileSync(new URL('../src/client/portal.tsx', import.meta.url), 'utf8')
const portalCss = readFileSync(new URL('../src/client/portal.module.css', import.meta.url), 'utf8')
const clientSource = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
const brandSource = readFileSync(new URL('../src/client/brand.tsx', import.meta.url), 'utf8')

test('portal store has stable snapshots, idempotent actions, and disposable subscriptions', () => {
  const portal = createPortalStore()
  const initial = portal.getSnapshot()
  assert.deepEqual(initial, { open: false })
  assert.equal(portal.getSnapshot(), initial)

  let changes = 0
  const dispose = portal.subscribe(() => { changes += 1 })
  portal.close()
  assert.equal(changes, 0)
  portal.open()
  const opened = portal.getSnapshot()
  assert.deepEqual(opened, { open: true })
  assert.notEqual(opened, initial)
  assert.equal(portal.getSnapshot(), opened)
  assert.equal(changes, 1)
  portal.open()
  assert.equal(changes, 1)
  portal.toggle()
  assert.deepEqual(portal.getSnapshot(), { open: false })
  assert.equal(changes, 2)
  portal.toggle()
  assert.deepEqual(portal.getSnapshot(), { open: true })
  assert.equal(changes, 3)
  dispose()
  portal.close()
  assert.equal(changes, 3)
})

test('footer and overlay keep hooks unconditional and implement every close and focus path', () => {
  assert.match(portalSource, /useSyncExternalStore\(portal\.subscribe, portal\.getSnapshot\)\.open/)
  assert.match(portalSource, /<AmphoreusMark size=\{16\} assetsConfigured=\{assetsConfigured\} \/>/)
  assert.match(portalSource, /className=\{clsx\(css\.footerButton, !wide && css\.rail\)\}/)
  assert.match(portalSource, /aria-pressed=\{open\}/)
  assert.match(portalSource, /\{wide && <span>\{t\('seats\.portal'\)\}<\/span>\}/)

  const bridge = portalSource.indexOf('useWorkbenchBridge(frameRef')
  const conditionalReturn = portalSource.indexOf('if (!open) return null')
  assert.ok(bridge >= 0 && bridge < conditionalReturn)
  assert.match(portalSource, /onOpenSeat: openSeat/)
  assert.match(portalSource, /onClose: portal\.close/)
  assert.match(portalSource, /onOpened: portal\.close/)
  assert.match(portalSource, /onOpenPortal: portal\.open/)
  assert.match(portalSource, /frameRef\.current\?\.focus\(\)/)
  assert.match(portalSource, /window\.addEventListener\('keydown', onKeyDown\)/)
  assert.match(portalSource, /window\.removeEventListener\('keydown', onKeyDown\)/)
  assert.match(portalSource, /event\.key !== 'Escape'/)
  assert.match(portalSource, /event\.target === event\.currentTarget/)
  assert.match(portalSource, /role="dialog"/)
  assert.match(portalSource, /aria-modal="true"/)
  assert.match(portalSource, /src="\/amphoreus\/workbench\/\?mode=portal"/)
  assert.match(portalSource, /onLoad=\{onFrameLoad\}/)
  assert.doesNotMatch(portalSource, /\bctx\b|fetch\(|appendChild|localStorage/)
})

test('index assembles one shared portal before both overlay and Workbench registrations', () => {
  const store = clientSource.indexOf('const portal = createPortalStore()')
  const footer = clientSource.indexOf("name: 'sidebar.footer.action'")
  const overlay = clientSource.indexOf("name: 'shell.overlay'")
  const workbench = clientSource.indexOf("name: 'conversation.view'")
  assert.ok(store >= 0 && store < footer && footer < overlay && overlay < workbench)
  assert.equal((clientSource.match(/const portal = createPortalStore\(\)/g) ?? []).length, 1)
  assert.equal((clientSource.match(/const enterSeatQueue = createEnterSeatQueue\(\)/g) ?? []).length, 1)
  assert.equal((clientSource.match(/name: 'sidebar\.footer\.action'/g) ?? []).length, 1)
  assert.equal((clientSource.match(/name: 'shell\.overlay'/g) ?? []).length, 1)
  assert.match(clientSource, /id: 'amphoreus-portal',[\s\S]*order: 0/)
  assert.match(clientSource, /const openPortal = portal\.open/)
  assert.match(clientSource, /\n\s*openPortal,\n/)
  assert.match(clientSource, /startSeatSession: skillName => startSeatSession\(seatDeps, skillName, \{ open: false \}\)/)
  assert.match(clientSource, /startPortalSeatSession = \(skillName: string\): Promise<string> => startSeatSession\(seatDeps, skillName\)/)

  const overlayBlock = clientSource.slice(overlay, workbench)
  assert.match(overlayBlock, /sessions: sessionsFace/)
  assert.match(overlayBlock, /\n\s*workspaces,/)
  assert.doesNotMatch(overlayBlock, /workspaces:\s*ctx\.workspaces/)
  assert.match(overlayBlock, /setSeat: seatTheme\.hint/)
  assert.match(overlayBlock, /theme: themeBridge/)
  assert.match(overlayBlock, /magazine: magazineBridge/)
  assert.doesNotMatch(overlayBlock, /enterSeatQueue/)
  const workbenchBlock = clientSource.slice(workbench)
  assert.match(workbenchBlock, /\n\s*enterSeatQueue,/)
})

test('openSeat routes all through the mounted tab or keeps the portal frame, then preserves hero routing', () => {
  const start = clientSource.indexOf('const openSeat = async')
  const end = clientSource.indexOf('\n  // @anchor client-services', start)
  assert.ok(start >= 0 && end > start)
  const action = clientSource.slice(start, end)
  const all = action.indexOf('if (heroId === null) {')
  const close = action.indexOf('portal.close()')
  const state = action.indexOf('model.getSnapshot().state')
  assert.ok(all >= 0 && all < close && close < state)
  assert.match(action, /readRememberedTab\(localStorage\) === WORKBENCH_VIEW_ID/u)
  assert.match(action, /currentSummary\?\.blank === false/u)
  assert.match(action, /enterSeatQueue\.set\(request\)/u)
  assert.match(action, /return false/u)
  assert.doesNotMatch(action, /sessionsFace\.create|seedConversationView|randomUUID/u)
  assert.match(action, /heroVisualById\(heroId\)\?\.skill \?\? state\.seats\.find/)
  assert.match(action, /seatViewsFrom\(/)
  assert.match(action, /view\.sessionIds\.length > 0/)
  assert.match(action, /await openBoundSeatSession\(view\.sessionIds\[0\]!, skill\)/)
  assert.match(action, /else await startPortalSeatSession\(skill\)/)
  assert.doesNotMatch(action, /fetch\(|putBinding|deleteBinding/)
})

test('openSeat reuses a mounted Workbench, leaves chat in the portal canvas, and preserves hero routing', async () => {
  const start = clientSource.indexOf('const openSeat = async')
  const end = clientSource.indexOf('\n  // @anchor client-services', start)
  const source = clientSource.slice(start, end)
  const compiled = transpileModule(
    `${source}\nglobalThis.__openSeat = openSeat`,
    { compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2024 } },
  ).outputText

  const fixture = (options: {
    state?: object
    views?: { skillName: string; sessionIds: string[] }[]
    current?: string
    currentBlank?: boolean
    remembered?: string
  }) => {
    const trace: string[] = []
    const store = {}
    const context = {
      portal: { close: () => trace.push('close') },
      model: { getSnapshot: () => ({ state: options.state }) },
      heroVisualById: (heroId: string) => heroId === 'anaxa' ? { skill: 'amphoreus-anaxa' } : undefined,
      seatViewsFrom: () => options.views ?? [],
      sessionsFace: {
        list: { getSnapshot: () => ({
          current: options.current,
          byId: options.current === undefined
            ? {}
            : { [options.current]: { blank: options.currentBlank ?? false } },
        }) },
        create: async () => { throw new Error('blank session must not be created') },
        open: (id: string) => trace.push(`open:${id}`),
      },
      openBoundSeatSession: async (id: string) => { trace.push(`open:${id}`) },
      enterSeatQueue: { set: (request: object) => trace.push(`queue:${JSON.stringify(request)}`) },
      readRememberedTab: () => options.remembered ?? null,
      WORKBENCH_VIEW_ID: 'amphoreus-workbench',
      localStorage: store,
      ctx: { workspaces: { list: { getSnapshot: () => ({}) } } },
      startPortalSeatSession: async (skill: string) => {
        trace.push(`start:${skill}`)
        return 'session-new'
      },
      __openSeat: undefined as undefined | ((heroId: string | null, extra?: { dispatchText?: string }) => Promise<boolean>),
    }
    vm.runInNewContext(compiled, context)
    return { openSeat: context.__openSeat!, trace }
  }

  const all = fixture({ state: { seats: [] }, current: 'session-current', remembered: 'amphoreus-workbench' })
  assert.equal(await all.openSeat(null, { dispatchText: '  整理一下日志  ' }), true)
  assert.deepEqual(all.trace, ['close', 'queue:{"workspaceId":"all","dispatchText":"整理一下日志"}'])

  const fromChat = fixture({
    state: { seats: [] },
    current: 'session-current',
    remembered: 'chat',
  })
  assert.equal(await fromChat.openSeat(null, { dispatchText: '整理一下日志' }), false)
  assert.deepEqual(fromChat.trace, [])

  const blankCurrent = fixture({
    state: { seats: [] },
    current: 'session-blank',
    currentBlank: true,
    remembered: 'amphoreus-workbench',
  })
  assert.equal(await blankCurrent.openSeat(null, { dispatchText: '整理一下日志' }), false)
  assert.deepEqual(blankCurrent.trace, [])

  const noCurrent = fixture({
    state: { seats: [] },
    remembered: 'chat',
  })
  assert.equal(await noCurrent.openSeat(null), false)
  assert.deepEqual(noCurrent.trace, [])

  const existing = fixture({
    state: { seats: [] },
    views: [{ skillName: 'amphoreus-anaxa', sessionIds: ['session-latest', 'session-older'] }],
  })
  assert.equal(await existing.openSeat('anaxa'), true)
  assert.deepEqual(existing.trace, ['close', 'open:session-latest'])

  const empty = fixture({ state: { seats: [] }, views: [] })
  assert.equal(await empty.openSeat('anaxa'), true)
  assert.deepEqual(empty.trace, ['close', 'start:amphoreus-anaxa'])

  const unavailable = fixture({})
  assert.equal(await unavailable.openSeat('anaxa'), true)
  assert.deepEqual(unavailable.trace, ['close'])
})

test('portal CSS uses only DSW colors plus the one allowed panel shadow', () => {
  assert.doesNotMatch(portalCss, /#[0-9a-f]{3,8}\b/iu)
  const rgba = portalCss.match(/rgba?\(/gu) ?? []
  assert.equal(rgba.length, 1)
  const panelStart = portalCss.indexOf('.panel {')
  const panelEnd = portalCss.indexOf('\n}', panelStart)
  assert.ok(panelStart >= 0 && panelEnd > panelStart)
  assert.match(portalCss.slice(panelStart, panelEnd), /box-shadow:[^;]*rgba\(0, 0, 0, \.28\)/u)
  for (const selector of ['.scrim', '.panel', '.frame', '.close', '.footerButton', '.rail']) {
    assert.ok(portalCss.includes(`${selector} {`), `missing ${selector}`)
  }
  assert.match(portalCss, /\.scrim \{[^}]*position: absolute;[^}]*inset: 0;[^}]*pointer-events: auto;/su)
})

test('brand exports the shared mark and portal never registers in root', () => {
  assert.match(brandSource, /export function AmphoreusMark/)
  const portalRegistrations = clientSource.slice(
    clientSource.indexOf("ctx.slots.inject('sidebar.footer.action'"),
    clientSource.indexOf("if (workbenchEnabled)", clientSource.indexOf("ctx.slots.inject('sidebar.footer.action'")),
  )
  assert.doesNotMatch(portalRegistrations, /name: 'root'|appendChild/)
  assert.match(clientSource, /import type \{\} from '@deepseek-ai\/dsh-client-ui-layout\/client'/)
})
