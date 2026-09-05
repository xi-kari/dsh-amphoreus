import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const appSource = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')
const bridgeSource = readFileSync(new URL('../src/client/workbench.tsx', import.meta.url), 'utf8')
const clientSource = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
const portalSource = readFileSync(new URL('../src/client/portal.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../workbench/styles.css', import.meta.url), 'utf8')

function functionSource(name: string): string {
  const marker = `function ${name}(`
  const start = appSource.indexOf(marker)
  assert.notEqual(start, -1, `${name} must exist`)
  const next = appSource.indexOf('\nfunction ', start + marker.length)
  return appSource.slice(start, next === -1 ? undefined : next)
}

test('conference UI has an explicit all-seat action and renders per-seat reply states', () => {
  assert.match(appSource, /data-action="conference-start"/u)
  assert.match(appSource, /全席征询 · \$\{deployedCount\} 席/u)
  assert.match(appSource, /最多 3 席并行/u)
  assert.match(appSource, /dshRpc\('amphoreus:broadcast', \{ text \}\)/u)
  assert.doesNotMatch(appSource, /dshRpc\('amphoreus:broadcast', \{[^}]*targets/u)
  assert.match(functionSource('renderConferenceResults'), /conference-card phase-/u)
  assert.match(functionSource('renderConferenceResults'), /conference-reply/u)
  assert.match(functionSource('renderConferenceResults'), /open-conference-session/u)
  assert.match(css, /\.conference-grid \{ display: grid; grid-template-columns: repeat\(3,/u)
})

test('bridge derives broadcast targets from the refreshed trusted model and never reads iframe targets', () => {
  const broadcast = bridgeSource.slice(
    bridgeSource.indexOf("case 'amphoreus:broadcast'"),
    bridgeSource.indexOf("case 'amphoreus:dispatch'"),
  )
  assert.match(broadcast, /await model\.refresh\(\)/u)
  assert.match(broadcast, /conferenceTargets\(snapshot\.state\)/u)
  assert.match(broadcast, /concurrency: 3/u)
  assert.match(broadcast, /dispatchTask\(seatDeps/u)
  assert.match(broadcast, /open: false/u)
  assert.match(broadcast, /type: 'amphoreus:conference-started'/u)
  assert.match(broadcast, /type: 'amphoreus:conference-progress'/u)
  assert.doesNotMatch(broadcast, /data\.targets/u)
  assert.match(portalSource, /conversationFeed,\s*sessionFace,\s*followSession,\s*startSeatSession,/u)
  assert.ok((clientSource.match(/conversationFeed,\s*sessionFace,/gu) ?? []).length >= 2)
})

test('started and progress messages keep thirteen independent seat results addressable', () => {
  const state = {
    conference: { id: null, question: '你是谁？', starting: true, seats: [] as Array<Record<string, unknown>> },
  }
  let refreshes = 0
  const context = {
    state,
    CONFERENCE_PHASES: new Set(['queued', 'dispatching', 'running', 'done', 'failed']),
    scheduleViewRefresh: () => { refreshes += 1 },
    globalThis: {} as Record<string, unknown>,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`
    ${functionSource('applyConferenceStarted')}
    ${functionSource('applyConferenceProgress')}
    globalThis.__conference = { applyConferenceStarted, applyConferenceProgress }
  `, context)
  const api = context.globalThis.__conference as {
    applyConferenceStarted(data: unknown): boolean
    applyConferenceProgress(data: unknown): boolean
  }
  const targets = Array.from({ length: 13 }, (_, index) => ({
    skillName: `amphoreus-role-${index}`,
    displayName: `角色 ${index}`,
  }))

  assert.equal(api.applyConferenceStarted({ conferenceId: 'conference-1', targets }), true)
  assert.equal(state.conference.seats.length, 13)
  assert.equal(state.conference.starting, false)
  assert.equal(api.applyConferenceProgress({
    conferenceId: 'conference-1',
    skillName: 'amphoreus-role-7',
    displayName: '角色 7',
    sessionId: 'session-7',
    phase: 'done',
    text: '我是角色 7。',
  }), true)
  assert.deepEqual(
    JSON.parse(JSON.stringify(state.conference.seats.find(seat => seat.skillName === 'amphoreus-role-7'))),
    {
      skillName: 'amphoreus-role-7',
      displayName: '角色 7',
      sessionId: 'session-7',
      phase: 'done',
      text: '我是角色 7。',
      error: '',
    },
  )
  assert.equal(api.applyConferenceProgress({
    conferenceId: 'stale-conference',
    skillName: 'amphoreus-role-7',
    phase: 'failed',
  }), false)
  assert.equal(refreshes, 2)
})
