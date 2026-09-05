import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../workbench/styles.css', import.meta.url), 'utf8')

function functionSource(name: string): string {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `${name} must exist`)
  const next = source.indexOf('\nfunction ', start + marker.length)
  return source.slice(start, next === -1 ? undefined : next)
}

function ledgerFixture() {
  const state = {
    amph: {
      bindings: [
        { sessionId: 'session-active', skillName: 'amphoreus-anaxa' },
        { sessionId: 'session-current', skillName: 'amphoreus-cipher' },
      ],
      observations: [
        { sessionId: 'session-active', seq: 2, kind: 'dispatch', status: 'accepted', rawLine: '派发正文', payload: '派发正文' },
        { sessionId: 'session-current', seq: 1, kind: 'absence', status: 'open', rawLine: '不应出现', payload: '错误会话' },
        { sessionId: 'session-active', seq: 1, kind: 'receipt', status: 'open', rawLine: '晨星卡｜读取：common.md｜档位：标准', payload: 'common.md' },
      ],
      memory: [
        { skillName: 'amphoreus-anaxa', notes: [{ id: 'note-a', text: '先看 README', createdAt: 1 }], pinnedSessionIds: [], updatedAt: 1 },
        { skillName: 'amphoreus-cipher', notes: [{ id: 'note-c', text: '错误便签', createdAt: 1 }], pinnedSessionIds: [], updatedAt: 1 },
      ],
      cards: [
        { name: 'amphoreus-anaxa', displayName: '那刻夏' },
        { name: 'amphoreus-cipher', displayName: '赛飞儿' },
      ],
    },
    sidebarCollapsed: false,
    ledgerOpen: true,
    activeId: 'thread-active',
    currentDsh: { id: 'session-current' },
    seatId: 'all',
    seats: [{ heroId: 'anaxa', skillName: 'amphoreus-anaxa' }],
    workspace: {
      threads: [
        { id: 'thread-active', dshSessionId: 'session-active' },
        { id: 'thread-current', dshSessionId: 'session-current' },
      ],
    },
  }
  const context = {
    state,
    currentDshThread: () => state.workspace.threads[1],
    escapeHtml: (value: unknown) => String(value ?? '').replaceAll('"', '&quot;'),
    globalThis: {} as Record<string, unknown>,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${functionSource('renderLedger')}\nglobalThis.__renderLedger = renderLedger`, context)
  return {
    state,
    renderLedger: context.globalThis.__renderLedger as () => string,
  }
}

test('ledger follows activeId, keeps raw observation text, and resolves memory from the selected binding', () => {
  const { renderLedger } = ledgerFixture()
  const html = renderLedger()

  assert.match(html, /<details class="ledger" open data-ledger>/u)
  assert.match(html, /<summary>台账<span class="ledger-count">2<\/span><\/summary>/u)
  assert.match(html, /<span class="ledger-kind">回执<\/span>/u)
  assert.match(html, /title="common\.md">晨星卡｜读取：common\.md｜档位：标准<\/span>/u)
  assert.ok(html.indexOf('晨星卡｜读取') < html.indexOf('派发正文'))
  assert.doesNotMatch(html, /不应出现|错误会话|错误便签/u)
  assert.match(html, /席位记忆 <small>那刻夏<\/small>/u)
  assert.match(html, /data-note="note-a"/u)
  assert.match(html, /data-skill="amphoreus-anaxa" data-session="session-active"/u)
})

test('ledger is absent before state or while collapsed and a concrete seat owns its memory', () => {
  const { state, renderLedger } = ledgerFixture()
  state.sidebarCollapsed = true
  assert.equal(renderLedger(), '')
  state.sidebarCollapsed = false
  state.amph = null as never
  assert.equal(renderLedger(), '')

  const next = ledgerFixture()
  next.state.seatId = 'seat:anaxa'
  next.state.activeId = 'thread-current'
  const html = next.renderLedger()
  assert.match(html, /席位记忆 <small>那刻夏<\/small>/u)
  assert.match(html, /先看 README/u)
  assert.doesNotMatch(html, /错误便签/u)
})

test('memory writes are serialized and each PUT response advances the next read-modify-write', async () => {
  const bodies: Array<{ notes: Array<{ id: string }> }> = []
  const state = { amph: { memory: [] as unknown[] } }
  const context = {
    state,
    api: async (_path: string, options: { body: string }) => {
      const body = JSON.parse(options.body) as { notes: Array<{ id: string }> }
      bodies.push(body)
      await Promise.resolve()
      return { memory: { ...body, skillName: 'amphoreus-anaxa', updatedAt: bodies.length } }
    },
    encodeURIComponent,
    Error,
    Promise,
    globalThis: {} as Record<string, unknown>,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`let memoryWriteChain = Promise.resolve()\n${functionSource('putMemory')}\nglobalThis.__putMemory = putMemory`, context)
  const putMemory = context.globalThis.__putMemory as (
    skill: string,
    mutate: (memory: { notes: Array<{ id: string }> }) => { notes: Array<{ id: string }> },
  ) => Promise<unknown>

  await Promise.all(Array.from({ length: 8 }, (_, index) => putMemory('amphoreus-anaxa', memory => ({
    ...memory,
    notes: [...memory.notes, { id: `note-${index}` }],
  }))))

  assert.deepEqual(bodies.map(body => body.notes.length), [1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual((state.amph.memory[0] as { notes: Array<{ id: string }> }).notes.map(note => note.id), [
    'note-0', 'note-1', 'note-2', 'note-3', 'note-4', 'note-5', 'note-6', 'note-7',
  ])
})

test('ledger actions, toggle persistence, shell placement, and style contract stay wired', () => {
  const ledger = functionSource('renderLedger')
  assert.doesNotMatch(ledger, /卡｜读取：｜档位：/u)
  assert.match(source, /dispatchLaneCollapsed: false, ledgerOpen: false/u)
  assert.match(source, /app\.addEventListener\('toggle',[\s\S]*state\.ledgerOpen = details\.open[\s\S]*\}, true\)/u)
  assert.match(source, /\$\{renderThreadTree\(threads, seat\)\}<\/nav>\$\{unprojectableList\}\$\{renderLedger\(\)\}<\/aside>/u)
  assert.match(source, /button\.dataset\.action === 'ledger-insert'[\s\S]*post\('amphoreus:insert-input', \{ text: button\.dataset\.text \}\)/u)
  assert.match(source, /button\.dataset\.action === 'ledger-delete-note'[\s\S]*window\.confirm\('删除这条便签？'\)[\s\S]*notes: memory\.notes\.filter/u)
  assert.match(source, /form\.matches\('\[data-ledger-add\]'\)[\s\S]*crypto\.randomUUID\(\)[\s\S]*createdAt: Date\.now\(\)/u)
  assert.equal(source.match(/回执/gu)?.length, ledger.match(/回执/gu)?.length)

  assert.equal(css.match(/@e-begin ledger/gu)?.length, 1)
  assert.equal(css.match(/@e-end ledger/gu)?.length, 1)
  const block = css.slice(css.indexOf('/* @e-begin ledger */'), css.indexOf('/* @e-end ledger */'))
  assert.ok((block.match(/var\(--dsw-alias-/gu) ?? []).length >= 8)
  assert.doesNotMatch(block, /\[data-theme="dark"\]/u)
  assert.doesNotMatch(block, /^\.sidebar\s*\{/mu)
  assert.equal(css.match(/canvas-controls/gu)?.length, 4)
})
