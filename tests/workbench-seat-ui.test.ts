import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { fallbackHue } from '../src/shared/heroes.ts'

const appSource = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../workbench/styles.css', import.meta.url), 'utf8')

function functionSource(name: string): string {
  const marker = `function ${name}(`
  const start = appSource.indexOf(marker)
  assert.notEqual(start, -1, `${name} must exist`)
  const next = appSource.indexOf('\nfunction ', start + marker.length)
  return appSource.slice(start, next === -1 ? undefined : next)
}

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
const count = (source: string, token: string): number => source.split(token).length - 1

test('seat identity uses host accents, deterministic unknown hues, and binding metadata', () => {
  const state = {
    workspace: {
      threads: [
        { id: 'known', skillName: 'amphoreus-anaxa', face: 'review', source: 'manual' },
        { id: 'unknown', skillName: 'amphoreus-unknown', face: null, source: 'seat-new' },
        { id: 'missing', skillName: 'amphoreus-future', face: null, source: null },
        { id: 'unbound', skillName: null, face: null, source: null },
      ],
    },
    seats: [
      { skillName: 'amphoreus-anaxa', accent: '#23664d', hue: null, displayName: '那刻夏', stickerUrl: '/anaxa.webp' },
      { skillName: 'amphoreus-unknown', accent: null, hue: 161, displayName: '未知席', stickerUrl: null },
    ],
  }
  const context = { state, globalThis: {} as Record<string, unknown> }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${functionSource('hashHue')}\n${functionSource('seatOfCard')}\nglobalThis.__seatOfCard = seatOfCard`, context)
  const seatOfCard = context.globalThis.__seatOfCard as (card: { dshThreadId: string }) => unknown

  assert.deepEqual(plain(seatOfCard({ dshThreadId: 'known' })), {
    skillName: 'amphoreus-anaxa',
    seat: state.seats[0],
    accent: '#23664d',
    face: 'review',
    source: 'manual',
  })
  assert.deepEqual(plain(seatOfCard({ dshThreadId: 'unknown' })), {
    skillName: 'amphoreus-unknown',
    seat: state.seats[1],
    accent: 'hsl(161 45% 52%)',
    face: null,
    source: 'seat-new',
  })
  assert.equal((seatOfCard({ dshThreadId: 'missing' }) as { accent: string }).accent, `hsl(${fallbackHue('amphoreus-future')} 45% 52%)`)
  assert.equal((seatOfCard({ dshThreadId: 'unbound' }) as { accent: string }).accent, '#8a681c')
})

test('conversation cards render known stickers and unknown generic badges without changing folios', () => {
  const state = {
    workspace: {
      threads: [
        { id: 'known', dshSessionId: 'known', skillName: 'amphoreus-anaxa', face: 'review', source: 'manual' },
        { id: 'unknown', dshSessionId: 'unknown', skillName: 'amphoreus-unknown', face: null, source: 'seat-new' },
      ],
    },
    seats: [
      { skillName: 'amphoreus-anaxa', accent: '#23664d', hue: null, displayName: '那刻夏', stickerUrl: '/anaxa.webp' },
      { skillName: 'amphoreus-unknown', accent: null, hue: 161, displayName: '未知席', stickerUrl: null },
    ],
    unprojectable: new Map(),
    selectedCardId: null,
    collapsedCardIds: new Set(),
    canvasTurnTotals: new Map([['known', 2], ['unknown', 1]]),
  }
  const escapeHtml = (value: unknown): string => String(value ?? '')
  const context = {
    state,
    escapeHtml,
    renderMarkdown: (value: string) => `<p>${value}</p>`,
    clampCardText: (value: string) => value,
    globalThis: {} as Record<string, unknown>,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${functionSource('hashHue')}\n${functionSource('seatOfCard')}\n${functionSource('handoffFromBadge')}\n${functionSource('conversationCard')}\nglobalThis.__conversationCard = conversationCard`, context)
  const conversationCard = context.globalThis.__conversationCard as (card: Record<string, unknown>, graph: { childCounts: Map<string, number> }) => string
  const card = (thread: string) => ({
    id: `${thread}:turn:1`,
    positionKey: `${thread}:turn:1`,
    dshThreadId: thread,
    placeholder: false,
    question: '问题',
    turnIndex: 0,
    canContinue: false,
    parentId: null,
    sourceSeq: 1,
    position: { x: 10, y: 20 },
    answer: { pending: false, text: '回答', sourceSeq: 2 },
    error: null,
    processCount: 0,
  })
  const graph = { childCounts: new Map<string, number>() }
  const known = conversationCard(card('known'), graph)
  const unknown = conversationCard(card('unknown'), graph)

  assert.match(known, /data-seat="amphoreus-anaxa"/u)
  assert.match(known, /data-folio="01" data-folios="02"/u)
  assert.match(known, /--thread-color:#23664d/u)
  assert.match(known, /class="card-seat-mark" src="\/anaxa\.webp"/u)
  assert.match(known, /<b>那刻夏<\/b>/u)
  assert.match(known, /class="card-seat-face">review/u)

  assert.match(unknown, /data-seat="amphoreus-unknown"/u)
  assert.match(unknown, /--thread-color:hsl\(161 45% 52%\)/u)
  assert.match(unknown, /card-seat-mark-generic" style="--seat-hue:161"/u)
  assert.match(unknown, /<b>未知席<\/b>/u)
})

test('tab entry identity reacts to late bindings without repeating an unchanged session-seat pair', () => {
  const context = { globalThis: {} as Record<string, unknown> }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${functionSource('tabEntryOf')}\nglobalThis.__tabEntryOf = tabEntryOf`, context)
  const tabEntryOf = context.globalThis.__tabEntryOf as (data: unknown) => { key: string; target: string }
  const unbound = tabEntryOf({ session: { id: 'session-a' }, seat: null })
  const bound = tabEntryOf({ session: { id: 'session-a' }, seat: { skillName: 'amphoreus-anaxa', heroId: 'anaxa' } })
  const repeated = tabEntryOf({ session: { id: 'session-a' }, seat: { skillName: 'amphoreus-anaxa', heroId: 'anaxa' } })
  const unknown = tabEntryOf({ session: { id: 'session-a' }, seat: { skillName: 'amphoreus-future', heroId: null } })

  assert.equal(unbound.target, 'all')
  assert.equal(bound.target, 'seat:anaxa')
  assert.equal(unknown.target, 'all')
  assert.notEqual(unbound.key, bound.key)
  assert.notEqual(bound.key, unknown.key)
  assert.equal(bound.key, repeated.key)
  assert.equal(bound.key, 'session-a\u0000amphoreus-anaxa\u0000anaxa')
})

test('thread tree groups multiple cwd values stably and stays flat for one directory', () => {
  const state = { activeId: 'c' }
  const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
  const threadListTitle = (thread: { title: string }): string => thread.title
  const context = { state, escapeHtml, threadListTitle, globalThis: {} as Record<string, unknown> }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${functionSource('renderThreadRow')}\n${functionSource('renderThreadTree')}\nglobalThis.__renderThreadTree = renderThreadTree`, context)
  const renderThreadTree = context.globalThis.__renderThreadTree as (threads: unknown[], seat: unknown) => string
  const threads = [
    { id: 'a', title: 'A', cwd: 'D:\\one', parentId: null },
    { id: 'b', title: 'B', cwd: 'E:/two', parentId: null },
    { id: 'c', title: 'C', cwd: 'D:\\one', parentId: 'a' },
    { id: 'd', title: 'D', cwd: null, parentId: null },
  ]
  const html = renderThreadTree(threads, { accent: '#23664d' })

  assert.equal(count(html, 'canvas-group-label'), 3)
  assert.match(html, /title="D:\\one">one</u)
  assert.match(html, /title="E:\/two">two</u)
  assert.match(html, /title="">未指定目录</u)
  assert.ok(html.indexOf('>A</span>') < html.indexOf('>C</span>'))
  assert.ok(html.indexOf('>C</span>') < html.indexOf('>B</span>'))
  assert.match(html, /tree-row active[^>]*data-thread="c"/u)
  assert.equal(count(renderThreadTree(threads.slice(0, 1), { accent: '#23664d' }), 'canvas-group-label'), 0)
  assert.equal(renderThreadTree([], null), '<p class="tree-empty">暂未同步会话</p>')
})

test('portal iframe close control is present only for the embedded portal mode', () => {
  const renderControl = (mode: 'portal' | 'tab', embedded: boolean): string => {
    const top = {}
    const window = { parent: embedded ? {} : top }
    if (!embedded) window.parent = window
    const context = { BOOT_MODE: mode, window, globalThis: {} as Record<string, unknown> }
    context.globalThis = context
    vm.createContext(context)
    vm.runInContext(`${functionSource('portalCloseControl')}\nglobalThis.__portalCloseControl = portalCloseControl`, context)
    return (context.globalThis.__portalCloseControl as () => string)()
  }

  assert.match(renderControl('portal', true), /data-action="close-portal"/u)
  assert.equal(renderControl('portal', false), '')
  assert.equal(renderControl('tab', true), '')
})

test('seat UI preserves canvas contracts while splitting tab and portal behavior', () => {
  assert.equal(count(appSource, '#3478f6'), 0)
  assert.equal(count(cssSource, '#3478f6'), 25)
  assert.equal(count(appSource, 'dsh-amphoreus:last-seat'), 0)
  assert.equal(count(appSource, 'dsh-amphoreus:workbench-last-seat'), 2)
  assert.equal(count(appSource, 'amphoreus:close'), 2)
  assert.equal(count(appSource, 'amphoreus:seat-changed'), 3)
  assert.equal(count(appSource, 'bindingBySession'), 0)
  assert.match(appSource, /const BOOT_MODE = new URL\(location\.href\)\.searchParams\.get\('mode'\) === 'portal' \? 'portal' : 'tab'/u)
  assert.match(appSource, /mode: BOOT_MODE === 'portal' \? 'portal' : 'canvas'/u)
  assert.match(appSource, /seatId: BOOT_MODE === 'portal' \? null : restoredSeatId/u)
  assert.match(appSource, /source: session\.source \?\? null,[\s\S]*cwd: session\.cwd \?\? null,/u)
  assert.match(appSource, /data-action="\$\{portalAction\}"/u)
  assert.match(appSource, /post\('amphoreus:open-portal'\)/u)
  assert.match(appSource, /post\('amphoreus:open-seat', \{ heroId:/u)
  assert.match(functionSource('portalCloseControl'), /BOOT_MODE !== 'portal'/u)
  assert.doesNotMatch(functionSource('renderPortal'), /BOOT_MODE/u)

  const current = appSource.slice(
    appSource.indexOf("if (data.type === 'amphoreus:current-session')"),
    appSource.indexOf("if (data.type === 'amphoreus:messages'"),
  )
  assert.ok(current.indexOf('state.currentSessionId =') < current.indexOf('const tabEntry = tabEntryOf(data)'))
  assert.ok(current.indexOf('mapCardSessionSwitches.delete') < current.indexOf('const tabEntry = tabEntryOf(data)'))
  assert.match(current, /tabEntry\.key !== state\.tabEntryKey/u)
  assert.match(current, /state\.seatId !== tabEntry\.target/u)
  assert.doesNotMatch(current, /!state\.tabEntered/u)

  const card = functionSource('conversationCard')
  assert.match(card, /data-seat="\$\{escapeHtml\(seatInfo\.skillName \?\? ''\)\}"/u)
  assert.match(card, /data-folio="\$\{String\(card\.turnIndex \+ 1\)\.padStart\(2, '0'\)\}"/u)
  assert.match(card, /data-folios="\$\{String\(state\.canvasTurnTotals\.get\(card\.dshThreadId\) \?\? 1\)\.padStart\(2, '0'\)\}"/u)
  assert.match(card, /card-seat-badge/u)
  assert.match(card, /card-seat-face/u)
  assert.doesNotMatch(functionSource('draftCard'), /data-folios?=/u)
  assert.doesNotMatch(functionSource('conversationCards'), /seatOfCard|card-seat-badge/u)
  assert.match(appSource, /const CARD_WIDTH = 310/u)
  assert.match(appSource, /const CARD_HEIGHT = 276/u)

  assert.doesNotMatch(cssSource, /thread-color[^\n]*!important/u)
  assert.match(cssSource, /\.thread-card:hover \{[^}]*inset 3px 0 0 var\(--thread-color\)/u)
  assert.match(cssSource, /\.card-seat-badge \{/u)
  assert.match(cssSource, /\.card-seat-mark-generic \{[^}]*hsl\(var\(--seat-hue\)/u)
  assert.match(cssSource, /\.portal-close \{/u)
})
