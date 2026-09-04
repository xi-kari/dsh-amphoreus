/** Pure-function tests for the DOM garnish layer (greeting + chimera pick). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chimeraFor, greetingFor } from '../src/client/garnish.ts'
import { CHIMERA_STICKERS } from '../src/shared/heroes.ts'

test('greetingFor maps day hours to the three greetings', () => {
  assert.equal(greetingFor(5), '早上好，开拓者')
  assert.equal(greetingFor(9), '早上好，开拓者')
  assert.equal(greetingFor(11), '早上好，开拓者')
  assert.equal(greetingFor(12), '下午好，开拓者')
  assert.equal(greetingFor(17), '下午好，开拓者')
  assert.equal(greetingFor(18), '晚上好，开拓者')
  assert.equal(greetingFor(23), '晚上好，开拓者')
  assert.equal(greetingFor(0), '晚上好，开拓者')
  assert.equal(greetingFor(4), '晚上好，开拓者')
})

test('chimeraFor is stable per title and always picks a known sticker', () => {
  const first = chimeraFor('测试工作区')
  assert.equal(chimeraFor('测试工作区'), first)
  assert.ok((CHIMERA_STICKERS as readonly string[]).includes(first))
  assert.ok((CHIMERA_STICKERS as readonly string[]).includes(chimeraFor('')))
  // Different titles usually land on different chimeras (hash spread sanity).
  const picks = new Set(['甲', '乙', '丙', '丁', '戊', '己'].map(chimeraFor))
  assert.ok(picks.size >= 2)
})
