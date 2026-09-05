import { CONVERSATION_PREF_PREFIX, rememberTab, WORKBENCH_VIEW_ID, type KeyValueStore } from './tabmemory.ts'

export function createDirectChatRequests() {
  let pending: string | undefined
  const listeners = new Set<() => void>()
  const publish = (): void => { for (const listener of listeners) listener() }
  return {
    getSnapshot: (): string | undefined => pending,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    request: (sessionId: string): void => { pending = sessionId; publish() },
    clear: (sessionId: string): void => {
      if (pending !== sessionId) return
      pending = undefined
      publish()
    },
  }
}

export function openDirectSeatChat(
  deps: {
    readonly store: KeyValueStore
    readonly closePortal: () => void
    readonly activateChat: (sessionId: string) => void
    readonly requests: ReturnType<typeof createDirectChatRequests>
    readonly open: (sessionId: string) => void
  },
  sessionId: string,
): void {
  deps.closePortal()
  rememberTab(deps.store, 'chat')
  const key = `${CONVERSATION_PREF_PREFIX}.${sessionId}`
  let previous: Record<string, unknown> = { draft: '', view: null, viewRequest: null }
  try {
    const raw = deps.store.getItem(key)
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) previous = parsed as Record<string, unknown>
    deps.store.setItem(key, JSON.stringify({ ...previous, view: 'chat', viewRequest: null }))
  } catch { /* The live view request still works without browser storage. */ }
  if (previous.view === WORKBENCH_VIEW_ID) deps.requests.request(sessionId)
  else deps.requests.clear(sessionId)
  deps.activateChat(sessionId)
  deps.open(sessionId)
}

export interface SeatActionDeps {
  readonly nonce: () => string | undefined
  readonly seatDirOf: (skillName: string) => string | undefined
  readonly ensureSeatWorkspace?: (skillName: string) => Promise<string | undefined>
  readonly ensureSessionWorkspace?: (sessionId: string, workspaceId: string) => Promise<void>
  readonly sessions: {
    create(options: { workspaceId?: string; cwd?: string; sessionId?: string }): Promise<string>
    open(id: string): void
  }
  /**
   * Seat preset tiers (agent preset / model / permission) applied to the freshly
   * created, still-blank session. Runs after create + workspace sync and BEFORE
   * open so callers that prompt immediately (dispatch) see the preset land first.
   * Mutable so the assembly can attach it after the pinned `seatDeps` literal.
   */
  applySeatPreset?: (sessionId: string, skillName: string) => Promise<void>
}

interface BindingBody {
  readonly skill: string
  readonly boundBy: 'seat-new' | 'seat-enter' | 'manual' | 'dispatch' | 'handoff-fork'
  readonly face?: string
  readonly fromSessionId?: string
  readonly fromSeq?: number
}

async function responseError(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => ({}))
  if (typeof body !== 'object' || body === null || !('error' in body)) return ''
  const error = (body as { error?: unknown }).error
  return error === undefined || error === null ? '' : String(error)
}

export async function putBinding(
  deps: SeatActionDeps,
  sessionId: string,
  body: BindingBody,
): Promise<void> {
  const nonce = deps.nonce()
  if (nonce === undefined) throw new Error('nonce 未就绪')
  const response = await fetch(`/amphoreus/api/bindings/${encodeURIComponent(sessionId)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': nonce },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`席位绑定失败（HTTP ${response.status}）：${await responseError(response)}`)
  }
}

export async function deleteBinding(deps: SeatActionDeps, sessionId: string): Promise<void> {
  const nonce = deps.nonce()
  if (nonce === undefined) throw new Error('nonce 未就绪')
  const response = await fetch(`/amphoreus/api/bindings/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'x-amphoreus-nonce': nonce },
  })
  if (response.ok || response.status === 404) return
  throw new Error(`席位解绑失败（HTTP ${response.status}）：${await responseError(response)}`)
}

export async function startSeatSession(
  deps: SeatActionDeps,
  skillName: string,
  options: {
    open?: boolean
    boundBy?: 'seat-new' | 'dispatch'
    cwd?: string
    face?: string
  } = { open: true },
): Promise<string> {
  const nonce = deps.nonce()
  if (nonce === undefined) throw new Error('nonce 未就绪')
  const sessionId = `session-${crypto.randomUUID()}`
  await putBinding(deps, sessionId, {
    skill: skillName,
    boundBy: options.boundBy ?? 'seat-new',
    ...(options.face === undefined ? {} : { face: options.face }),
  })
  let createdSession = false
  try {
    const workspaceId = options.cwd === undefined
      ? await deps.ensureSeatWorkspace?.(skillName)
      : undefined
    const cwd = workspaceId === undefined ? options.cwd ?? deps.seatDirOf(skillName) : undefined
    const created = await deps.sessions.create({
      sessionId,
      ...(workspaceId === undefined ? {} : { workspaceId }),
      ...(cwd === undefined ? {} : { cwd }),
    })
    if (created !== sessionId) throw new Error(`宿主返回了不同的会话 id（${created}）`)
    createdSession = true
    if (workspaceId !== undefined) await deps.ensureSessionWorkspace?.(sessionId, workspaceId)
    if (deps.applySeatPreset !== undefined) {
      // A preset that fails to land must not lose the session or its binding.
      try {
        await deps.applySeatPreset(sessionId, skillName)
      } catch (error) {
        console.warn(`amphoreus seat preset (${skillName}) not applied: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (options.open !== false) deps.sessions.open(sessionId)
  } catch (error) {
    if (!createdSession) await deleteBinding(deps, sessionId).catch(() => undefined)
    throw error
  }
  return sessionId
}
