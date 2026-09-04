import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'

export interface ScrollSessionFace {
  loadThrough(seq: number): Promise<void>
  getSnapshot(): { openState: 'cold' | 'loading' | 'open' | 'error'; hasMore: boolean; loadingOlder: boolean }
}

export type SessionFaceResolver = (sessionId: string) => ScrollSessionFace | undefined
export type ConversationFeedResolver = (sessionId: string) => ObservableSnapshot<ChatSnapshot | undefined> | undefined

export const SCROLL_TO_TURN_TIMEOUT_MS = 8000
const TARGET_STABLE_MS = 120
const LOAD_RETRY_MS = 120
let scrollRequestSequence = 0

export function beginScrollRequest(): () => boolean {
  const request = ++scrollRequestSequence
  return () => scrollRequestSequence === request
}

export function safeOptionalInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

function visibleTarget(turn: number | undefined, anchorKey: string | undefined): HTMLElement | null {
  if (turn !== undefined) {
    const target = Array.from(document.querySelectorAll<HTMLElement>('[data-chat-turn]:not([hidden])'))
      .find(element => element.dataset.chatTurn === String(turn))
    if (target !== undefined) return target
  }
  if (anchorKey === undefined) return null
  return Array.from(document.querySelectorAll<HTMLElement>('[data-chat-anchor-key]:not([hidden])'))
    .find(element => element.dataset.chatAnchorKey === anchorKey) ?? null
}

export async function scrollToTurn(
  sessionId: string,
  seq: number | undefined,
  turn: number | undefined,
  sessionFace: SessionFaceResolver,
  conversationFeed: ConversationFeedResolver,
  currentSession: () => string | undefined,
  isLatestRequest: () => boolean,
): Promise<void> {
  const until = performance.now() + SCROLL_TO_TURN_TIMEOUT_MS
  let sawTargetCurrent = false
  let nextLoadAt = 0
  let stableTarget: HTMLElement | null = null
  let stableSince = 0
  while (performance.now() < until) {
    if (!isLatestRequest()) return
    const current = currentSession()
    if (current === sessionId) sawTargetCurrent = true
    else {
      if (sawTargetCurrent) return
      await nextFrame()
      continue
    }
    const face = sessionFace(sessionId)
    const feed = conversationFeed(sessionId)
    const faceSnapshot = face?.getSnapshot()
    if (face !== undefined && faceSnapshot?.openState === 'open') {
      const chat = feed?.getSnapshot()
      const anchorKey = seq === undefined || chat === undefined
        ? undefined
        : Array.from(chat.nodes.values()).find(node => node.anchorSeq === seq)?.key
      const target = visibleTarget(turn, anchorKey)
      const now = performance.now()
      if (target === null) {
        stableTarget = null
        if (seq !== undefined && anchorKey === undefined && faceSnapshot.hasMore && !faceSnapshot.loadingOlder && now >= nextLoadAt) {
          nextLoadAt = now + LOAD_RETRY_MS
          try { void face.loadThrough(seq).catch(() => {}) } catch { /* Retry on a later frame. */ }
        }
      } else {
        if (target !== stableTarget) {
          stableTarget = target
          stableSince = now
        } else if (now - stableSince >= TARGET_STABLE_MS) {
          target.scrollIntoView({ block: 'start', behavior: 'smooth' })
          await nextFrame()
          if (!isLatestRequest() || currentSession() !== sessionId) return
          const refreshedFeed = conversationFeed(sessionId)?.getSnapshot()
          const refreshedAnchor = seq === undefined || refreshedFeed === undefined
            ? undefined
            : Array.from(refreshedFeed.nodes.values()).find(node => node.anchorSeq === seq)?.key
          const verified = visibleTarget(turn, refreshedAnchor)
          if (verified === target) {
            target.scrollIntoView({ block: 'start', behavior: 'smooth' })
            return
          }
          stableTarget = null
        }
      }
    }
    await nextFrame()
  }
}
