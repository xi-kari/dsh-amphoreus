import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../workbench/styles.css', import.meta.url), 'utf8')

function functionSource(name: string): string {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `${name} must exist`)
  const next = source.indexOf('\nfunction ', start + marker.length)
  return source.slice(start, next === -1 ? undefined : next)
}

interface Card {
  readonly id: string
  readonly dshThreadId: string
  readonly turnIndex: number
  readonly parentId: null
  readonly position: { readonly x: number; readonly y: number }
  readonly answer: { readonly sourceSeq: number } | null
}

const card = (
  id: string,
  dshThreadId: string,
  turnIndex: number,
  answerSeq: number | null,
  x: number,
  y: number,
): Card => ({
  id,
  dshThreadId,
  turnIndex,
  parentId: null,
  position: { x, y },
  answer: answerSeq === null ? null : { sourceSeq: answerSeq },
})

function renderConnectors(options: {
  readonly cards: Card[]
  readonly threads: Array<{ readonly id: string; readonly dshSessionId: string }>
  readonly observations: Array<Record<string, unknown>>
}): string {
  const state = {
    activeId: null,
    workspace: { threads: options.threads },
    amph: { observations: options.observations },
  }
  const context = {
    state,
    draftPlacement: () => null,
    escapeHtml: (value: unknown) => String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;'),
    connectorPath: (
      from: { x: number; y: number },
      to: { x: number; y: number },
    ) => `curve:${from.x},${from.y}:${to.x},${to.y}`,
    globalThis: {} as Record<string, unknown>,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${functionSource('canvasConnectors')}\nglobalThis.__render = canvasConnectors`, context)
  const render = context.globalThis.__render as (cards: Card[]) => string
  return render(options.cards)
}

const SOURCE_SESSION = 'session-source'
const CHILD_SESSION = 'session-child'
const threads = [
  { id: 'source-thread', dshSessionId: SOURCE_SESSION },
  { id: 'child-thread', dshSessionId: CHILD_SESSION },
]
const accepted = (seq: number): Record<string, unknown> => ({
  kind: 'handoff',
  status: 'accepted',
  sessionId: SOURCE_SESSION,
  seq,
  acceptedSessionId: CHILD_SESSION,
})

test('accepted handoff resolves the exact assistant card and first child despite scrambled card order', () => {
  const html = renderConnectors({
    cards: [
      card('child-later', 'child-thread', 2, 90, 800, 200),
      card('source-later', 'source-thread', 1, 22, 400, 80),
      card('child-first', 'child-thread', 0, 80, 700, 100),
      card('source-exact', 'source-thread', 0, 11, 10, 20),
    ],
    threads,
    observations: [accepted(11)],
  })

  assert.equal((html.match(/class="handoff-connector"/gu) ?? []).length, 1)
  assert.match(html, /data-from="source-exact" data-to="child-first"/u)
  assert.match(html, /d="curve:10,20:700,100"/u)
})

test('missing assistant seq falls back to the last source card', () => {
  const html = renderConnectors({
    cards: [
      card('source-last', 'source-thread', 4, 22, 400, 80),
      card('child-first', 'child-thread', 0, null, 700, 100),
      card('source-first', 'source-thread', 0, 11, 10, 20),
    ],
    threads,
    observations: [accepted(999)],
  })

  assert.match(html, /data-from="source-last" data-to="child-first"/u)
})

test('nonaccepted, incomplete, cross-workspace, and self handoffs do not create paths or cards', () => {
  const cards = [
    card('source', 'source-thread', 0, 11, 10, 20),
    card('child', 'child-thread', 0, null, 700, 100),
  ]
  for (const observations of [
    [{ ...accepted(11), status: 'open' }],
    [{ ...accepted(11), status: 'dismissed' }],
    [{ ...accepted(11), acceptedSessionId: undefined }],
  ]) {
    assert.equal(renderConnectors({ cards, threads, observations }).includes('handoff-connector'), false)
  }
  assert.equal(renderConnectors({
    cards: [cards[1]!],
    threads: [threads[1]!],
    observations: [accepted(11)],
  }).includes('handoff-connector'), false)
  assert.equal(renderConnectors({
    cards: [cards[0]!],
    threads: [threads[0]!, { id: 'source-thread', dshSessionId: CHILD_SESSION }],
    observations: [accepted(11)],
  }).includes('handoff-connector'), false)
  assert.doesNotMatch(functionSource('canvasConnectors'), /<article|thread-card/u)
})

function renderHandoffBadge(options: {
  readonly cardTurn?: number
  readonly bindingSource?: string
  readonly includeSource?: boolean
  readonly sourceDisplayName?: string
  readonly includeHandoff?: boolean
} = {}): string {
  const child = { id: 'child-thread', dshSessionId: CHILD_SESSION }
  const workspaceThreads = [
    child,
    ...(options.includeSource === true ? [{ id: 'source-thread', dshSessionId: SOURCE_SESSION }] : []),
  ]
  const state = {
    workspace: { threads: workspaceThreads },
    amph: {
      bindings: [{
        sessionId: CHILD_SESSION,
        source: options.bindingSource ?? 'handoff-fork',
        handoffFrom: { sessionId: SOURCE_SESSION, seq: 11 },
      }],
      observations: [
        { kind: 'dispatch', status: 'accepted', acceptedSessionId: CHILD_SESSION, skillName: 'amphoreus-target' },
        ...(options.includeHandoff === false ? [] : [{
          kind: 'handoff',
          status: 'accepted',
          acceptedSessionId: CHILD_SESSION,
          skillName: 'amphoreus-source',
        }]),
      ],
      cards: options.sourceDisplayName === undefined
        ? []
        : [{ name: 'amphoreus-source', displayName: options.sourceDisplayName }],
    },
  }
  const context = {
    state,
    escapeHtml: (value: unknown) => String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;'),
    globalThis: {} as Record<string, unknown>,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(`${functionSource('handoffFromBadge')}\nglobalThis.__badge = handoffFromBadge`, context)
  const render = context.globalThis.__badge as (
    card: { turnIndex: number },
    thread: { id: string; dshSessionId: string },
  ) => string
  return render({ turnIndex: options.cardTurn ?? 0 }, child)
}

test('cross-workspace badge uses only accepted handoff source identity and escapes its display name', () => {
  const html = renderHandoffBadge({ sourceDisplayName: '<那刻夏>' })
  assert.equal(html, '<span class="card-handoff-from" title="移交自另一席">移交自 &lt;那刻夏&gt;</span>')
  assert.doesNotMatch(html, /amphoreus-target/u)
})

test('handoff badge is first-card-only and absent for same-workspace or unrelated bindings', () => {
  assert.equal(renderHandoffBadge({ cardTurn: 1, sourceDisplayName: '那刻夏' }), '')
  assert.equal(renderHandoffBadge({ includeSource: true, sourceDisplayName: '那刻夏' }), '')
  assert.equal(renderHandoffBadge({ bindingSource: 'manual', sourceDisplayName: '那刻夏' }), '')
})

test('missing source card or observation degrades to the explicit upstream label', () => {
  assert.match(renderHandoffBadge(), />移交自 上游<\/span>$/u)
  assert.match(renderHandoffBadge({ includeHandoff: false }), />移交自 上游<\/span>$/u)
})

test('existing drag cache and refresh cover every data endpoint without class filtering', () => {
  const cache = functionSource('cacheCardConnectors')
  const refresh = functionSource('refreshCardConnectors')
  const drag = functionSource('bindDragHandle')
  assert.match(cache, /querySelectorAll\('\.connectors path\[data-from\]'\)/u)
  assert.doesNotMatch(cache, /:not\(|draft-connector|handoff-connector/u)
  assert.match(cache, /for \(const id of \[fromId, toId\]\)/u)
  assert.match(refresh, /connectorPath\(fromCard\.position, toCard\.position\)/u)
  assert.match(drag, /\(moveEvent\.clientX - origin\.x\) \/ state\.zoom/u)
  assert.ok(drag.indexOf('dataCard.position =') < drag.indexOf('refreshCardConnectors(cardId)'))
})

test('handoff styles are high-specificity additions and preserve the one existing dark branch', () => {
  assert.match(styles, /\.connectors path \{ fill: none; stroke: var\(--dsw-alias-border-l4, #aebbc9\); stroke-width: 1\.5; \}/u)
  assert.match(styles, /\.connectors \.handoff-connector \{ stroke: var\(--dsw-alias-brand-primary, #8a681c\); stroke-dasharray: 7 5; stroke-width: 1\.6; \}/u)
  assert.match(styles, /\.thread-meta \.card-handoff-from \{ color: var\(--dsw-alias-brand-primary, #8a681c\);/u)
  assert.equal(styles.match(/\.connectors \.handoff-connector/gu)?.length, 1)
  assert.equal(styles.match(/\[data-theme="dark"\]/gu)?.length, 1)
})
