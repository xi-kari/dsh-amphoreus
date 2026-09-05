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

test('archiving conference sessions removes their open actions while retaining this round replies', () => {
  const state = {
    archivedSessionIds: new Set(['old-chat']),
    conference: {
      id: 'conference',
      question: 'Who are you?',
      starting: false,
      seats: [
        { skillName: 'amphoreus-anaxa', displayName: 'Anaxa', sessionId: 'old-chat', phase: 'done', text: 'old reply' },
        { skillName: 'amphoreus-cipher', displayName: 'Cipher', sessionId: 'live-chat', phase: 'done', text: 'live reply' },
      ],
    },
  }
  const context = {
    state,
    escapeHtml: (value: unknown) => String(value),
    renderMarkdown: (value: unknown) => String(value),
    stickerOrInitial: () => '',
    globalThis: {} as Record<string, unknown>,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${functionSource('conferenceActive')}\n${functionSource('conferenceStatusLabel')}\n${functionSource('renderConferenceResults')}\nglobalThis.renderResults = renderConferenceResults; globalThis.active = conferenceActive`, context)
  const renderResults = context.globalThis.renderResults as () => string
  const active = context.globalThis.active as () => boolean

  const html = renderResults()
  assert.doesNotMatch(html, /data-session="old-chat"/u)
  assert.match(html, /old reply/u)
  assert.match(html, /会话已归档/u)
  assert.match(html, /data-session="live-chat"/u)
  assert.match(html, /live reply/u)
  assert.match(html, /2\/2 已回复 · 本轮结束/u)
  assert.equal(active(), false)

  state.archivedSessionIds.add('live-chat')
  assert.doesNotMatch(renderResults(), /open-conference-session/u)
  assert.match(renderResults(), /live reply/u)
})
