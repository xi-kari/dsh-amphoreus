import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bindingIndex,
  currentSeatOf,
  GLOBAL_SEAT_HERO,
  seatColorOf,
  seatViews,
  seatViewsFrom,
} from '../src/client/seat-model.ts'
import type { BindingRecord, SeatRecord } from '../src/host/store.ts'
import type { PublicCard } from '../src/shared/api.ts'
import { fallbackHue, heroVisualOf, stickerAssetUrl } from '../src/shared/heroes.ts'

function fixtureSeat(skillName: string, overrides: Partial<SeatRecord> = {}): SeatRecord {
  return {
    skillName,
    heroId: null,
    displayName: `Stored ${skillName}`,
    aliases: [],
    duties: [],
    status: 'deployed',
    order: 5,
    firstSeenAt: 1,
    lastSeenAt: 1,
    ...overrides,
  }
}

function fixtureBinding(sessionId: string, skillName: string): BindingRecord {
  return {
    sessionId,
    skillName,
    boundAt: 1,
    source: 'manual',
    injection: { state: 'done', at: 1 },
  }
}

function fixtureCard(name: string, displayName: string, duties: readonly string[] = []): PublicCard {
  return {
    name,
    displayName,
    aliases: [],
    faces: [],
    description: `Card ${name}`,
    duties,
    modelInvocable: false,
    userInvocable: true,
    hasPersona: true,
    status: 'ok',
  }
}

test('binding index resolves the current session and treats an absent selection as unbound', () => {
  const first = fixtureBinding('session-first', 'amphoreus-anaxa')
  const replacement = fixtureBinding('session-first', 'amphoreus-cyrene')
  const index = bindingIndex([first, replacement])

  assert.equal(index.size, 1)
  assert.equal(currentSeatOf(index, undefined), undefined)
  assert.equal(currentSeatOf(index, 'session-missing'), undefined)
  assert.equal(currentSeatOf(index, 'session-first'), replacement)
})

test('seat views compose runtime identity, retain hidden seats, and order sessions by recent activity', () => {
  const unknownSkill = 'amphoreus-unknown'
  const seats = [
    fixtureSeat(unknownSkill, {
      displayName: 'Stored Unknown',
      userDisplayName: 'Custom Unknown',
      duties: ['stale duty'],
      hidden: true,
      order: 7,
    }),
    fixtureSeat('amphoreus-cyrene', {
      heroId: 'cyrene',
      displayName: 'Stored Cyrene',
      order: 0,
    }),
    fixtureSeat('amphoreus-alpha', {
      displayName: 'Stored Alpha',
      status: 'undeployed',
      order: 7,
    }),
  ]
  const bindings = [
    fixtureBinding('session-old', unknownSkill),
    fixtureBinding('session-cyrene', 'amphoreus-cyrene'),
    fixtureBinding('session-archived', unknownSkill),
    fixtureBinding('session-gone', unknownSkill),
    fixtureBinding('session-recent', unknownSkill),
  ]
  const inputOrder = seats.map(seat => seat.skillName)
  const views = seatViews({
    seats,
    cards: [
      fixtureCard(unknownSkill, 'Card Unknown', ['live duty', 'second duty']),
      fixtureCard('amphoreus-cyrene', 'Card Cyrene', ['overview']),
    ],
    bindings,
    sessions: {
      ids: ['session-cyrene', 'session-old'],
      byId: {
        'session-old': { updatedAt: 10 },
        'session-cyrene': { updatedAt: 20 },
        'session-archived': { updatedAt: 40 },
        'session-recent': { updatedAt: 30 },
      },
    },
    archived: ['session-archived'],
    assetsConfigured: false,
  })

  assert.equal(GLOBAL_SEAT_HERO, 'cyrene')
  assert.deepEqual(views.map(view => view.skillName), [
    'amphoreus-cyrene',
    'amphoreus-alpha',
    unknownSkill,
  ])
  assert.deepEqual(seats.map(seat => seat.skillName), inputOrder)

  const unknown = views[2]!
  assert.equal(unknown.displayName, 'Custom Unknown')
  assert.equal(unknown.duty, 'live duty')
  assert.equal(unknown.deployed, true)
  assert.equal(unknown.hidden, true)
  assert.deepEqual(unknown.sessionIds, ['session-recent', 'session-old'])
  assert.equal(unknown.visual, undefined)
  assert.equal(unknown.hue, 161)
  assert.equal(unknown.accent, 'hsl(161 45% 52%)')
  assert.equal(unknown.accent2, 'hsl(161 35% 30%)')
  assert.equal(unknown.stickerUrl, null)

  const undeployed = views[1]!
  assert.equal(undeployed.deployed, false)
  assert.equal(undeployed.duty, undefined)
})

test('known visuals expose their palette and gate sticker assets on configuration', () => {
  const skillName = 'amphoreus-anaxa'
  const visual = heroVisualOf(skillName)!
  const seat = fixtureSeat(skillName, { heroId: visual.heroId })
  const base = {
    seats: [seat],
    cards: [fixtureCard(skillName, 'Anaxa')],
    bindings: [],
    sessions: { ids: [], byId: {} },
    archived: [],
  }

  const configured = seatViews({ ...base, assetsConfigured: true })[0]!
  assert.equal(configured.visual, visual)
  assert.equal(configured.accent, visual.palette.accent)
  assert.equal(configured.accent2, visual.palette.accent2)
  assert.equal(configured.hue, null)
  assert.equal(configured.stickerUrl, stickerAssetUrl(visual.assets.sticker))

  const unconfigured = seatViews({ ...base, assetsConfigured: false })[0]!
  assert.equal(unconfigured.stickerUrl, null)
})

test('seat colors use a neutral global palette and a deterministic unknown-skill hue', () => {
  const neutral = { accent: '#8a681c', accent2: '#37305e', hue: null }
  assert.deepEqual(seatColorOf(null), neutral)
  assert.deepEqual(seatColorOf(undefined), neutral)

  const known = heroVisualOf('amphoreus-cyrene')!
  assert.deepEqual(seatColorOf(known.skill), {
    accent: known.palette.accent,
    accent2: known.palette.accent2,
    hue: null,
  })

  const skillName = 'amphoreus-future'
  const hue = fallbackHue(skillName)
  assert.equal(hue, 164)
  assert.deepEqual(seatColorOf(skillName), {
    accent: 'hsl(164 45% 52%)',
    accent2: 'hsl(164 35% 30%)',
    hue: 164,
  })
  assert.deepEqual(seatColorOf(skillName), seatColorOf(skillName))
})

test('seat views from an unavailable client state are empty', () => {
  assert.deepEqual(seatViewsFrom(
    { phase: 'loading', refreshing: false },
    { ids: [], byId: {}, current: undefined },
    { archivedSessionIds: [] },
  ), [])
})
