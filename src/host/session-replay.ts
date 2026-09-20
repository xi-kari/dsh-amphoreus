import type { SessionSeedEventState } from '@deepseek-ai/dsh-session'
import type { ProjectableEvent } from './workbench.ts'

export interface ColdHeader { id: string; cwd?: string; parentSession?: string }
interface ColdInspection {
  meta: ColdHeader
  inheritedEventCount: number
  events: readonly ProjectableEvent[]
}

interface ReadOptions { signal: AbortSignal }
interface ColdReadResult {
  readonly eventState: SessionSeedEventState
  readonly events: readonly ProjectableEvent[]
}
interface ColdReadHandle {
  readonly header: ColdHeader
  readonly inheritedEventCount: number
  read(offset?: number, length?: number, options?: ReadOptions): Promise<readonly ProjectableEvent[] | ColdReadResult>
  close(): Promise<void>
}

export type ColdPersistence = {
  list(signal?: AbortSignal): Promise<readonly ColdHeader[]>
  inspect(id: string, signal?: AbortSignal): Promise<ColdInspection>
} | {
  list(options?: ReadOptions): Promise<readonly { header: ColdHeader }[]>
  open(id: string, access: 'read', options?: ReadOptions): Promise<ColdReadHandle>
}

/** Read headers through the host's legacy or handle-based persistence API. */
export async function listColdHeaders(persistence: ColdPersistence, signal: AbortSignal): Promise<readonly ColdHeader[]> {
  if ('open' in persistence) return (await persistence.list({ signal })).map(snapshot => snapshot.header)
  return persistence.list(signal)
}

/** Read a complete log without claiming write ownership; always close the read handle. */
export async function inspectColdSession(persistence: ColdPersistence, id: string, signal: AbortSignal): Promise<ColdInspection> {
  if (!('open' in persistence)) return persistence.inspect(id, signal)
  const handle = await persistence.open(id, 'read', { signal })
  try {
    const result = await handle.read(undefined, undefined, { signal })
    return {
      meta: handle.header,
      inheritedEventCount: handle.inheritedEventCount,
      events: 'events' in result ? result.events : result,
    }
  } finally {
    await handle.close()
  }
}
