import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  hotkeyLabel,
  orderedHotkeySeats,
  parseSeatLine,
  resolveSeatByName,
  seatForDigit,
} from '../src/client/seat-switch.ts'
import type { PublicCard } from '../src/shared/api.ts'
import { fixtureView } from './fixture-seat-view.ts'

function fixtureCard(name: string, displayName: string, aliases: readonly string[] = []): PublicCard {
  return {
    name,
    displayName,
    aliases,
    faces: [],
    description: '',
    duties: [],
    modelInvocable: false,
    userInvocable: true,
    hasPersona: true,
    status: 'ok',
  }
}

const anaxa = fixtureView('amphoreus-anaxa', { heroId: 'anaxa', displayName: '那刻夏', order: 3 })
const aglaea = fixtureView('amphoreus-aglaea', { heroId: 'aglaea', displayName: 'Aglaea', order: 1 })
const hiddenSeat = fixtureView('amphoreus-hidden', { displayName: '隐藏', hidden: true, order: 0 })
const undeployed = fixtureView('amphoreus-later', { displayName: '未部署', deployed: false, order: 2 })
const views = [hiddenSeat, aglaea, undeployed, anaxa]
const cards = [fixtureCard('amphoreus-anaxa', '那刻夏', ['Anaxa', '教授'])]

test('orderedHotkeySeats keeps sidebar order and drops hidden or undeployed seats', () => {
  const seats = orderedHotkeySeats(views)
  assert.deepEqual(seats.map(view => view.skillName), ['amphoreus-aglaea', 'amphoreus-anaxa'])
  assert.equal(seatForDigit(seats, 1), aglaea)
  assert.equal(seatForDigit(seats, 2), anaxa)
  assert.equal(seatForDigit(seats, 3), undefined)
  assert.equal(seatForDigit(seats, 0), undefined)
  assert.equal(seatForDigit(seats, 10), undefined)
  assert.equal(seatForDigit(seats, 1.5), undefined)
})

test('resolveSeatByName prefers exact matches, then case-insensitive names, aliases, heroId and bare skill', () => {
  assert.deepEqual(resolveSeatByName('那刻夏', views, cards), { kind: 'seat', view: anaxa })
  assert.deepEqual(resolveSeatByName('anaxa', views, cards), { kind: 'seat', view: anaxa })
  assert.deepEqual(resolveSeatByName('ANAXA', views, cards), { kind: 'seat', view: anaxa })
  assert.deepEqual(resolveSeatByName('教授', views, cards), { kind: 'seat', view: anaxa })
  assert.deepEqual(resolveSeatByName('amphoreus-anaxa', views, cards), { kind: 'seat', view: anaxa })
  assert.deepEqual(resolveSeatByName(' aglaea ', views, cards), { kind: 'seat', view: aglaea })
  assert.deepEqual(resolveSeatByName('AGLAEA', views, []), { kind: 'seat', view: aglaea })
})

test('resolveSeatByName routes portal words and refuses blanks, hidden-only misses and undeployed seats', () => {
  for (const word of ['all', 'ALL', '全体', '总览', 'portal']) {
    assert.deepEqual(resolveSeatByName(word, views, cards), { kind: 'portal' }, word)
  }
  assert.equal(resolveSeatByName('', views, cards), undefined)
  assert.equal(resolveSeatByName('   ', views, cards), undefined)
  assert.equal(resolveSeatByName('未部署', views, cards), undefined)
  assert.equal(resolveSeatByName('nobody', views, cards), undefined)
  // Hidden seats stay addressable by name (hidden only removes them from the digit row).
  assert.deepEqual(resolveSeatByName('隐藏', views, cards), { kind: 'seat', view: hiddenSeat })
})

test('resolveSeatByName exact match beats a case-insensitive match on another seat', () => {
  const lower = fixtureView('amphoreus-a', { displayName: 'anaxa', order: 0 })
  const upper = fixtureView('amphoreus-b', { displayName: 'Anaxa', order: 1 })
  assert.deepEqual(resolveSeatByName('Anaxa', [lower, upper], []), { kind: 'seat', view: upper })
  assert.deepEqual(resolveSeatByName('anaxa', [lower, upper], []), { kind: 'seat', view: lower })
})

test('parseSeatLine accepts /seat with or without an argument and rejects other lines', () => {
  assert.deepEqual(parseSeatLine('/seat'), { name: '' })
  assert.deepEqual(parseSeatLine('/seat '), { name: '' })
  assert.deepEqual(parseSeatLine('  /seat   那刻夏  '), { name: '那刻夏' })
  assert.deepEqual(parseSeatLine('/seat all'), { name: 'all' })
  assert.deepEqual(parseSeatLine('/seat two words'), { name: 'two words' })
  assert.equal(parseSeatLine('/seats anaxa'), undefined)
  assert.equal(parseSeatLine('/seatanaxa'), undefined)
  assert.equal(parseSeatLine('seat anaxa'), undefined)
  assert.equal(parseSeatLine('/model'), undefined)
  assert.equal(parseSeatLine(''), undefined)
})

test('hotkeyLabel covers Alt+1..Alt+9 only', () => {
  assert.equal(hotkeyLabel(0), 'Alt+1')
  assert.equal(hotkeyLabel(8), 'Alt+9')
  assert.equal(hotkeyLabel(9), undefined)
  assert.equal(hotkeyLabel(-1), undefined)
})
