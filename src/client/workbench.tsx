/**
 * Workbench tab: hosts /amphoreus/workbench/ in an iframe and answers its
 * postMessage RPC (amphoreus:create-session / send-message / fork-session /
 * open-session / activate-session) with the injected session service, so the
 * canvas can create seat sessions, prompt them, and fork branches. All skill
 * binding stays host-side (the binding PUT below + the injector); the iframe
 * never sees session text beyond the host projection.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { useCallback, useEffect, useRef } from 'react'
import { rememberTab, WORKBENCH_VIEW_ID } from './tabmemory.ts'
import css from './workbench.module.css'
import type { WorkspacesPayload } from './workspaces-source.ts'

interface SessionsFace {
  create(opts: { cwd?: string; sessionId?: string }): Promise<string>
  fork(opts: { sessionId: string; atSeq?: number; increaseTitle?: boolean }): Promise<string>
  open(id: string): void
  binding(id: string): { session: { prompt(content: { type: 'text'; text: string }[], mode: 'queue' | 'steer'): Promise<{ ok: boolean; error?: { message?: string } }> } } | undefined
  readonly list: { getSnapshot(): { byId: Record<string, { title?: string; displayTitle: string } | undefined>; current: string | undefined } }
}

export interface WorkbenchViewInjected {
  readonly sessions: SessionsFace
  readonly workspaces: ObservableSnapshot<WorkspacesPayload>
  /** PUT a seat binding before the first prompt (host webapi, nonce-gated). */
  readonly bindSeat: (sessionId: string, skillName: string) => Promise<void>
  readonly seatSkillOf: (heroId: string) => string | undefined
}

export type WorkbenchViewProps = PropsRuntime<'conversation.view'> & PropsLocale<'amphoreus'> & WorkbenchViewInjected

interface BridgeMessage {
  source?: string
  type?: string
  requestId?: string
  sessionId?: string
  cwd?: string
  atSeq?: number
  text?: string
  seq?: number
  seatHeroId?: string
}

export function WorkbenchView({ sessionId, sessions, workspaces, bindSeat, seatSkillOf, openView, completeViewRequest, viewRequest }: WorkbenchViewProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const reply = useCallback((payload: Record<string, unknown>): void => {
    frameRef.current?.contentWindow?.postMessage({ source: 'dsh-amphoreus', ...payload }, window.location.origin)
  }, [])
  const pushWorkspaces = useCallback((): void => {
    reply({ type: 'amphoreus:workspaces', ...workspaces.getSnapshot() })
  }, [reply, workspaces])

  useEffect(() => {
    rememberTab(localStorage, WORKBENCH_VIEW_ID)
    return () => {
      // 仍是同一会话却卸载 ≈ 用户点了别的 Tab；会话切换导致的卸载不改记忆。
      if (sessions.list.getSnapshot().current === sessionId) rememberTab(localStorage, 'chat')
    }
  }, [sessionId, sessions])

  useEffect(() => workspaces.subscribe(pushWorkspaces), [workspaces, pushWorkspaces])

  useEffect(() => {
    const fail = (requestId: string | undefined, error: unknown): void => {
      reply({ type: 'amphoreus:bridge-error', requestId, message: error instanceof Error ? error.message : String(error) })
    }
    const summaryOf = (sessionId: string): { id: string; title: string | undefined } => {
      const summary = sessions.list.getSnapshot().byId[sessionId]
      return { id: sessionId, title: summary?.title ?? summary?.displayTitle }
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
              return
            case 'amphoreus:map-opened':
              return
            case 'amphoreus:request-current': {
              const current = sessions.list.getSnapshot().current
              reply({ type: 'amphoreus:current-session', session: current === undefined ? null : summaryOf(current) })
              return
            }
            case 'amphoreus:create-session': {
              const sessionId = await sessions.create(typeof data.cwd === 'string' && data.cwd !== '' ? { cwd: data.cwd } : {})
              // Seat binding must land before the first prompt so the host
              // injector seeds the skill card on session start.
              if (typeof data.seatHeroId === 'string') {
                const skill = seatSkillOf(data.seatHeroId)
                if (skill !== undefined) await bindSeat(sessionId, skill).catch(() => undefined)
              }
              reply({ type: 'amphoreus:created-session', requestId: data.requestId, session: summaryOf(sessionId) })
              return
            }
            case 'amphoreus:send-message': {
              if (typeof data.sessionId !== 'string' || typeof data.text !== 'string') throw new Error('缺少会话或文本')
              const binding = sessions.binding(data.sessionId)
              if (binding === undefined) throw new Error('会话不可用')
              const result = await binding.session.prompt([{ type: 'text', text: data.text }], 'queue')
              if (!result.ok) throw new Error(result.error?.message ?? '发送失败')
              reply({ type: 'amphoreus:message-sent', requestId: data.requestId, session: summaryOf(data.sessionId) })
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
              rememberTab(localStorage, 'chat')
              if (data.sessionId === sessionId) {
                openView('chat', 'amphoreus:open-session')
                completeViewRequest()
              } else {
                sessions.open(data.sessionId)
              }
              return
            }
            case 'amphoreus:activate-session':
              if (typeof data.sessionId === 'string') sessions.open(data.sessionId)
              return
            case 'amphoreus:close':
              rememberTab(localStorage, 'chat')
              openView('chat', 'amphoreus:close')
              completeViewRequest()
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
  }, [sessionId, sessions, bindSeat, seatSkillOf, openView, completeViewRequest, pushWorkspaces, reply])

  // Keep the iframe informed about the current session so its canvas
  // highlights the active card.
  useEffect(() => {
    let last: string | undefined
    const push = (): void => {
      const current = sessions.list.getSnapshot().current
      if (current === last) return
      last = current
      const summary = current === undefined ? null : { id: current, title: sessions.list.getSnapshot().byId[current]?.displayTitle }
      reply({ type: 'amphoreus:current-session', session: summary })
    }
    const dispose = (sessions.list as unknown as { subscribe(listener: () => void): () => void }).subscribe(push)
    return dispose
  }, [sessions, reply])

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
        onLoad={() => reply({ type: 'amphoreus:map-opened' })}
      />
    </div>
  )
}
