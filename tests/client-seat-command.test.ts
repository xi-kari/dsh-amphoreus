import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  CandidateRequest,
  CommandClaim,
  InputTriggerPick,
  PickOutcome,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { en, zh, type AmphoreusKey } from '../src/client/locales.ts'
import {
  createSeatCommandSource,
  SEAT_COMMAND_TOKEN,
  seatCandidates,
  submitSeatArgs,
  type SeatCommandDeps,
} from '../src/client/seat-command.ts'
import type { SeatView } from '../src/client/seat-model.ts'
import type { PublicCard } from '../src/shared/api.ts'
import { fixtureView } from './fixture-seat-view.ts'

const t = (key: AmphoreusKey, params?: Record<string, unknown>): string => {
  const template = zh[key]
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/gu, (match, name: string) => (name in params ? String(params[name]) : match))
}

const anaxaCard: PublicCard = {
  name: 'amphoreus-anaxa',
  displayName: '那刻夏',
  aliases: ['Anaxa'],
  faces: [],
  description: '',
  duties: ['论证'],
  modelInvocable: false,
  userInvocable: true,
  hasPersona: true,
  status: 'ok',
}

function harness(views: readonly SeatView[] = [
  fixtureView('amphoreus-aglaea', { displayName: '阿格莱雅', duty: '统筹', order: 1 }),
  fixtureView('amphoreus-anaxa', { heroId: 'anaxa', displayName: '那刻夏', duty: '论证', order: 2 }),
  fixtureView('amphoreus-hidden', { displayName: '隐藏', hidden: true, order: 3 }),
]) {
  const entered: string[] = []
  let portalOpened = 0
  const deps: SeatCommandDeps = {
    seats: () => views,
    cards: () => [anaxaCard],
    enter: async view => { entered.push(view.skillName) },
    openPortal: () => { portalOpened += 1 },
    t,
  }
  return { deps, entered, portal: () => portalOpened, source: createSeatCommandSource(deps) }
}

const session = { sessionId: 'session-1' as never }
const actx = {} as never
const request = (query: string, position: CandidateRequest['position'] = 'leading'): CandidateRequest => ({
  query, position, drilled: false, signal: new AbortController().signal,
})

function claimOf(outcome: PickOutcome): CommandClaim {
  assert.ok(outcome !== undefined && outcome !== 'handled' && 'claim' in outcome, 'expected a claim outcome')
  return outcome.claim
}

test('locale keys exist in both dictionaries', () => {
  for (const key of ['seat.command.section', 'seat.command.hint', 'seat.notFound', 'seat.hotkeyHint'] as const) {
    assert.equal(typeof zh[key], 'string')
    assert.equal(typeof en[key], 'string')
  }
  assert.match(zh['seat.notFound'], /\{name\}/u)
  assert.match(en['seat.notFound'], /\{name\}/u)
})

test('source identity: own "/" source named seat, group title hidden, ordered after the platform command group', () => {
  const { source } = harness()
  assert.equal(source.trigger, '/')
  assert.equal(source.name, 'seat')
  assert.equal(source.showGroupTitle, false)
  assert.ok((source.order ?? 0) > 0)
  assert.equal(typeof source.matchSpace, 'function')
  assert.equal(typeof source.matchEnter, 'function')
})

test('candidates: one row per visible deployed seat plus seat all, leading position only, filtered by query', async () => {
  const { source, deps } = harness()
  const rows = await source.candidates(session, request(''))
  assert.deepEqual(rows.map(row => row.name), ['seat 阿格莱雅', 'seat 那刻夏', 'seat all'])
  assert.deepEqual(rows.map(row => row.value), ['amphoreus-aglaea', 'amphoreus-anaxa', 'all'])
  assert.equal(rows[0]?.description, 'Alt+1 · 统筹')
  assert.equal(rows[1]?.description, 'Alt+2 · 论证')
  assert.match(rows[2]?.description ?? '', /^Alt\+0 · /u)
  for (const row of rows) assert.equal(row.section, zh['seat.command.section'])
  assert.deepEqual(await source.candidates(session, request('', 'inline')), [])
  assert.deepEqual(seatCandidates(deps, 'se').map(row => row.name), ['seat 阿格莱雅', 'seat 那刻夏', 'seat all'])
  assert.deepEqual(seatCandidates(deps, 'seat 那').map(row => row.name), ['seat 那刻夏'])
  assert.deepEqual(seatCandidates(deps, 'seat anaxa').map(row => row.name), ['seat 那刻夏'])
  assert.deepEqual(seatCandidates(deps, 'seat al').map(row => row.name), ['seat all'])
  assert.deepEqual(seatCandidates(deps, 'model'), [])
})

test('matchSpace claims the bare /seat token only; matchEnter claims any /seat line and leaves other lines alone', async () => {
  const { source } = harness()
  const space = claimOf(source.matchSpace?.(session, '/seat'))
  assert.equal(space.token, SEAT_COMMAND_TOKEN)
  assert.equal(space.hint, zh['seat.command.hint'])
  assert.equal(source.matchSpace?.(session, '/seats'), undefined)
  assert.equal(source.matchSpace?.(session, '/model'), undefined)
  const signal = new AbortController().signal
  claimOf(await source.matchEnter?.(session, '/seat 那刻夏', signal, { images: 0 }))
  claimOf(await source.matchEnter?.(session, '/seat', signal, { images: 0 }))
  assert.equal(await source.matchEnter?.(session, '/model', signal, { images: 0 }), undefined)
  assert.equal(await source.matchEnter?.(session, 'hello /seat', signal, { images: 0 }), undefined)
})

test('claim.submit enters a resolved seat and reports success so the composer commits the draft', async () => {
  const { source, entered, portal } = harness()
  const claim = claimOf(await source.matchEnter?.(session, '/seat anaxa', new AbortController().signal, { images: 0 }))
  assert.deepEqual(await claim.submit('anaxa', actx, []), { kind: 'success' })
  assert.deepEqual(await claim.submit('阿格莱雅', actx, []), { kind: 'success' })
  assert.deepEqual(entered, ['amphoreus-anaxa', 'amphoreus-aglaea'])
  assert.deepEqual(await claim.submit('all', actx, []), { kind: 'success' })
  assert.deepEqual(await claim.submit('总览', actx, []), { kind: 'success' })
  assert.equal(portal(), 2)
  assert.deepEqual(entered, ['amphoreus-anaxa', 'amphoreus-aglaea'])
})

test('unknown or empty names return an error outcome (draft kept) without entering anything', async () => {
  const { deps, entered, portal } = harness()
  assert.deepEqual(await submitSeatArgs(deps, 'nobody'), {
    kind: 'error',
    text: zh['seat.notFound'].replace('{name}', 'nobody'),
  })
  assert.deepEqual(await submitSeatArgs(deps, '   '), { kind: 'error', text: zh['seat.command.hint'] })
  assert.equal(entered.length, 0)
  assert.equal(portal(), 0)
})

test('enter failures propagate as rejections so the composer surfaces the message and keeps the draft', async () => {
  const { deps } = harness()
  const failing: SeatCommandDeps = { ...deps, enter: async () => { throw new Error('席位目录尚未就绪') } }
  await assert.rejects(submitSeatArgs(failing, 'anaxa'), /席位目录尚未就绪/u)
})

test('menu pick yields a claim carrying the picked seat; Enter with no extra text uses the picked value', async () => {
  const { source, entered, portal } = harness()
  const rows = await source.candidates(session, request(''))
  const pick = (index: number, action: InputTriggerPick['action'] = 'pick'): InputTriggerPick => ({
    candidate: rows[index]!, session, position: 'leading', via: 'menu', action,
    span: { start: 0, end: 1, draftRev: 1 },
  })
  const claim = claimOf(source.onPick(pick(1)))
  assert.equal(claim.token, '/seat 那刻夏 ')
  assert.deepEqual(await claim.submit('', actx, []), { kind: 'success' })
  assert.deepEqual(entered, ['amphoreus-anaxa'])
  const portalClaim = claimOf(source.onPick(pick(2)))
  assert.equal(portalClaim.token, '/seat all ')
  assert.deepEqual(await portalClaim.submit('', actx, []), { kind: 'success' })
  assert.equal(portal(), 1)
  assert.equal(source.onPick(pick(0, 'drill')), undefined)
})
