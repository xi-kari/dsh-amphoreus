import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { suggestSeats } from '../src/shared/dispatch-match.ts'

const dispatch = [
  { needs: ['代码', '方案', '逻辑', '论证评审'], roleText: '那刻夏', skill: 'amphoreus-anaxa' },
  { needs: ['日志', '纪要', 'changelog', '进度快照'], roleText: '三月七', skill: 'amphoreus-march7th', face: '三月七' },
  { needs: ['回滚', '撤销', '脱敏', '清档', '涉密整理'], roleText: '长夜月特勤', skill: 'amphoreus-march7th', face: '长夜月' },
  { needs: ['重构', '批量迁移'], roleText: '白厄', skill: 'amphoreus-phainon' },
] as const

const cards = [
  { name: 'amphoreus-anaxa', displayName: '那刻夏', aliases: ['那刻夏教授'] },
  { name: 'amphoreus-march7th', displayName: '三月七', aliases: ['长夜月'] },
  { name: 'amphoreus-phainon', displayName: '白厄', aliases: [] },
] as const

test('suggestSeats scores literal matches, direct names, limits, and empty input', () => {
  const review = suggestSeats('帮我评审这段代码的逻辑', dispatch, cards)
  assert.equal(review[0]?.skill, 'amphoreus-anaxa')
  assert.deepEqual(review[0]?.hits, ['代码', '逻辑'])

  const log = suggestSeats('日志和 changelog 整理，回滚一下', dispatch, cards)
  const march = log.find(candidate => candidate.skill === 'amphoreus-march7th')
  assert.equal(march?.score, 13)
  assert.equal(march?.face, '三月七')
  assert.deepEqual(march?.hits, ['日志', 'changelog', '回滚'])

  assert.deepEqual(suggestSeats('', dispatch, cards), [])
  assert.equal(suggestSeats('白厄来做大重构', dispatch, cards)[0]?.skill, 'amphoreus-phainon')
  assert.ok((suggestSeats('白厄来做大重构', dispatch, cards)[0]?.score ?? 0) >= 100)
  assert.deepEqual(suggestSeats('随便聊聊', dispatch, cards), [])
  assert.equal(suggestSeats('代码 日志', dispatch, cards, 1).length, 1)
})

test('same-skill rows add unique hit lengths and apply a direct-name bonus once', () => {
  const keyword = suggestSeats('日志日志 changelog 回滚', dispatch, cards)[0]
  assert.equal(keyword?.score, 13)
  assert.deepEqual(keyword?.hits, ['日志', 'changelog', '回滚'])

  const named = suggestSeats('请三月七来处理', dispatch, cards)[0]
  assert.equal(named?.skill, 'amphoreus-march7th')
  assert.equal(named?.score, 100)
  assert.deepEqual(named?.hits, ['三月七'])

  const namedSpecialOps = suggestSeats('请长夜月来处理', dispatch, cards)[0]
  assert.equal(namedSpecialOps?.score, 100)
  assert.equal(namedSpecialOps?.face, '长夜月')

  const specialOps = suggestSeats('请长夜月回滚', dispatch, cards)[0]
  assert.equal(specialOps?.face, '长夜月')
  assert.equal(specialOps?.score, 102)
})

test('mirror matches TS for all dispatch cases', () => {
  const source = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')
  const begin = source.indexOf('// @mirror-begin suggestSeats')
  const end = source.indexOf('// @mirror-end suggestSeats')
  assert.ok(begin >= 0 && end > begin)
  const context = { globalThis: {} as Record<string, unknown> }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${source.slice(begin, end)}\nglobalThis.__suggestSeats = suggestSeats`, context)
  const mirror = context.globalThis.__suggestSeats as typeof suggestSeats
  const normalize = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

  for (const [input, limit] of [
    ['帮我评审这段代码的逻辑', 3],
    ['日志和 changelog 整理，回滚一下', 3],
    ['', 3],
    ['白厄来做大重构', 3],
    ['随便聊聊', 3],
    ['请长夜月来处理', 3],
    ['代码 日志', 1],
  ] as const) {
    assert.deepEqual(normalize(mirror(input, dispatch, cards, limit)), suggestSeats(input, dispatch, cards, limit))
  }
})
