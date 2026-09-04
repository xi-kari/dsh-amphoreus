export interface SeatActionDeps {
  readonly nonce: () => string | undefined
  readonly seatDirOf: (skillName: string) => string | undefined
  readonly sessions: {
    create(options: { cwd?: string; sessionId?: string }): Promise<string>
    open(id: string): void
  }
}

interface BindingBody {
  readonly skill: string
  readonly boundBy: 'seat-new' | 'seat-enter' | 'manual'
  readonly face?: string
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
  options: { open?: boolean } = { open: true },
): Promise<string> {
  const nonce = deps.nonce()
  if (nonce === undefined) throw new Error('nonce 未就绪')
  const sessionId = `session-${crypto.randomUUID()}`
  await putBinding(deps, sessionId, { skill: skillName, boundBy: 'seat-new' })
  try {
    const cwd = deps.seatDirOf(skillName)
    const created = await deps.sessions.create({ sessionId, ...(cwd === undefined ? {} : { cwd }) })
    if (created !== sessionId) throw new Error(`宿主返回了不同的会话 id（${created}）`)
    if (options.open !== false) deps.sessions.open(sessionId)
  } catch (error) {
    await deleteBinding(deps, sessionId).catch(() => undefined)
    throw error
  }
  return sessionId
}
