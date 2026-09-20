import type { ISessions, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'

export function currentSessionId(list: Pick<SessionListState, 'byId'>): SessionId | undefined {
  return Object.values(list.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
}

export type SelectedSessionList = SessionListState & { readonly current: SessionId | undefined }

export function selectedSessionList(source: ObservableSnapshot<SessionListState>): ObservableSnapshot<SelectedSessionList> {
  let previous: SessionListState | undefined
  let snapshot: SelectedSessionList
  return {
    getSnapshot: () => {
      const list = source.getSnapshot()
      if (list !== previous) {
        previous = list
        snapshot = { ...list, current: currentSessionId(list) }
      }
      return snapshot
    },
    subscribe: listener => source.subscribe(listener),
  }
}

export function createSessionAdapter(sessions: ISessions, navigation: Pick<UiWorkspace, 'openSession'>) {
  return {
    list: selectedSessionList(sessions.list),
    create: (options: { workspaceId?: string; cwd?: string; sessionId?: string }) => sessions.create({
      ...(options.workspaceId === undefined ? {} : { workspaceId: options.workspaceId as WorkspaceId }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId as SessionId }),
    }),
    fork: (options: { sessionId: string; atSeq?: number; increaseTitle?: boolean }) => sessions.fork({
      ...options, sessionId: options.sessionId as SessionId,
    }),
    open: (id: string) => navigation.openSession(id as SessionId),
    retain: (id: string, options: Parameters<ISessions['retain']>[1]) => sessions.retain(id as SessionId, options),
    binding: (id: string) => {
      const binding = sessions.binding(id as SessionId)
      if (binding === undefined) return undefined
      return { session: {
        prompt: (...args: Parameters<typeof binding.session.prompt>) => binding.session.prompt(...args),
        loadThrough: (seq: number) => binding.session.loadThrough(seq as SessionSeq),
        getSnapshot: () => binding.session.getSnapshot(),
        subscribe: (listener: () => void) => binding.session.subscribe(listener),
      } }
    },
  }
}
