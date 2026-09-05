import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionFollowFrame, SessionHistoryRecord } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { AmphoreusState } from '../shared/api.ts'
import { feedFromChat, HARD_TEXT_CAP, liveTextOf } from './conversation-feed.ts'

export type ConferenceSeatPhase = 'queued' | 'dispatching' | 'running' | 'done' | 'failed'

export interface ConferenceTarget {
  readonly skillName: string
  readonly displayName: string
}

export interface ConferenceProgress extends ConferenceTarget {
  readonly conferenceId: string
  readonly phase: ConferenceSeatPhase
  readonly sessionId?: string
  readonly text?: string
  readonly error?: string
}

interface Snapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

interface ConferenceSessionFace extends Snapshot<{
  readonly running: boolean
  readonly hasMore: boolean
  readonly lastAgentError?: string | null
}> {}

interface ConferenceSessionList extends Snapshot<{
  readonly byId: Record<string, {
    readonly running?: boolean
    readonly completed?: boolean
    readonly projectionValues?: {
      readonly turnOutline?: readonly { readonly response?: string }[]
    }
  } | undefined>
}> {}

export interface ConferenceDeps {
  readonly dispatch: (target: ConferenceTarget, text: string) => Promise<string>
  readonly followSession?: (sessionId: string, signal: AbortSignal) => AsyncIterable<SessionFollowFrame>
  readonly conversationFeed: (sessionId: string) => Snapshot<ChatSnapshot | undefined> | undefined
  readonly sessionFace: (sessionId: string) => ConferenceSessionFace | undefined
  readonly sessionList?: ConferenceSessionList
  readonly emit: (progress: ConferenceProgress) => void
  readonly concurrency?: number
  readonly channelWaitMs?: number
  readonly replyTimeoutMs?: number
  readonly textLimit?: number
  readonly createId?: () => string
}

export interface ConferenceRun {
  readonly conferenceId: string
  readonly targets: readonly ConferenceTarget[]
  readonly completed: Promise<void>
  cancel(): void
}

const DEFAULT_CONCURRENCY = 3
const DEFAULT_CHANNEL_WAIT_MS = 5_000
const DEFAULT_REPLY_TIMEOUT_MS = 10 * 60_000
const CHANNEL_POLL_MS = 100

export function conferenceTargets(state: Pick<AmphoreusState, 'seats'>): ConferenceTarget[] {
  const seen = new Set<string>()
  return [...state.seats]
    .filter(seat => seat.status === 'deployed' && seat.hidden !== true)
    .sort((left, right) => (left.userOrder ?? left.order) - (right.userOrder ?? right.order))
    .flatMap(seat => {
      if (seen.has(seat.skillName)) return []
      seen.add(seat.skillName)
      return [{
        skillName: seat.skillName,
        displayName: seat.userDisplayName ?? seat.displayName,
      }]
    })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : fallback
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const abort = (): void => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

async function waitForChannels(
  deps: ConferenceDeps,
  sessionId: string,
  signal: AbortSignal,
): Promise<{
  feed: NonNullable<ReturnType<ConferenceDeps['conversationFeed']>>
  face: NonNullable<ReturnType<ConferenceDeps['sessionFace']>>
}> {
  const deadline = Date.now() + positiveInteger(deps.channelWaitMs, DEFAULT_CHANNEL_WAIT_MS)
  while (!signal.aborted) {
    const feed = deps.conversationFeed(sessionId)
    const face = deps.sessionFace(sessionId)
    if (feed !== undefined && face !== undefined) return { feed, face }
    if (Date.now() >= deadline) break
    await delay(CHANNEL_POLL_MS, signal)
  }
  throw new Error('会话回复通道未就绪')
}

function terminalReply(chat: ChatSnapshot | undefined): { phase: 'done' | 'failed'; text: string } | undefined {
  if (chat === undefined) return undefined
  const messages = feedFromChat('', chat, 0, false).messages
  const terminal = [...messages].reverse().find(message => (
    message.kind === 'error' || message.kind === 'assistant' && message.text.trim() !== ''
  ))
  if (terminal === undefined) return undefined
  return terminal.kind === 'error'
    ? { phase: 'failed', text: terminal.text }
    : { phase: 'done', text: terminal.text }
}

async function watchJournal(
  deps: ConferenceDeps,
  conferenceId: string,
  target: ConferenceTarget,
  sessionId: string,
  signal: AbortSignal,
): Promise<void> {
  const controller = new AbortController()
  const abort = (): void => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  const timeout = setTimeout(
    () => controller.abort(new Error('等待角色回复超时')),
    positiveInteger(deps.replyTimeoutMs, DEFAULT_REPLY_TIMEOUT_MS),
  )
  const textLimit = Math.min(HARD_TEXT_CAP, positiveInteger(deps.textLimit, 8_000))
  let response = ''
  let terminal: { phase: 'done' | 'failed'; text: string } | undefined
  const accept = (record: SessionHistoryRecord): void => {
    if (record.type !== 'event') return
    const event = record.event as SessionEvent
    switch (event.type) {
      case 'turn/start':
        response = ''
        terminal = undefined
        break
      case 'assistant/message': {
        const text = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
        if (text !== '') response = text.slice(0, textLimit)
        break
      }
      case 'turn/end': {
        const reason = event.data.reason
        if (reason.kind === 'completed') {
          terminal = response === ''
            ? { phase: 'failed', text: '角色已结束本轮，但没有文字回复' }
            : { phase: 'done', text: response }
        } else {
          const messages: Record<string, string> = {
            aborted: '角色回复已中止',
            blocked: '角色回复被阻断',
            'max-tokens': '角色回复达到输出上限，内容未完成',
            interrupted: '角色回复意外中断',
          }
          terminal = {
            phase: 'failed',
            text: reason.kind === 'error' ? reason.error.message : messages[reason.kind] ?? `角色回复未完成：${reason.kind}`,
          }
        }
        break
      }
    }
  }
  try {
    for await (const frame of deps.followSession!(sessionId, controller.signal)) {
      controller.signal.throwIfAborted()
      if (frame.type === 'snapshot') {
        response = ''
        terminal = undefined
        for (const record of frame.records) accept(record)
      } else {
        accept(frame)
      }
      if (terminal !== undefined) {
        deps.emit({
          conferenceId,
          ...target,
          sessionId,
          phase: terminal.phase,
          ...(terminal.phase === 'failed' ? { error: terminal.text.slice(0, textLimit) } : { text: terminal.text }),
        })
        return
      }
    }
    controller.signal.throwIfAborted()
    throw new Error('角色回复通道在本轮结束前关闭')
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason
    throw error
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
    controller.abort()
  }
}

async function watchReply(
  deps: ConferenceDeps,
  conferenceId: string,
  target: ConferenceTarget,
  sessionId: string,
  signal: AbortSignal,
): Promise<void> {
  if (deps.followSession !== undefined) {
    await watchJournal(deps, conferenceId, target, sessionId, signal)
    return
  }
  const { feed, face } = await waitForChannels(deps, sessionId, signal)
  const textLimit = Math.min(HARD_TEXT_CAP, positiveInteger(deps.textLimit, 8_000))

  await new Promise<void>((resolve, reject) => {
    let settled = false
    let scheduled = false
    let lastSignature = ''
    let stopFeed = (): void => {}
    let stopFace = (): void => {}
    let stopList = (): void => {}

    const cleanup = (): void => {
      stopFeed()
      stopFace()
      stopList()
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
    const finish = (error?: unknown): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error === undefined) resolve()
      else reject(error)
    }
    const publish = (): void => {
      scheduled = false
      if (settled) return
      if (signal.aborted) {
        finish(signal.reason)
        return
      }
      const chat = feed.getSnapshot()
      const faceSnapshot = face.getSnapshot()
      const running = deps.sessionList?.getSnapshot().byId[sessionId]?.running ?? faceSnapshot.running
      const feedTerminal = terminalReply(chat)
      const terminal = feedTerminal?.phase === 'failed'
        ? feedTerminal
        : faceSnapshot.lastAgentError
          ? { phase: 'failed' as const, text: faceSnapshot.lastAgentError }
          : running ? undefined : feedTerminal
      const live = liveTextOf(chat).slice(0, textLimit)
      const phase = terminal?.phase ?? 'running'
      const text = (terminal?.text ?? live).slice(0, textLimit)
      const signature = `${phase}\u0000${text}`
      if (signature !== lastSignature) {
        lastSignature = signature
        deps.emit({
          conferenceId,
          ...target,
          sessionId,
          phase,
          ...(phase === 'failed' ? { error: text || '会话未完成' } : text === '' ? {} : { text }),
        })
      }
      if (terminal !== undefined) finish()
    }
    const schedule = (): void => {
      if (scheduled || settled) return
      scheduled = true
      queueMicrotask(publish)
    }
    const abort = (): void => finish(signal.reason)
    const timeout = setTimeout(() => finish(new Error('等待角色回复超时')), positiveInteger(deps.replyTimeoutMs, DEFAULT_REPLY_TIMEOUT_MS))

    signal.addEventListener('abort', abort, { once: true })
    stopFeed = feed.subscribe(schedule)
    stopFace = face.subscribe(schedule)
    stopList = deps.sessionList?.subscribe(schedule) ?? (() => {})
    publish()
  })
}

export function startConference(
  deps: ConferenceDeps,
  input: { readonly text: string; readonly targets: readonly ConferenceTarget[] },
): ConferenceRun {
  const text = input.text.trim()
  if (text === '') throw new Error('会议问题为空')
  if (input.targets.length === 0) throw new Error('没有已部署的会议席位')

  const targets = input.targets.map(target => ({ ...target }))
  const conferenceId = deps.createId?.() ?? `conference-${crypto.randomUUID()}`
  const controller = new AbortController()
  const concurrency = Math.min(targets.length, positiveInteger(deps.concurrency, DEFAULT_CONCURRENCY))
  const phases = new Map<string, ConferenceSeatPhase>()
  const emit = (progress: ConferenceProgress): void => {
    phases.set(progress.skillName, progress.phase)
    deps.emit(progress)
  }

  let completedSettled = false
  let settleCompleted!: () => void
  const completed = new Promise<void>(resolve => {
    settleCompleted = () => {
      if (completedSettled) return
      completedSettled = true
      resolve()
    }
    queueMicrotask(() => {
      if (controller.signal.aborted) {
        settleCompleted()
        return
      }
      for (const target of targets) emit({ conferenceId, ...target, phase: 'queued' })
      let cursor = 0
      const worker = async (): Promise<void> => {
        while (!controller.signal.aborted) {
          const target = targets[cursor++]
          if (target === undefined) return
          emit({ conferenceId, ...target, phase: 'dispatching' })
          let sessionId: string | undefined
          try {
            sessionId = await deps.dispatch(target, text)
            if (controller.signal.aborted) return
            emit({ conferenceId, ...target, sessionId, phase: 'running' })
            await watchReply({ ...deps, emit }, conferenceId, target, sessionId, controller.signal)
          } catch (error) {
            if (controller.signal.aborted) return
            emit({
              conferenceId,
              ...target,
              ...(sessionId === undefined ? {} : { sessionId }),
              phase: 'failed',
              error: errorMessage(error),
            })
          }
        }
      }
      void Promise.all(Array.from({ length: concurrency }, worker)).then(settleCompleted)
    })
  })

  return {
    conferenceId,
    targets,
    completed,
    cancel: () => {
      if (controller.signal.aborted) return
      const reason = new Error('会议已取消')
      controller.abort(reason)
      for (const target of targets) {
        const phase = phases.get(target.skillName)
        if (phase === 'done' || phase === 'failed') continue
        emit({ conferenceId, ...target, phase: 'failed', error: reason.message })
      }
      settleCompleted()
    },
  }
}
