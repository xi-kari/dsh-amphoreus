import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const appSource = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../workbench/styles.css', import.meta.url), 'utf8')

function functionSource(name: string): string {
  const marker = `function ${name}(`
  const start = appSource.indexOf(marker)
  assert.notEqual(start, -1, `${name} must exist`)
  const next = appSource.indexOf('\nfunction ', start + marker.length)
  return appSource.slice(start, next === -1 ? undefined : next)
}

function cssRule(selector: string): string {
  const start = cssSource.indexOf(`${selector} {`)
  assert.notEqual(start, -1, `${selector} must exist`)
  const end = cssSource.indexOf('}', start)
  assert.notEqual(end, -1, `${selector} must be closed`)
  return cssSource.slice(start, end + 1)
}

test('canvas folio totals use every conversation card before collapsed graph filtering', () => {
  const allCards = [
    { id: 'a:1', dshThreadId: 'a' },
    { id: 'a:2', dshThreadId: 'a' },
    { id: 'b:1', dshThreadId: 'b' },
  ]
  const collapsedCards = [allCards[0]]
  const state = {
    workspace: { threads: [{ id: 'a' }, { id: 'b' }] },
    draft: null,
    canvasTurnTotals: new Map<string, number>(),
    canvasCards: undefined,
    canvasCardsById: undefined,
    canvasGraph: undefined,
    inspectorCardId: null,
    inspectorOpening: false,
    canvasViewInitialized: true,
    canvasCamera: { x: 0, y: 0 },
    canvasNeedsCenter: false,
    mountedCardIds: new Set<string>(),
    zoom: 1,
  }
  let graphInput: unknown
  const context = {
    state,
    conversationCards: () => allCards,
    conversationGraphView: (cards: unknown) => {
      graphInput = cards
      return { cards: collapsedCards, childCounts: new Map() }
    },
    visibleCardIds: () => new Set(collapsedCards.map(card => card.id)),
    initialCanvasCamera: () => ({ x: 0, y: 0 }),
    renderCardInspector: () => '',
    canvasConnectors: () => '',
    conversationCard: () => '',
    draftCard: () => '',
    globalThis: {} as Record<string, unknown>,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${functionSource('renderCanvas')}\nglobalThis.__renderCanvas = renderCanvas`, context)
  const renderCanvas = context.globalThis.__renderCanvas as () => string

  renderCanvas()

  assert.equal(graphInput, allCards)
  assert.equal(state.canvasTurnTotals.get('a'), 2)
  assert.equal(state.canvasTurnTotals.get('b'), 1)
  assert.equal(state.canvasTurnTotals.size, 2)
  assert.equal(state.canvasCards, collapsedCards)

  const source = functionSource('renderCanvas')
  const allCardsAt = source.indexOf('const allCards = conversationCards(threads)')
  const totalsAt = source.indexOf('state.canvasTurnTotals')
  const graphAt = source.indexOf('conversationGraphView(allCards)')
  assert.ok(allCardsAt >= 0 && totalsAt > allCardsAt && graphAt > totalsAt)
})

test('magazine markup layers both shells and supplies folio, cover, portal, and detail metadata', () => {
  const render = functionSource('render')
  assert.equal(render.match(/magazine-\$\{state\.magazineMode\}/gu)?.length, 2)
  const shellLines = render.split(/\r?\n/u).filter(line => line.includes('app.innerHTML = `<main class="synapse-shell') && line.includes('magazine-${state.magazineMode}'))
  assert.equal(shellLines.length, 2)
  assert.equal(shellLines.filter(line => line.includes('portal-shell')).length, 1)
  assert.equal(shellLines.filter(line => !line.includes('portal-shell')).length, 1)

  const card = functionSource('conversationCard')
  assert.match(card, /data-folio="\$\{String\(card\.turnIndex \+ 1\)\.padStart\(2, '0'\)\}"/u)
  assert.match(card, /data-folios="\$\{String\(state\.canvasTurnTotals(?:\?\.)?\.get\(card\.dshThreadId\) \?\? 1\)\.padStart\(2, '0'\)\}"/u)

  const thread = functionSource('renderThread')
  assert.ok((thread.match(/data-title=/gu) ?? []).length >= 2)
  assert.ok((thread.match(/data-volume=/gu) ?? []).length >= 2)
  assert.match(thread, /<section class="detail-view"[^>]*data-title=[^>]*data-volume=/u)
  assert.match(thread, /<header class="detail-head"[^>]*data-title=[^>]*data-volume=/u)

  const seatCardSlotAt = render.indexOf('const seatCardSlot')
  const seatCardSlot = render.slice(seatCardSlotAt, render.indexOf('const seatHero', seatCardSlotAt))
  assert.match(render, /seatCoverUrl\s*=\s*typeof seat(?:\?\.|\.)coverUrl/u)
  assert.match(render, /seatCardArt\s*=\s*seatCoverUrl \?\? seat(?:\?\.|\.)chronicleUrl/u)
  assert.match(seatCardSlot, /data-volume=/u)
  assert.match(seatCardSlot, /data-title=/u)
  assert.match(seatCardSlot, /data-cover="1"/u)
  assert.match(seatCardSlot, /<figcaption data-title=/u)

  const portal = functionSource('renderPortal')
  assert.match(portal, /coverUrl\s*=\s*typeof seat\.coverUrl/u)
  assert.match(portal, /artUrl\s*=\s*coverUrl \?\? seat\.chronicleUrl/u)
  assert.match(portal, /portal-kicker portal-kicker-full/u)
  assert.match(portal, /<i class="portal-no" data-volume=/u)

  const state = {
    seats: [
      {
        heroId: 'cover', deployed: true, displayName: 'Cover', ordinal: 1, volume: 1,
        coverUrl: '/derived/cover.webp', chronicleUrl: '/raw/cover.jpg', stickerUrl: null,
        duties: [], accent: '#112233', accent2: '#445566',
      },
      {
        heroId: 'fallback', deployed: true, displayName: 'Fallback', ordinal: 2, volume: 2,
        coverUrl: null, chronicleUrl: '/raw/fallback.jpg', stickerUrl: null,
        duties: [], accent: '#112233', accent2: '#445566',
      },
    ],
  }
  const context = {
    state,
    escapeHtml: (value: unknown) => String(value),
    seatSessionCount: () => 0,
    globalThis: {} as Record<string, unknown>,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${portal}\nglobalThis.__renderPortal = renderPortal`, context)
  const html = (context.globalThis.__renderPortal as () => string)()
  const cards = html.match(/<button class="portal-card[\s\S]*?<\/button>/gu) ?? []
  assert.equal(cards.length, 2)
  assert.match(cards[0]!, /data-volume="01"/u)
  assert.match(cards[0]!, /data-cover="1"/u)
  assert.match(cards[0]!, /src="\/derived\/cover\.webp"/u)
  assert.match(cards[1]!, /data-volume="02"/u)
  assert.doesNotMatch(cards[1]!, /data-cover=/u)
  assert.match(cards[1]!, /src="\/raw\/fallback\.jpg"/u)
})

test('magazine class synchronization swaps the existing shell immediately', () => {
  class FakeElement {
    readonly classes = new Set(['synapse-shell', 'portal-shell', 'magazine-light'])
    readonly child = {}
    readonly classList = {
      add: (...names: string[]) => names.forEach(name => this.classes.add(name)),
      remove: (...names: string[]) => names.forEach(name => this.classes.delete(name)),
      toggle: (name: string, force?: boolean) => {
        const enabled = force ?? !this.classes.has(name)
        if (enabled) this.classes.add(name)
        else this.classes.delete(name)
        return enabled
      },
    }
  }
  const shell = new FakeElement()
  const state = { magazineMode: 'full' }
  let queryCount = 0
  const context = {
    state,
    document: {
      querySelector: (selector: string) => {
        queryCount += 1
        assert.equal(selector, '.synapse-shell')
        return shell
      },
    },
    HTMLElement: FakeElement,
    globalThis: {} as Record<string, unknown>,
  }
  context.globalThis = context
  const syncSource = functionSource('syncMagazineClass')
  assert.doesNotMatch(syncSource, /innerHTML|outerHTML|replaceWith|\brender\s*\(/u)
  vm.createContext(context)
  vm.runInContext(`${syncSource}\nglobalThis.__syncMagazineClass = syncMagazineClass`, context)
  const syncMagazineClass = context.globalThis.__syncMagazineClass as (mode: string) => boolean
  const child = shell.child

  assert.equal(syncMagazineClass('full'), true)

  assert.equal(queryCount, 1)
  assert.equal(shell.classes.has('magazine-light'), false)
  assert.equal(shell.classes.has('magazine-full'), true)
  assert.equal(shell.child, child)

  const handler = appSource.slice(
    appSource.indexOf("if (data.type === 'amphoreus:magazine-mode'"),
    appSource.indexOf("if (data.type === 'amphoreus:workspaces'"),
  )
  const stateAt = handler.indexOf('state.magazineMode = data.mode')
  const datasetAt = handler.indexOf('document.documentElement.dataset.magazine = data.mode')
  const syncAt = handler.indexOf('syncMagazineClass(data.mode)')
  assert.ok(stateAt >= 0)
  assert.ok(datasetAt > stateAt)
  assert.ok(syncAt > datasetAt)
  assert.doesNotMatch(handler, /\brender\(|deferCanvasRefresh\(/u)
})

test('full magazine CSS has the complete layer and keeps per-card seat color primary', () => {
  const lineStartRules = cssSource.split(/\r?\n/u).filter(line => line.startsWith('.magazine-full')).length
  const typeShorthands = cssSource.match(/font: var\(--amphoreus-type-/gu)?.length ?? 0
  assert.ok(lineStartRules >= 30, `expected at least 30 .magazine-full rules, got ${lineStartRules}`)
  assert.ok(typeShorthands >= 8, `expected at least 8 magazine type shorthands, got ${typeShorthands}`)

  const cardRule = cssRule('.magazine-full .thread-card')
  const topicRule = cssRule('.magazine-full .thread-card-head .topic-dot')
  const selectedRule = cssRule('.magazine-full .thread-card.selected')
  assert.match(cardRule, /border-bottom-color:\s*var\(--thread-color,/u)
  assert.match(topicRule, /background:\s*var\(--thread-color,/u)
  assert.match(selectedRule, /box-shadow:/u)
  assert.match(selectedRule, /--thread-color/u)

  assert.match(cssSource, /--amphoreus-type-q:\s*800 22px\/1 var\(--amphoreus-font-display\);/u)
  const topicBadgeRule = cssRule('.magazine-full .thread-card-head .topic-dot::after')
  assert.match(topicBadgeRule, /content:\s*'Q'/u)
  assert.match(topicBadgeRule, /font:\s*var\(--amphoreus-type-q\)/u)

  assert.match(cssRule('.magazine-full .message-user::before'), /content:\s*'Q'/u)
  assert.match(cssRule('.magazine-full .message-assistant::before'), /content:\s*'A'/u)
  const sequenceSelector = cssSource.includes('.magazine-full .message[data-message-seq]:not([data-message-seq=""])::after {')
    ? '.magazine-full .message[data-message-seq]:not([data-message-seq=""])::after'
    : ".magazine-full .message[data-message-seq]:not([data-message-seq=''])::after"
  assert.match(cssRule(sequenceSelector), /content:\s*'§ '\s*attr\(data-message-seq\)/u)
  assert.match(cssRule('.magazine-full .seat-card-slot::before'), /content:\s*'CHRYSOS'/u)
  assert.match(cssRule('.magazine-full .portal-card::before'), /content:\s*'CHRYSOS'/u)
  assert.match(cssRule('.magazine-full .seat-card-slot::after'), /content:\s*'No\.'\s*attr\(data-volume\)/u)
  assert.match(cssRule('.magazine-full .portal-no::after'), /content:\s*'No\.'\s*attr\(data-volume\)/u)
  assert.match(cssSource, /\.portal-kicker-full\s*\{\s*display:\s*none/u)
  assert.match(cssSource, /\.magazine-full \.portal-kicker-full\s*\{\s*display:\s*block/u)
  assert.match(functionSource('renderPortal'), /class="portal-kicker portal-kicker-full">CHRYSOS · XIII VOLUMES</u)
})

test('folio decoration explicitly excludes draft cards', () => {
  const excludingSelector = cssSource.includes('.magazine-full .thread-card:not(.draft-card)::after {')
    ? '.magazine-full .thread-card:not(.draft-card)::after'
    : '.magazine-full .thread-card[data-folio][data-folios]::after'
  const folioRule = cssRule(excludingSelector)
  assert.match(folioRule, /content:\s*attr\(data-folio\)\s*' \/ '\s*attr\(data-folios\)/u)
  assert.doesNotMatch(cssSource, /\.magazine-full \.thread-card::after\s*\{/u)
  assert.doesNotMatch(functionSource('draftCard'), /data-folios?=/u)
})
