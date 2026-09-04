import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  beginScrollRequest,
  safeOptionalInteger,
  scrollToTurn,
  type ConversationFeedResolver,
  type SessionFaceResolver,
} from '../src/client/scroll-to-turn.ts'

const appSource = readFileSync(new URL('../workbench/app.js', import.meta.url), 'utf8')
const bridgeSource = readFileSync(new URL('../src/client/workbench.tsx', import.meta.url), 'utf8')

test('all workbench open surfaces carry turn and use the single open-session constructor', () => {
  assert.equal((appSource.match(/data-turn=/g) ?? []).length, 3)
  const sends = appSource.split('\n').filter(line => line.includes("'amphoreus:open-session'"))
  assert.equal(sends.length, 1)
  assert.equal(sends.every(line => line.includes('turn')), true)
  assert.match(appSource, /async function openDshSession\(sessionId, seqValue, turnValue\)/)
  assert.match(bridgeSource, /turn\?: number/)
  assert.match(bridgeSource, /rememberTab\(localStorage, 'chat'\)/)
  assert.match(bridgeSource, /const isLatestRequest = beginScrollRequest\(\)/)
  assert.match(bridgeSource, /scrollToTurn\([\s\S]*sessionFace,[\s\S]*conversationFeed,[\s\S]*sessions\.list\.getSnapshot\(\)\.current/)
  assert.doesNotMatch(bridgeSource, /switchTo[A-Z][A-Za-z]*/u)
})

test('a later request from a remounted bridge invalidates the older instance', () => {
  const firstBridgeRequest = beginScrollRequest()
  assert.equal(firstBridgeRequest(), true)
  const remountedBridgeRequest = beginScrollRequest()
  assert.equal(firstBridgeRequest(), false)
  assert.equal(remountedBridgeRequest(), true)
})

test('safe optional integers reject empty coercions and non-finite values', () => {
  assert.equal(safeOptionalInteger(undefined), undefined)
  assert.equal(safeOptionalInteger(''), undefined)
  assert.equal(safeOptionalInteger(Number.NaN), undefined)
  assert.equal(safeOptionalInteger(Number.POSITIVE_INFINITY), undefined)
  assert.equal(safeOptionalInteger(1.5), undefined)
  assert.equal(safeOptionalInteger(-1), undefined)
  assert.equal(safeOptionalInteger(0), 0)
  assert.equal(safeOptionalInteger(6), 6)
})

test('scroll waits for an open target face, loads seq, reacquires resolvers, and prefers turn', async () => {
  const selectors: string[] = []
  const scrolls: ScrollIntoViewOptions[] = []
  let faceCalls = 0
  let feedCalls = 0
  let open = false
  let loadedSeq: number | undefined
  const turnElement = {
    dataset: { chatTurn: '2' },
    scrollIntoView: (options: ScrollIntoViewOptions) => scrolls.push(options),
  } as HTMLElement
  const anchorElement = { dataset: { chatAnchorKey: 'anchor-10' }, scrollIntoView: () => {} } as unknown as HTMLElement
  const dom = installDom(selector => {
    assert.equal(open, true)
    selectors.push(selector)
    return selector.startsWith('[data-chat-turn]') && loadedSeq === 10 ? [turnElement] : selector.startsWith('[data-chat-anchor-key]') ? [anchorElement] : []
  })
  const sessionFace: SessionFaceResolver = () => {
    faceCalls += 1
    open = faceCalls >= 2
    return {
      getSnapshot: () => ({ openState: open ? 'open' : 'loading', hasMore: true, loadingOlder: false }),
      loadThrough: async seq => { loadedSeq = seq },
    }
  }
  const conversationFeed: ConversationFeedResolver = () => {
    feedCalls += 1
    return {
      getSnapshot: () => loadedSeq === 10 ? snapshot(10, 'anchor-10') : snapshot(),
      subscribe: () => () => {},
    }
  }
  try {
    await scrollToTurn('session-target', 10, 2, sessionFace, conversationFeed, () => 'session-target', () => true)
  } finally { dom.restore() }

  assert.equal(loadedSeq, 10)
  assert.ok(faceCalls >= 3)
  assert.ok(feedCalls >= 3)
  assert.equal(selectors.every(selector => selector === '[data-chat-turn]:not([hidden])'), true)
  assert.equal(scrolls.length, 2)
  assert.deepEqual(scrolls[0], { block: 'start', behavior: 'smooth' })
  assert.ok(dom.now() >= 120)
})

test('scroll falls back from a missing turn to a visible anchor', async () => {
  const selectors: string[] = []
  let scrolled = false
  const anchorElement = {
    dataset: { chatAnchorKey: 'anchor-7' },
    scrollIntoView: () => { scrolled = true },
  } as unknown as HTMLElement
  const dom = installDom(selector => {
    selectors.push(selector)
    return selector.startsWith('[data-chat-turn]') ? [] : [anchorElement]
  })
  const sessionFace: SessionFaceResolver = () => ({
    getSnapshot: () => ({ openState: 'open', hasMore: false, loadingOlder: false }),
    loadThrough: async () => {},
  })
  const conversationFeed: ConversationFeedResolver = () => ({
    getSnapshot: () => snapshot(7, 'anchor-7'),
    subscribe: () => () => {},
  })
  try {
    await scrollToTurn('session-target', 7, 99, sessionFace, conversationFeed, () => 'session-target', () => true)
  } finally { dom.restore() }

  assert.ok(selectors.includes('[data-chat-turn]:not([hidden])'))
  assert.ok(selectors.includes('[data-chat-anchor-key]:not([hidden])'))
  assert.equal(scrolled, true)
})

test('busy older pagination is retried without blocking the deadline', async () => {
  let frames = 0
  let loads = 0
  let covered = false
  let loadedWhileBusy = false
  const target = { dataset: { chatAnchorKey: 'anchor-4' }, scrollIntoView: () => {} } as unknown as HTMLElement
  const dom = installDom(selector => selector.startsWith('[data-chat-anchor-key]') && covered ? [target] : [], () => { frames += 1 })
  const sessionFace: SessionFaceResolver = () => {
    const loadingOlder = frames < 3
    return {
      getSnapshot: () => ({ openState: 'open', hasMore: true, loadingOlder }),
      loadThrough: async () => {
        if (loadingOlder) loadedWhileBusy = true
        loads += 1
        if (loads >= 2) covered = true
      },
    }
  }
  const conversationFeed: ConversationFeedResolver = () => ({
    getSnapshot: () => covered ? snapshot(4, 'anchor-4') : snapshot(),
    subscribe: () => () => {},
  })
  try {
    await scrollToTurn('session-target', 4, undefined, sessionFace, conversationFeed, () => 'session-target', () => true)
  } finally { dom.restore() }

  assert.equal(loadedWhileBusy, false)
  assert.equal(loads, 2)
  assert.ok(dom.now() < 8000)
})

test('a detached request stops before querying or scrolling a different current session', async () => {
  let current = 'session-a'
  let scrolls = 0
  const target = { dataset: { chatTurn: '2' }, scrollIntoView: () => { scrolls += 1 } } as unknown as HTMLElement
  const dom = installDom(selector => selector.startsWith('[data-chat-turn]') ? [target] : [], (_now, frame) => {
    if (frame === 2) current = 'session-b'
  })
  const sessionFace: SessionFaceResolver = () => ({
    getSnapshot: () => ({ openState: 'open', hasMore: false, loadingOlder: false }),
    loadThrough: async () => {},
  })
  const conversationFeed: ConversationFeedResolver = () => ({ getSnapshot: () => snapshot(), subscribe: () => () => {} })
  try {
    await scrollToTurn('session-a', undefined, 2, sessionFace, conversationFeed, () => current, () => true)
  } finally { dom.restore() }

  assert.equal(scrolls, 0)
  assert.ok(dom.now() < 8000)
})

test('a superseded request stops before its stable target can scroll', async () => {
  let latest = true
  let scrolls = 0
  const target = { dataset: { chatTurn: '3' }, scrollIntoView: () => { scrolls += 1 } } as unknown as HTMLElement
  const dom = installDom(selector => selector.startsWith('[data-chat-turn]') ? [target] : [], (_now, frame) => {
    if (frame === 2) latest = false
  })
  const sessionFace: SessionFaceResolver = () => ({
    getSnapshot: () => ({ openState: 'open', hasMore: false, loadingOlder: false }),
    loadThrough: async () => {},
  })
  const conversationFeed: ConversationFeedResolver = () => ({ getSnapshot: () => snapshot(), subscribe: () => () => {} })
  try {
    await scrollToTurn('session-a', undefined, 3, sessionFace, conversationFeed, () => 'session-a', () => latest)
  } finally { dom.restore() }

  assert.equal(scrolls, 0)
})

function snapshot(anchorSeq?: number, key?: string): ChatSnapshot {
  return {
    nodes: anchorSeq === undefined || key === undefined ? new Map() : new Map([[key, { anchorSeq, key }]]),
  } as unknown as ChatSnapshot
}

function installDom(
  query: (selector: string) => HTMLElement[],
  onFrame: (now: number, frame: number) => void = () => {},
): { restore(): void; now(): number } {
  const oldDocument = globalThis.document
  const oldAnimationFrame = globalThis.requestAnimationFrame
  const oldPerformance = globalThis.performance
  let now = 0
  let frame = 0
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { querySelectorAll: (selector: string) => query(selector) },
  })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      queueMicrotask(() => {
        now += 40
        frame += 1
        onFrame(now, frame)
        callback(now)
      })
      return frame + 1
    },
  })
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } })
  return {
    now: () => now,
    restore: () => {
      if (oldDocument === undefined) Reflect.deleteProperty(globalThis, 'document')
      else Object.defineProperty(globalThis, 'document', { configurable: true, value: oldDocument })
      if (oldAnimationFrame === undefined) Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
      else Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: oldAnimationFrame })
      Object.defineProperty(globalThis, 'performance', { configurable: true, value: oldPerformance })
    },
  }
}
