import type { ObservationRecord } from '../host/store.ts'
import { putBinding, startSeatSession, type SeatActionDeps } from './seat-actions.ts'

export interface HandoffDeps extends SeatActionDeps {
  readonly sessions: SeatActionDeps['sessions'] & {
    fork(options: { sessionId: string; atSeq?: number; increaseTitle?: boolean }): Promise<string>
    binding(id: string): {
      session: {
        prompt(
          content: { type: 'text'; text: string }[],
          mode: 'queue' | 'steer',
        ): Promise<{ ok: boolean; error?: { message?: string } }>
      }
    } | undefined
  }
}

async function postJson(
  deps: HandoffDeps,
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
): Promise<void> {
  const nonce = deps.nonce()
  if (nonce === undefined) throw new Error('nonce 未就绪')
  const response = await fetch(path, {
    method,
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-amphoreus-nonce': nonce },
    body: JSON.stringify(body),
  })
  if (response.ok) return
  const payload: unknown = await response.json().catch(() => ({}))
  const detail = typeof payload === 'object' && payload !== null && 'error' in payload
    ? String((payload as { error?: unknown }).error ?? '')
    : ''
  throw new Error(`${path} HTTP ${response.status}: ${detail}`)
}

export const observationKey = (
  observation: Pick<ObservationRecord, 'sessionId' | 'seq' | 'kind'>,
): string => `${observation.sessionId}:${observation.seq}:${observation.kind}`

const handoffActions = new Set<string>()

function handoffActionKey(observation: Pick<ObservationRecord, 'sessionId' | 'seq'>): string {
  if (typeof observation.sessionId !== 'string' || observation.sessionId === '') {
    throw new Error('缺少移交会话')
  }
  if (!Number.isSafeInteger(observation.seq) || observation.seq < 0) {
    throw new Error('移交序号无效')
  }
  return `${observation.sessionId}:${observation.seq}`
}

async function withHandoffAction<T>(
  observation: Pick<ObservationRecord, 'sessionId' | 'seq'>,
  action: () => Promise<T>,
): Promise<T> {
  const key = handoffActionKey(observation)
  if (handoffActions.has(key)) throw new Error('移交正在处理')
  handoffActions.add(key)
  try {
    return await action()
  } finally {
    handoffActions.delete(key)
  }
}

export const putObservation = (
  deps: HandoffDeps,
  key: string,
  body: { status: 'open' | 'accepted' | 'dismissed'; acceptedSessionId?: string },
): Promise<void> => postJson(
  deps,
  'PUT',
  `/amphoreus/api/observations/${encodeURIComponent(key)}`,
  body,
)

async function awaitBinding(
  deps: HandoffDeps,
  sessionId: string,
): Promise<NonNullable<ReturnType<HandoffDeps['sessions']['binding']>>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const binding = deps.sessions.binding(sessionId)
    if (binding !== undefined) return binding
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('会话未就绪')
}

export interface DispatchInput {
  readonly skillName: string
  readonly text: string
  readonly cwd?: string
  readonly face?: string
  readonly from: 'panel' | 'rail' | 'pipeline'
  readonly pipeline?: string
  readonly station?: number
  readonly open?: boolean
}

export async function dispatchTask(deps: HandoffDeps, input: DispatchInput): Promise<string> {
  const text = input.text.trim()
  if (text === '') throw new Error('任务文本为空')
  const sessionId = await startSeatSession(deps, input.skillName, {
    open: false,
    boundBy: 'dispatch',
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.face ? { face: input.face } : {}),
  })
  await postJson(deps, 'POST', '/amphoreus/api/observations', {
    sessionId,
    seq: 0,
    kind: 'dispatch',
    targetSkillName: input.skillName,
    payload: text,
    dispatchedFrom: input.from,
    ...(input.pipeline ? { pipeline: input.pipeline } : {}),
    ...(input.station === undefined ? {} : { station: input.station }),
  })
  const binding = await awaitBinding(deps, sessionId)
  const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
  if (!result.ok) throw new Error(result.error?.message ?? '发送失败')
  if (input.open === true) deps.sessions.open(sessionId)
  return sessionId
}

export interface AcceptHandoffOptions {
  readonly open?: boolean
}

export async function acceptHandoff(
  deps: HandoffDeps,
  observation: ObservationRecord,
  options: AcceptHandoffOptions = {},
): Promise<string> {
  if (observation.kind !== 'handoff' || observation.status !== 'open') {
    throw new Error('该移交不可接受')
  }
  if (!observation.targetSkillName) throw new Error('移交目标无法解析（未部署）')
  return withHandoffAction(observation, async () => {
    const child = await deps.sessions.fork({
      sessionId: observation.sessionId,
      atSeq: observation.seq,
      increaseTitle: true,
    })
    await putBinding(deps, child, {
      skill: observation.targetSkillName!,
      boundBy: 'handoff-fork',
      fromSessionId: observation.sessionId,
      fromSeq: observation.seq,
      ...(observation.targetFace ? { face: observation.targetFace } : {}),
    })
    await putObservation(deps, observationKey(observation), {
      status: 'accepted',
      acceptedSessionId: child,
    })
    if (options.open !== false) deps.sessions.open(child)
    return child
  })
}

export async function dismissHandoff(
  deps: HandoffDeps,
  observation: ObservationRecord,
): Promise<void> {
  if (observation.kind !== 'handoff' || observation.status !== 'open') {
    throw new Error('该移交不可忽略')
  }
  await withHandoffAction(observation, () => (
    putObservation(deps, observationKey(observation), { status: 'dismissed' })
  ))
}
