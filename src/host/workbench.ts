/**
 * Projection index: in-memory, rebuilt at startup from live sessions and from
 * session persistence (cold sessions); stores seq structure only (no message
 * text). Ported from liangmianya/dsh-synapse (MIT, see NOTICE).
 */
import type { UnprojectableRecord } from '../shared/api.ts'

const MAX_TITLE_LENGTH = 120
const CHANGE_COALESCE_MS = 800

export class InputError extends Error {}
export class NotFoundError extends Error {}

export interface IndexCard {
  turnIndex: number
  turn: number | null
  userSeq: number
  assistantSeq: number | null
  toolCallIds: string[]
  errorSeq: number | null
  skillName?: string
  face?: string
}

export interface IndexFork {
  childSessionId: string
  atSeq: number
}

export interface SessionIndex {
  sessionId: string
  title: string | null
  parentSessionId: string | null
  inheritedCount: number
  cwd: string | null
  cards: IndexCard[]
  forks: IndexFork[]
  pendingToolCallIds: string[]
  lastSeq: number
  updatedAt: number
  hidden: boolean
}

export interface ProjectableSession {
  readonly id: string
  readonly header?: { cwd?: string; parentSession?: string }
  readonly inheritedEventCount?: number
  snapshotEvents?(): readonly ProjectableEvent[]
  ownEvents?(): readonly ProjectableEvent[]
  readonly events?: readonly ProjectableEvent[]
}

export interface ProjectableEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data?: unknown
}

export interface HiddenStore {
  get(): readonly string[]
  set(ids: readonly string[]): Promise<void>
}

type IndexEntry = Omit<SessionIndex, 'forks' | 'hidden'>

export class ProjectionIndex {
  readonly #entries = new Map<string, IndexEntry>()
  readonly #hidden: HiddenStore
  readonly #listeners = new Set<(sessionIds: readonly string[]) => void>()
  readonly #currentTurns = new Map<string, number>()
  readonly #unprojectable = new Map<string, UnprojectableRecord>()
  #hideSerial: Promise<void> = Promise.resolve()
  #dirty = new Set<string>()
  #timer: NodeJS.Timeout | null = null
  #revision = 0

  constructor(hidden: HiddenStore) {
    this.#hidden = hidden
  }

  get revision(): number {
    return this.#revision
  }

  list(includeHidden = false): SessionIndex[] {
    const hidden = new Set(this.#hidden.get())
    const sessions = [...this.#entries.values()].map(entry => this.#view(entry, hidden))
    return includeHidden ? sessions : sessions.filter(session => !session.hidden)
  }

  get(sessionId: string): SessionIndex | undefined {
    const entry = this.#entries.get(sessionId)
    return entry === undefined ? undefined : this.#view(entry, new Set(this.#hidden.get()))
  }

  async hide(sessionId: string): Promise<{ hidden: string[]; revision: number }> {
    const operation = this.#hideSerial.then(() => this.#hideNow(sessionId))
    this.#hideSerial = operation.then(() => {}, () => {})
    return operation
  }

  async #hideNow(sessionId: string): Promise<{ hidden: string[]; revision: number }> {
    if (!this.#entries.has(sessionId)) throw new NotFoundError('会话不在索引中')
    const hidden = [sessionId]
    const seen = new Set(hidden)
    for (let index = 0; index < hidden.length; index++) {
      const parent = hidden[index]!
      for (const entry of this.#entries.values()) {
        if (entry.parentSessionId !== parent || seen.has(entry.sessionId)) continue
        seen.add(entry.sessionId)
        hidden.push(entry.sessionId)
      }
    }
    await this.#hidden.set([...new Set([...this.#hidden.get(), ...hidden])])
    for (const id of hidden) this.#markDirty(id)
    this.flush()
    return { hidden, revision: this.#revision }
  }

  replay(session: ProjectableSession): void {
    let events: readonly ProjectableEvent[] | undefined
    const inherited = session.header?.parentSession !== undefined
    if (inherited) events = session.ownEvents?.()
    else events = session.snapshotEvents?.()
    if (events === undefined) {
      const logicalEvents = session.events ?? []
      events = inherited ? logicalEvents.slice(session.inheritedEventCount ?? 0) : logicalEvents
    }
    this.apply(session, events)
  }

  apply(session: ProjectableSession, events: readonly ProjectableEvent[]): void {
    const entry = this.#ensure(session)
    for (const event of events) this.#project(entry, event)
  }

  subscribe(listener: (sessionIds: readonly string[]) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  flush(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
    this.#publish()
  }

  markUnprojectable(session: ProjectableSession, error: unknown): void {
    this.#unprojectable.set(session.id, {
      sessionId: session.id,
      heroId: null,
      title: this.#entries.get(session.id)?.title ?? null,
      reason: error instanceof Error ? error.message : String(error),
      at: Date.now(),
    })
    this.#markDirty(session.id)
  }

  clearUnprojectable(sessionId: string): void {
    if (!this.#unprojectable.delete(sessionId)) return
    this.#markDirty(sessionId)
  }

  unprojectable(): UnprojectableRecord[] {
    return [...this.#unprojectable.values()].sort((left, right) => right.at - left.at)
  }

  ready(): Promise<void> {
    return Promise.resolve()
  }

  #ensure(session: ProjectableSession): IndexEntry {
    const current = this.#entries.get(session.id)
    if (current !== undefined) {
      let changed = false
      if (session.header?.parentSession !== undefined && current.parentSessionId !== session.header.parentSession) {
        current.parentSessionId = session.header.parentSession
        changed = true
      }
      if (session.header?.cwd !== undefined && current.cwd !== session.header.cwd) {
        current.cwd = session.header.cwd
        changed = true
      }
      if (session.inheritedEventCount !== undefined && current.inheritedCount !== session.inheritedEventCount) {
        current.inheritedCount = session.inheritedEventCount
        changed = true
      }
      if (changed) this.#markDirty(session.id)
      return current
    }
    const entry: IndexEntry = {
      sessionId: session.id,
      title: null,
      parentSessionId: session.header?.parentSession ?? null,
      inheritedCount: session.inheritedEventCount ?? 0,
      cwd: session.header?.cwd ?? null,
      cards: [],
      pendingToolCallIds: [],
      lastSeq: -1,
      updatedAt: Date.now(),
    }
    this.#entries.set(session.id, entry)
    this.#markDirty(session.id)
    return entry
  }

  #project(entry: IndexEntry, event: ProjectableEvent): void {
    if (event.seq <= entry.lastSeq) return
    entry.lastSeq = event.seq
    const data = event.data as Record<string, unknown> | undefined

    if (event.type === 'turn/start' && typeof data?.turn === 'number') {
      this.#currentTurns.set(entry.sessionId, data.turn)
    } else if (event.type === 'session/title' && typeof data?.title === 'string') {
      entry.title = data.title.slice(0, MAX_TITLE_LENGTH)
    } else if (event.type === 'tool/call') {
      const callId = String(data?.callId)
      const card = entry.cards.at(-1)
      const turn = typeof data?.turn === 'number' ? data.turn : undefined
      if (card !== undefined && (card.assistantSeq === null || card.turn === turn)) {
        if (!card.toolCallIds.includes(callId)) card.toolCallIds.push(callId)
      } else if (!entry.pendingToolCallIds.includes(callId)) {
        entry.pendingToolCallIds.push(callId)
      }
    } else {
      const projection = projectableEvent(event)
      if (projection?.kind === 'user') {
        if (!entry.cards.some(card => card.userSeq === event.seq)) {
          entry.cards.push({
            turnIndex: entry.cards.length,
            turn: this.#currentTurns.get(entry.sessionId) ?? null,
            userSeq: event.seq,
            assistantSeq: null,
            toolCallIds: [...entry.pendingToolCallIds],
            errorSeq: null,
          })
          entry.pendingToolCallIds.length = 0
        }
      } else if (projection?.kind === 'assistant') {
        const card = entry.cards.at(-1)
        if (card !== undefined) card.assistantSeq = event.seq
      } else if (projection?.kind === 'error') {
        const card = entry.cards.at(-1)
        if (card !== undefined) card.errorSeq = event.seq
      }
    }

    entry.updatedAt = event.time
    this.#markDirty(entry.sessionId)
  }

  #markDirty(sessionId: string): void {
    this.#dirty.add(sessionId)
    if (this.#timer !== null) return
    this.#timer = setTimeout(() => {
      this.#timer = null
      this.#publish()
    }, CHANGE_COALESCE_MS)
  }

  #publish(): void {
    if (this.#dirty.size === 0) return
    const sessionIds = [...this.#dirty]
    this.#dirty = new Set()
    this.#revision++
    for (const listener of this.#listeners) {
      try { listener(sessionIds) } catch { /* Observers cannot reverse a completed index mutation. */ }
    }
  }

  #view(entry: IndexEntry, hidden: ReadonlySet<string>): SessionIndex {
    return {
      ...entry,
      cards: entry.cards.map(card => ({ ...card, toolCallIds: [...card.toolCallIds] })),
      pendingToolCallIds: [...entry.pendingToolCallIds],
      forks: [...this.#entries.values()]
        .filter(candidate => candidate.parentSessionId === entry.sessionId)
        .map(candidate => ({ childSessionId: candidate.sessionId, atSeq: candidate.inheritedCount - 1 })),
      hidden: this.#isHidden(entry, hidden),
    }
  }

  #isHidden(entry: IndexEntry, hidden: ReadonlySet<string>): boolean {
    let sessionId: string | null = entry.sessionId
    const seen = new Set<string>()
    while (sessionId !== null && !seen.has(sessionId)) {
      if (hidden.has(sessionId)) return true
      seen.add(sessionId)
      sessionId = this.#entries.get(sessionId)?.parentSessionId ?? null
    }
    return false
  }
}

export type ProjectionKind = 'user' | 'assistant' | 'error'

export function projectableEvent(event: ProjectableEvent): { kind: ProjectionKind } | null {
  const data = event.data as Record<string, unknown> | undefined
  switch (event.type) {
    case 'user/message': {
      const source = (data?.source ?? undefined) as { kind?: unknown } | undefined
      if (typeof source?.kind === 'string' && source.kind !== 'user') return null
      const text = contentText(data?.content)
      if (isInjectedText(text)) return null
      return text.trim() === '' ? null : { kind: 'user' }
    }
    case 'assistant/message':
      return contentText((data?.message as { content?: unknown } | undefined)?.content).trim() === '' ? null : { kind: 'assistant' }
    case 'turn/end': {
      const reason = data?.reason as { kind?: string } | undefined
      if (reason?.kind === 'error' || reason?.kind === 'aborted' || reason?.kind === 'interrupted') return { kind: 'error' }
      return null
    }
    default:
      return null
  }
}

export function isInjectedText(text: string): boolean {
  const head = text.trimStart()
  return head.startsWith('<system-reminder>')
    || head.startsWith('<skill_content')
    || head.startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.')
}

export function contentText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.flatMap((block: { type?: string; text?: unknown; name?: unknown; arguments?: unknown; content?: unknown }) => {
    if (block?.type === 'text') return [block.text]
    if (block?.type === 'tool-call') return [block.name, block.arguments]
    if (block?.type === 'tool-result') return [contentText(block.content)]
    return []
  }).filter((value): value is string => typeof value === 'string' && value.trim() !== '').join('\n')
}

export function errorText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (value === null || value === undefined || typeof value !== 'object') return null
  const record = value as { name?: unknown; code?: unknown; message?: unknown }
  const name = typeof record.name === 'string' && record.name.trim() !== '' ? record.name.trim() : ''
  const code = typeof record.code === 'string' && record.code.trim() !== '' ? record.code.trim() : ''
  const message = typeof record.message === 'string' && record.message.trim() !== '' ? record.message.trim() : ''
  if (message !== '') return [name, code].filter(Boolean).concat(message).join(': ')
  return [name, code].filter(Boolean).join(': ') || null
}
