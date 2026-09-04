import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BindingRecord, SeatRecord } from '../src/host/store.ts'
import type { AmphoreusState } from '../src/shared/api.ts'
import { fallbackHue, heroVisualOf } from '../src/shared/heroes.ts'
import { createWorkspacesSource } from '../src/client/workspaces-source.ts'

const idle = <T>(value: T) => ({ getSnapshot: () => value, subscribe: () => () => {} })

const seat = (skillName: string, overrides: Partial<SeatRecord> = {}): SeatRecord => ({
  skillName,
  heroId: null,
  displayName: skillName,
  aliases: [],
  duties: [],
  status: 'deployed',
  order: 10,
  firstSeenAt: 1,
  lastSeenAt: 1,
  ...overrides,
})

const binding = (sessionId: string, skillName: string, source: BindingRecord['source']): BindingRecord => ({
  sessionId,
  skillName,
  boundAt: 1,
  source,
  injection: { state: 'done', at: 1 },
})

test('workspace payload retains unknown visible seats with fallback hue and carries binding source', () => {
  const visual = heroVisualOf('amphoreus-anaxa')!
  const unknownSkill = 'amphoreus-future-card'
  const state = {
    effectiveConfig: { assetsConfigured: false },
    assets: { derived: [] },
    suite: undefined,
    seatDirs: [],
    seats: [
      seat(visual.skill, { heroId: visual.heroId, order: 1 }),
      seat(unknownSkill, { heroId: null, order: 2 }),
      seat('amphoreus-hidden-card', { hidden: true, order: 3 }),
    ],
    bindings: [
      binding('session-known', visual.skill, 'seat-new'),
      binding('session-unknown', unknownSkill, 'fork-inherit'),
    ],
  } as unknown as AmphoreusState
  const payload = createWorkspacesSource(
    idle({
      ids: ['session-known', 'session-unknown', 'session-unbound', 'session-blank'],
      byId: {
        'session-known': { displayTitle: 'Known', cwd: 'D:/known', running: false, blank: false },
        'session-unknown': { displayTitle: 'Unknown', running: true, blank: false },
        'session-unbound': { displayTitle: 'Unbound', running: false, blank: false },
        'session-blank': { displayTitle: 'Blank', running: false, blank: true },
      },
    }),
    idle({ state }),
  ).getSnapshot()

  assert.equal(payload.seats.length, 2)
  const known = payload.seats.find(candidate => candidate.skillName === visual.skill)!
  const unknown = payload.seats.find(candidate => candidate.skillName === unknownSkill)!
  assert.equal(known.heroId, visual.heroId)
  assert.equal(known.accent, visual.palette.accent)
  assert.equal(known.hue, null)
  assert.equal(unknown.heroId, null)
  assert.equal(unknown.accent, null)
  assert.equal(unknown.hue, fallbackHue(unknownSkill))
  assert.equal(Object.hasOwn(unknown, 'sessionIds'), false)

  assert.equal(payload.sessions.length, 3)
  assert.deepEqual(payload.sessions.find(session => session.id === 'session-known'), {
    id: 'session-known',
    title: 'Known',
    parentId: null,
    cwd: 'D:/known',
    running: false,
    blank: false,
    skillName: visual.skill,
    face: null,
    source: 'seat-new',
  })
  assert.equal(payload.sessions.find(session => session.id === 'session-unknown')?.source, 'fork-inherit')
  assert.deepEqual(payload.sessions.find(session => session.id === 'session-unbound'), {
    id: 'session-unbound',
    title: 'Unbound',
    parentId: null,
    cwd: null,
    running: false,
    blank: false,
    skillName: null,
    face: null,
    source: null,
  })
  assert.equal(payload.sessions.some(session => session.id === 'session-blank'), false)
})
