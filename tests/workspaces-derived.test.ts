import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWorkspacesSource, derivedUrl } from '../src/client/workspaces-source.ts'
import type { AmphoreusState } from '../src/shared/api.ts'
import { HERO_VISUALS } from '../src/shared/heroes.ts'

const idle = <T>(value: T) => ({ getSnapshot: () => value, subscribe: () => () => {} })
const visual = HERO_VISUALS.find(hero => hero.heroId === 'aglaea')!

function state(derived: string[], assetsConfigured: boolean): AmphoreusState {
  return {
    effectiveConfig: { assetsConfigured },
    assets: { derived },
    suite: undefined,
    seatDirs: [],
    bindings: [],
    seats: [{
      heroId: visual.heroId,
      skillName: visual.skill,
      hidden: false,
      displayName: visual.heroId,
      duties: [],
      status: 'deployed',
      order: visual.order,
    }],
  } as unknown as AmphoreusState
}

function seat(derived: string[], assetsConfigured: boolean) {
  return createWorkspacesSource(
    idle({ ids: [], byId: {} }),
    idle({ state: state(derived, assetsConfigured) }),
  ).getSnapshot().seats[0]!
}

test('derived seat assets take priority independently of assetsRoot', () => {
  const derived = [
    'aglaea/cover-34.webp',
    'aglaea/cover-169.webp',
    'aglaea/chronicle.webp',
    'aglaea/card.webp',
    'aglaea/sticker.webp',
  ]
  const result = seat(derived, false)
  assert.equal(result.heroId, 'aglaea')
  assert.equal(result.coverUrl, '/amphoreus/derived/aglaea/cover-34.webp')
  assert.equal(result.coverWideUrl, '/amphoreus/derived/aglaea/cover-169.webp')
  assert.equal(result.chronicleUrl, '/amphoreus/derived/aglaea/chronicle.webp')
  assert.equal(result.cardUrl, '/amphoreus/derived/aglaea/card.webp')
  assert.equal(result.stickerUrl, '/amphoreus/derived/aglaea/sticker.webp')
})

test('missing derived files fall back only when the original asset root is configured', () => {
  const original = seat([], true)
  assert.equal(original.coverUrl, null)
  assert.equal(original.coverWideUrl, null)
  assert.match(original.chronicleUrl ?? '', /^\/amphoreus\/assets\//u)
  assert.match(original.cardUrl ?? '', /^\/amphoreus\/assets\//u)
  assert.match(original.stickerUrl ?? '', /^\/amphoreus\/assets\//u)

  const unavailable = seat([], false)
  assert.equal(unavailable.coverUrl, null)
  assert.equal(unavailable.coverWideUrl, null)
  assert.equal(unavailable.chronicleUrl, null)
  assert.equal(unavailable.cardUrl, null)
  assert.equal(unavailable.stickerUrl, null)
})

test('derivedUrl requires exact set membership', () => {
  const available = ['aglaea/cover-34.webp']
  assert.equal(derivedUrl(available, 'aglaea', 'cover-34.webp'), '/amphoreus/derived/aglaea/cover-34.webp')
  assert.equal(derivedUrl(available, 'aglaea', 'cover-169.webp'), null)
})
