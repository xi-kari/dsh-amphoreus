import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GREETING_HERO_IDS, dayPartOf, seatGreetingFor } from '../src/client/greetings.ts'
import { HERO_VISUALS } from '../src/shared/heroes.ts'

test('every non-global seat has three bespoke greetings that address the Trailblazer', () => {
  const seats = HERO_VISUALS.filter(hero => hero.heroId !== 'cyrene').map(hero => hero.heroId)
  assert.deepEqual([...GREETING_HERO_IDS].sort(), [...seats].sort())
  const seen = new Set<string>()
  for (const heroId of seats) {
    for (const hour of [8, 14, 21]) {
      const line = seatGreetingFor(heroId, hour)
      assert.ok(line.includes('开拓者'), `${heroId}@${hour}: ${line}`)
      assert.ok(line.length >= 6 && line.length <= 40, `${heroId}@${hour}: length ${line.length}`)
      assert.notEqual(line, seatGreetingFor(null, hour), `${heroId}@${hour} must differ from the neutral line`)
      seen.add(line)
    }
  }
  assert.equal(seen.size, seats.length * 3, 'greetings must be pairwise distinct')
})

test('global, unknown and undefined seats fall back to the neutral day-part greeting', () => {
  assert.equal(seatGreetingFor(null, 9), '早上好，开拓者')
  assert.equal(seatGreetingFor(undefined, 15), '下午好，开拓者')
  assert.equal(seatGreetingFor('cyrene', 22), '晚上好，开拓者')
  assert.equal(seatGreetingFor('not-a-seat', 3), '晚上好，开拓者')
  assert.deepEqual([dayPartOf(5), dayPartOf(11), dayPartOf(12), dayPartOf(17), dayPartOf(18), dayPartOf(4)],
    ['morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening'])
})
