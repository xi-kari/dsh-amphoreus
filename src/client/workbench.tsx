/**
 * Workbench bridge shared by the conversation tab and the portal overlay.
 * It projects bounded session metadata and conversation feeds into one iframe,
 * and handles the iframe's session RPC without exposing the client context.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { AmphoreusState, MagazineModeMessage, ThemeTokensMessage } from '../shared/api.ts'
import { heroVisualOf } from '../shared/heroes.ts'
import { promptWithDeferredActivation } from './activation-bridge.ts'
import { feedFromChat, HARD_TEXT_CAP, liveTextOf } from './conversation-feed.ts'
import { beginScrollRequest, safeOptionalInteger, scrollToTurn } from './scroll-to-turn.ts'
import { bindingIndex, currentSeatOf } from './seat-model.ts'
import { rememberTab, WORKBENCH_VIEW_ID } from './tabmemory.ts'
import type { BridgedTokens } from './theme.ts'
import css from './workbench.module.css'
import type { WorkspacesPayload } from './workspaces-source.ts'

export interface SessionFeedFace {
  prompt(content: { type: 'text'; text: string }[], mode: 'queue' | 'steer'): Promise<{ ok: boolean; error?: { message?: string } }>
  loadThrough(seq: number): Promise<void>
  getSnapshot(): { running: boolean; openState: 'cold' | 'loading' | 'open' | 'error'; hasMore: boolean; loadingOlder: boolean }
  subscribe(listener: () => void): () => void
}

export interface SessionListSnapshot {
  readonly byId: Record<string, {
    readonly title?: string
    readonly displayTitle: string
    readonly cwd?: string
  } | undefined>
  readonly current: string | undefined
}

export interface SessionsFace {
  create(opts: { cwd?: string; sessionId?: string }): Promise<string>
  fork(opts: { sessionId: string; atSeq?: number; increaseTitle?: boolean }): Promise<string>
  open(id: string): void
  binding(id: string): { session: SessionFeedFace } | undefined
  readonly list: ObservableSnapshot<SessionListSnapshot>
}

interface ThemeBridge {
  readonly read: () => BridgedTokens
  readonly isDark: () => boolean
  readonly subscribe: (listener: () => void) => () => void
}

interface MagazineBridge {
  readonly mode: () => 'light' | 'full'
  readonly subscribe: (listener: () => void) => () => void
}

export interface WorkbenchViewInjected {
  readonly sessions: SessionsFace
  readonly workspaces: ObservableSnapshot<WorkspacesPayload>
  readonly conversationFeed: (sessionId: string) => ObservableSnapshot<ChatSnapshot | undefined> | undefined
  readonly sessionFace: (sessionId: string) => SessionFeedFace | undefined
  readonly model: ObservableSnapshot<{ state?: AmphoreusState }>
  readonly theme: ThemeBridge
  readonly setSeat: (heroId: string | null) => void
  readonly magazine: MagazineBridge
  readonly startSeatSession: (skillName: string) => Promise<string>
  readonly openPortal?: () => void
}

export type WorkbenchViewProps = PropsRuntime<'conversation.view'> & PropsLocale<'amphoreus'> & WorkbenchViewInjected

export interface AmphoreusCurrentSessionMessage {
  readonly source: 'dsh-amphoreus'
  readonly type: 'amphoreus:current-session'
  readonly session: { readonly id: string; readonly title: string | undefined; readonly cwd: string | undefined } | null
  readonly seat: { readonly skillName: string; readonly heroId: string | null } | null
}

export interface CurrentSessionIdentity {
  readonly id: string | undefined
  readonly seatKey: string | null
}

export function currentSessionIdentity(
  list: SessionListSnapshot,
  state: AmphoreusState | undefined,
): CurrentSessionIdentity {
  const binding = currentSeatOf(bindingIndex(state?.bindings ?? []), list.current)
  if (binding === undefined) return { id: list.current, seatKey: null }
  const heroId = heroVisualOf(binding.skillName)?.heroId ?? null
  return { id: list.current, seatKey: `${binding.skillName}\u0000${heroId ?? ''}` }
}

export function buildCurrentSessionMessage(
  list: SessionListSnapshot,
  state: AmphoreusState | undefined,
): AmphoreusCurrentSessionMessage {
  const current = list.current
  if (current === undefined) {
    return { source: 'dsh-amphoreus', type: 'amphoreus:current-session', session: null, seat: null }
  }
  const summary = list.byId[current]
  const binding = currentSeatOf(bindingIndex(state?.bindings ?? []), current)
  return {
    source: 'dsh-amphoreus',
    type: 'amphoreus:current-session',
    session: {
      id: current,
      title: summary?.title ?? summary?.displayTitle ?? current,
      cwd: summary?.cwd,
    },
    seat: binding === undefined ? null : {
      skillName: binding.skillName,
      heroId: heroVisualOf(binding.skillName)?.heroId ?? null,
    },
  }
}

interface BridgeMessage {
  source?: string
  type?: string
  requestId?: string
  sessionId?: string
  cwd?: string
  atSeq?: number
  text?: string
  seq?: number
  turn?: number
  skillName?: string
  heroId?: string | null
  defer?: boolean
  activate?: boolean
}

export interface WorkbenchBridgeDeps {
  readonly sessions: SessionsFace
  readonly model: ObservableSnapshot<{ state?: AmphoreusState }>
  readonly workspaces: ObservableSnapshot<WorkspacesPayload>
  readonly startSeatSession: (skillName: string) => Promise<string>
  readonly setSeat: (heroId: string | null) => void
  readonly conversationFeed?: (sessionId: string) => ObservableSnapshot<ChatSnapshot | undefined> | undefined
  readonly sessionFace?: (sessionId: string) => SessionFeedFace | undefined
  readonly theme?: ThemeBridge
  readonly magazine?: MagazineBridge
  readonly openChat?: (focus: string) => void
}

export interface WorkbenchBridgeHandlers {
  readonly onOpenSeat?: (heroId: string | null) => void | Promise<void>
  readonly onOpenPortal?: () => void
  readonly onClose?: () => void
  readonly onOpened?: () => void
}

export interface WorkbenchBridgeController {
  readonly pushCurrent: () => void
  readonly onFrameLoad: () => void
}

export function useWorkbenchBridge(
  frameRef: RefObject<HTMLIFrameElement>,
  deps: WorkbenchBridgeDeps,
  handlers: WorkbenchBridgeHandlers,
): WorkbenchBridgeController {
  const {
    sessions,
    model,
    workspaces,
    startSeatSession,
    setSeat,
    conversationFeed,
    sessionFace,
    theme,
    magazine,
    openChat,
  } = deps
  const revisionRef = useRef(0)
  const pushMessagesRef = useRef<() => void>(() => {})
  const pushLiveRef = useRef<() => void>(() => {})
  const pushThemeTokensRef = useRef<() => void>(() => {})
  const pushMagazineRef = useRef<() => void>(() => {})
  const deferredActivationsRef = useRef(new Set<string>())
  const handlersRef = useRef(handlers)
  const openChatRef = useRef(openChat)
  handlersRef.current = handlers
  openChatRef.current = openChat

  const reply = useCallback((payload: object): void => {
    frameRef.current?.contentWindow?.postMessage({ source: 'dsh-amphoreus', ...payload }, window.location.origin)
  }, [frameRef])
  const summaryOf = useCallback((id: string): { id: string; title: string; cwd: string | undefined } => {
    const summary = sessions.list.getSnapshot().byId[id]
    return { id, title: summary?.title ?? summary?.displayTitle ?? id, cwd: summary?.cwd }
  }, [sessions])
  const pushWorkspaces = useCallback((): void => {
    reply({ type: 'amphoreus:workspaces', ...workspaces.getSnapshot() })
  }, [reply, workspaces])
  const pushCurrent = useCallback((): void => {
    reply(buildCurrentSessionMessage(sessions.list.getSnapshot(), model.getSnapshot().state))
  }, [model, reply, sessions])
  const pushConfig = useCallback((): void => {
    reply({
      type: 'amphoreus:config',
      cardTextLimit: model.getSnapshot().state?.effectiveConfig.workbench.cardTextLimit ?? 8000,
    })
  }, [model, reply])

  useEffect(() => workspaces.subscribe(pushWorkspaces), [workspaces, pushWorkspaces])
  useEffect(() => model.subscribe(pushConfig), [model, pushConfig])

  useEffect(() => {
    if (magazine === undefined) {
      pushMagazineRef.current = () => {}
      return
    }
    const push = (): void => {
      const message: MagazineModeMessage = {
        source: 'dsh-amphoreus',
        type: 'amphoreus:magazine-mode',
        mode: magazine.mode(),
      }
      frameRef.current?.contentWindow?.postMessage(message, window.location.origin)
    }
    pushMagazineRef.current = push
    push()
    const unsubscribe = magazine.subscribe(push)
    return () => {
      unsubscribe()
      if (pushMagazineRef.current === push) pushMagazineRef.current = () => {}
    }
  }, [frameRef, magazine])

  useEffect(() => {
    if (theme === undefined) {
      pushThemeTokensRef.current = () => {}
      return
    }
    let active = true
    const pendingFrames = new Set<number>()
    const afterFrame = (callback: () => void): void => {
      let frame = 0
      frame = requestAnimationFrame(() => {
        pendingFrames.delete(frame)
        if (active) callback()
      })
      pendingFrames.add(frame)
    }
    const push = (): void => {
      // ThemePresenter and this listener have no guaranteed ordering. Read the
      // body projection two frames later, after its inline tokens have landed.
      afterFrame(() => {
        afterFrame(() => {
          const message: ThemeTokensMessage = {
            source: 'dsh-amphoreus',
            type: 'amphoreus:theme-tokens',
            tokens: theme.read(),
            dark: theme.isDark(),
          }
          frameRef.current?.contentWindow?.postMessage(message, window.location.origin)
        })
      })
    }
    pushThemeTokensRef.current = push
    push()
    const unsubscribe = theme.subscribe(push)
    return () => {
      active = false
      unsubscribe()
      for (const frame of pendingFrames) cancelAnimationFrame(frame)
      pendingFrames.clear()
      if (pushThemeTokensRef.current === push) pushThemeTokensRef.current = () => {}
    }
  }, [frameRef, theme])

  useEffect(() => {
    if (conversationFeed === undefined || sessionFace === undefined) {
      pushMessagesRef.current = () => {}
      pushLiveRef.current = () => {}
      return
    }
    let followedId: string | undefined
    let lastNodes: ChatSnapshot['legacy']['nodes'] | undefined
    let lastHasMore: boolean | undefined
    let lastRunning: boolean | undefined
    let lastLive = ''
    let messageTimer: number | undefined
    let liveFrame: number | undefined
    let stopFeed = (): void => {}
    let stopFace = (): void => {}
    let resendMessages: (() => void) | undefined
    let resendLive: (() => void) | undefined

    const clearScheduled = (): void => {
      if (messageTimer !== undefined) window.clearTimeout(messageTimer)
      if (liveFrame !== undefined) cancelAnimationFrame(liveFrame)
      messageTimer = undefined
      liveFrame = undefined
    }
    const detach = (): void => {
      stopFeed()
      stopFace()
      stopFeed = () => {}
      stopFace = () => {}
      clearScheduled()
      if (resendMessages !== undefined && pushMessagesRef.current === resendMessages) pushMessagesRef.current = () => {}
      if (resendLive !== undefined && pushLiveRef.current === resendLive) pushLiveRef.current = () => {}
      resendMessages = undefined
      resendLive = undefined
    }
    const follow = (): void => {
      const id = sessions.list.getSnapshot().current
      if (id === followedId) return

      detach()
      followedId = undefined
      lastNodes = undefined
      lastHasMore = undefined
      lastRunning = undefined
      lastLive = ''
      if (id === undefined) return

      const feed = conversationFeed(id)
      const face = sessionFace(id)
      if (feed === undefined || face === undefined) return

      const postMessages = (force = false): void => {
        const chat = feed.getSnapshot()
        if (chat === undefined) return
        const nodes = chat.legacy.nodes
        const hasMore = face.getSnapshot().hasMore
        if (!force && nodes === lastNodes && hasMore === lastHasMore) return
        lastNodes = nodes
        lastHasMore = hasMore
        reply({ type: 'amphoreus:messages', ...feedFromChat(id, chat, ++revisionRef.current, hasMore) })
      }
      const postLive = (force = false): void => {
        const running = face.getSnapshot().running
        const text = liveTextOf(feed.getSnapshot())
        if (!force && running === lastRunning && text === lastLive) return
        lastRunning = running
        lastLive = text
        reply({
          type: 'amphoreus:live-reply',
          sessionId: id,
          running,
          text: text.slice(0, HARD_TEXT_CAP),
        })
      }
      const onFeedChange = (): void => {
        if (messageTimer === undefined) {
          messageTimer = window.setTimeout(() => {
            messageTimer = undefined
            postMessages()
          }, 120)
        }
        if (liveFrame === undefined) {
          liveFrame = requestAnimationFrame(() => {
            liveFrame = undefined
            postLive()
          })
        }
      }

      stopFeed = feed.subscribe(onFeedChange)
      stopFace = face.subscribe(onFeedChange)
      followedId = id
      resendMessages = () => postMessages(true)
      resendLive = () => postLive(true)
      pushMessagesRef.current = resendMessages
      pushLiveRef.current = resendLive
      postMessages()
      postLive()
    }

    const stopList = sessions.list.subscribe(follow)
    follow()
    return () => {
      stopList()
      detach()
    }
  }, [conversationFeed, reply, sessionFace, sessions])

  useEffect(() => {
    const fail = (requestId: string | undefined, error: unknown): void => {
      reply({ type: 'amphoreus:bridge-error', requestId, message: error instanceof Error ? error.message : String(error) })
    }
    const onMessage = (event: MessageEvent<BridgeMessage>): void => {
      if (event.origin !== window.location.origin) return
      if (event.source !== frameRef.current?.contentWindow) return
      const data = event.data
      if (data?.source !== 'dsh-amphoreus' || typeof data.type !== 'string') return
      void (async () => {
        try {
          switch (data.type) {
            case 'amphoreus:map-ready':
              pushWorkspaces()
              pushCurrent()
              pushConfig()
              pushMessagesRef.current()
              pushLiveRef.current()
              pushThemeTokensRef.current()
              pushMagazineRef.current()
              return
            case 'amphoreus:map-opened':
              return
            case 'amphoreus:seat-changed':
              setSeat(typeof data.heroId === 'string' && data.heroId !== '' ? data.heroId : null)
              return
            case 'amphoreus:open-seat': {
              const handler = handlersRef.current.onOpenSeat
              if (data.heroId === null) await handler?.(null)
              else if (typeof data.heroId === 'string' && data.heroId !== '') await handler?.(data.heroId)
              return
            }
            case 'amphoreus:open-portal':
              handlersRef.current.onOpenPortal?.()
              return
            case 'amphoreus:request-current':
              pushCurrent()
              return
            case 'amphoreus:request-config':
              pushConfig()
              return
            case 'amphoreus:create-session': {
              if (typeof data.skillName === 'string' && data.skillName !== '') {
                const id = await startSeatSession(data.skillName)
                reply({ type: 'amphoreus:created-session', requestId: data.requestId, session: summaryOf(id) })
                return
              }
              const id = await sessions.create(typeof data.cwd === 'string' && data.cwd !== '' ? { cwd: data.cwd } : {})
              reply({ type: 'amphoreus:created-session', requestId: data.requestId, session: summaryOf(id) })
              return
            }
            case 'amphoreus:send-message': {
              if (typeof data.sessionId !== 'string' || typeof data.text !== 'string') throw new Error('缺少会话或文本')
              const targetId = data.sessionId
              await promptWithDeferredActivation({
                sessionId: targetId,
                text: data.text,
                requestedActivation: data.activate === true,
                deferredActivations: deferredActivationsRef.current,
                currentSession: () => sessions.list.getSnapshot().current,
                binding: id => sessions.binding(id),
                reply: () => reply({ type: 'amphoreus:message-sent', requestId: data.requestId, session: summaryOf(targetId) }),
                open: id => sessions.open(id),
              })
              return
            }
            case 'amphoreus:fork-session': {
              if (typeof data.sessionId !== 'string') throw new Error('缺少来源会话')
              const childId = await sessions.fork({
                sessionId: data.sessionId,
                ...(typeof data.atSeq === 'number' ? { atSeq: data.atSeq } : {}),
                increaseTitle: true,
              })
              reply({ type: 'amphoreus:forked-session', requestId: data.requestId, session: summaryOf(childId) })
              return
            }
            case 'amphoreus:open-session': {
              if (typeof data.sessionId !== 'string') return
              const targetId = data.sessionId
              const isLatestRequest = beginScrollRequest()
              const seq = safeOptionalInteger(data.seq)
              const turn = safeOptionalInteger(data.turn)
              const focus = turn !== undefined ? `turn:${turn}` : seq !== undefined ? `seq:${seq}` : 'amphoreus:open-session'
              rememberTab(localStorage, 'chat')
              if (targetId === sessions.list.getSnapshot().current) openChatRef.current?.(focus)
              else sessions.open(targetId)
              if (seq !== undefined || turn !== undefined) {
                if (sessionFace !== undefined && conversationFeed !== undefined) {
                  void scrollToTurn(
                    targetId,
                    seq,
                    turn,
                    sessionFace,
                    conversationFeed,
                    () => sessions.list.getSnapshot().current,
                    isLatestRequest,
                  ).catch(() => {})
                }
              }
              handlersRef.current.onOpened?.()
              return
            }
            case 'amphoreus:activate-session':
              if (typeof data.sessionId !== 'string') return
              if (data.defer === true) {
                deferredActivationsRef.current.add(data.sessionId)
                return
              }
              deferredActivationsRef.current.delete(data.sessionId)
              sessions.open(data.sessionId)
              return
            case 'amphoreus:close':
              handlersRef.current.onClose?.()
              return
            default:
              return
          }
        } catch (error) {
          fail(data.requestId, error)
        }
      })()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [conversationFeed, frameRef, pushConfig, pushCurrent, pushWorkspaces, reply, sessionFace, sessions, setSeat, startSeatSession, summaryOf])

  useEffect(() => {
    let last: CurrentSessionIdentity | undefined
    const push = (): void => {
      const identity = currentSessionIdentity(sessions.list.getSnapshot(), model.getSnapshot().state)
      if (last !== undefined && identity.id === last.id && identity.seatKey === last.seatKey) return
      last = identity
      pushCurrent()
    }
    const disposeSessions = sessions.list.subscribe(push)
    const disposeModel = model.subscribe(push)
    push()
    return () => {
      disposeSessions()
      disposeModel()
    }
  }, [model, pushCurrent, sessions])

  const onFrameLoad = useCallback((): void => {
    reply({ type: 'amphoreus:map-opened' })
    pushThemeTokensRef.current()
  }, [reply])

  return { pushCurrent, onFrameLoad }
}

export function WorkbenchView({
  sessionId,
  sessions,
  workspaces,
  conversationFeed,
  sessionFace,
  model,
  theme,
  setSeat,
  magazine,
  startSeatSession,
  openPortal,
  openView,
  completeViewRequest,
  viewRequest,
}: WorkbenchViewProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    rememberTab(localStorage, WORKBENCH_VIEW_ID)
    return () => {
      // 仍是同一会话却卸载 ≈ 用户点了别的 Tab；会话切换导致的卸载不改记忆。
      if (sessions.list.getSnapshot().current === sessionId) rememberTab(localStorage, 'chat')
    }
  }, [sessionId, sessions])

  const openChat = useCallback((focus: string): void => {
    rememberTab(localStorage, 'chat')
    openView('chat', focus)
    completeViewRequest()
  }, [completeViewRequest, openView])
  const closeWorkbench = useCallback((): void => {
    rememberTab(localStorage, 'chat')
    openView('chat', 'amphoreus:close')
    completeViewRequest()
  }, [completeViewRequest, openView])
  const { onFrameLoad } = useWorkbenchBridge(frameRef, {
    sessions,
    model,
    workspaces,
    startSeatSession,
    setSeat,
    conversationFeed,
    sessionFace,
    theme,
    magazine,
    openChat,
  }, {
    ...(openPortal === undefined ? {} : { onOpenPortal: openPortal }),
    onClose: closeWorkbench,
  })

  useEffect(() => {
    if (viewRequest?.view === WORKBENCH_VIEW_ID) completeViewRequest()
  }, [viewRequest, completeViewRequest])

  return (
    <div className={css.root}>
      <iframe
        ref={frameRef}
        className={css.frame}
        src="/amphoreus/workbench/"
        title="翁法罗斯工作台"
        onLoad={onFrameLoad}
      />
    </div>
  )
}
