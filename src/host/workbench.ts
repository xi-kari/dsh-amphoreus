/**
 * Workbench projection: the dsh-synapse WorkspaceStore reshaped around seats.
 * One projection workspace per golden-blood seat (heroId), plus one "全体"
 * workspace for unassigned sessions. A session belongs to a seat when the
 * amphoreus `bindings` table says so, or when its cwd sits under that seat's
 * folder (`<dataDir>/seats/<heroId>`). DSH stays the source of session truth;
 * this file persists only the canvas graph + projected message text.
 *
 * Ported from liangmianya/dsh-synapse (MIT, see NOTICE); trimmed to the parts
 * the amphoreus workbench uses: projection, branch/thread graph, notes.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, sep } from 'node:path'
import type { UnprojectableRecord } from '../shared/api.ts'

const MAX_TITLE_LENGTH = 120
const MAX_NOTE_LENGTH = 4_000
const MAX_PROJECTION_LENGTH = 8_000
const PROJECTION_TRUNCATED_SUFFIX = '\n——…（详情查看全文）'
const SAVE_DEBOUNCE_MS = 800
const LOCK_STALE_MS = 60_000
const TOPIC_COLORS = ['#8a681c', '#37305e', '#2563eb', '#be123c', '#0f766e'] as const

export class InputError extends Error {}
export class NotFoundError extends Error {}

export interface ThreadProcessEntry {
  callId: string
  turn?: number
  step?: number
  name: string
  arguments: string | null
  result: string | null
  error: string | null
}

export interface ThreadMessage {
  id: string
  text: string
  kind: 'user' | 'assistant' | 'todo' | 'error'
  at: string
  sourceSeq?: number
  turn?: number
  step?: number
  process?: ThreadProcessEntry[]
}

export interface WorkbenchThread {
  id: string
  title: string
  parentId: string | null
  sourceParentSessionId: string | null
  sourceSeedLength: number | null
  dshSessionId: string | null
  dshSessionTitle: string | null
  color: string
  position: { x: number; y: number }
  createdAt: string
  updatedAt: string
  messages: ThreadMessage[]
  pendingProcess: (ThreadProcessEntry & { turn?: number; step?: number })[]
}

export interface WorkbenchWorkspace {
  /** `seat:<heroId>` or `all`. Stable — the browser routes by it. */
  id: string
  heroId: string | null
  title: string
  createdAt: string
  updatedAt: string
  threads: WorkbenchThread[]
}

export interface WorkspaceSummary {
  id: string
  heroId: string | null
  title: string
  createdAt: string
  updatedAt: string
  threadCount: number
  updatedThreadAt: string | null
}

interface WorkbenchState {
  version: 1
  hiddenSessionIds: string[]
  workspaces: WorkbenchWorkspace[]
}

/** Minimal shape of a live DSH session this store reads. */
export interface ProjectableSession {
  readonly id: string
  readonly title?: string
  readonly header?: { cwd?: string; parentSession?: string; seedLength?: number }
  readonly firstLiveSeq?: number
  events?: readonly ProjectableEvent[]
}

export interface ProjectableEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data?: unknown
}

export interface SeatResolver {
  /** heroId for a session, or null → the shared "all" workspace. */
  seatOf(session: ProjectableSession): string | null
  /** Display title for a seat workspace (live suite name preferred). */
  seatTitle(heroId: string): string
}

const ALL_WORKSPACE_ID = 'all'

export class WorkbenchStore {
  readonly #dataFile: string
  readonly #resolver: SeatResolver
  #state: WorkbenchState | undefined
  #serial: Promise<unknown> = Promise.resolve()
  readonly #ready: Promise<void>
  readonly #unprojectable = new Map<string, UnprojectableRecord>()
  #dirty = false
  #flushTimer: NodeJS.Timeout | null = null
  #lastKnownMtime: number | null = null
  #warned = false

  constructor(dataFile: string, resolver: SeatResolver) {
    if (dataFile.trim() === '') throw new Error('workbench: dataFile must be a non-empty path')
    this.#dataFile = dataFile
    this.#resolver = resolver
    this.#ready = this.#load()
    this.#ready.catch(() => {})
  }

  /** 首次加载完成；失败时 reject（原因即 workbench.json 不可读）。 */
  ready(): Promise<void> {
    return this.#ready
  }

  markUnprojectable(session: ProjectableSession, error: unknown): void {
    this.#unprojectable.set(session.id, {
      sessionId: session.id,
      heroId: this.#resolver.seatOf(session),
      title: typeof session.title === 'string' && session.title.trim() !== '' ? session.title.slice(0, 80) : null,
      reason: error instanceof Error ? error.message : String(error),
      at: Date.now(),
    })
  }

  clearUnprojectable(sessionId: string): void {
    this.#unprojectable.delete(sessionId)
  }

  unprojectable(): UnprojectableRecord[] {
    return [...this.#unprojectable.values()].sort((a, b) => b.at - a.at)
  }

  async list(): Promise<WorkspaceSummary[]> {
    await this.#ready
    return this.#state!.workspaces.map(workspace => this.#summary(workspace))
  }

  async get(workspaceId: string): Promise<WorkbenchWorkspace> {
    await this.#ready
    return structuredClone(this.#workspace(workspaceId))
  }

  async addNote(threadId: string, text: string): Promise<WorkbenchThread> {
    return this.#mutate(() => {
      const { workspace, thread } = this.#locateThread(threadId)
      const at = new Date().toISOString()
      thread.messages.push({ id: randomUUID(), text: requiredText(text, MAX_NOTE_LENGTH, 'text'), kind: 'user', at })
      thread.updatedAt = at
      workspace.updatedAt = at
      return structuredClone(thread)
    })
  }

  async updateThread(threadId: string, input: { title?: string; position?: { x: number; y: number } }): Promise<WorkbenchThread> {
    return this.#mutate(() => {
      const { workspace, thread } = this.#locateThread(threadId)
      if (input.title !== undefined) thread.title = requiredText(input.title, MAX_TITLE_LENGTH, 'title')
      if (input.position !== undefined) thread.position = positionOf(input.position)
      thread.updatedAt = new Date().toISOString()
      workspace.updatedAt = thread.updatedAt
      return structuredClone(thread)
    })
  }

  /** Archive a thread (and its canvas descendants). The DSH session survives. */
  async removeThread(threadId: string): Promise<{ removed: number }> {
    return this.#mutate(() => {
      const { workspace, thread } = this.#locateThread(threadId)
      const removal = new Set([thread.id])
      for (let changed = true; changed;) {
        changed = false
        for (const item of workspace.threads) {
          if (item.parentId !== null && removal.has(item.parentId) && !removal.has(item.id)) {
            removal.add(item.id)
            changed = true
          }
        }
      }
      for (const item of workspace.threads) {
        if (removal.has(item.id) && item.dshSessionId !== null && !this.#state!.hiddenSessionIds.includes(item.dshSessionId)) {
          this.#state!.hiddenSessionIds.push(item.dshSessionId)
        }
      }
      workspace.threads = workspace.threads.filter(item => !removal.has(item.id))
      workspace.updatedAt = new Date().toISOString()
      return { removed: removal.size }
    })
  }

  /** Record a fork relation the browser initiated (branch card). */
  async branch(threadId: string, input: {
    title?: string
    dshSessionId?: string
    dshSessionTitle?: string
    position?: { x: number; y: number }
  }): Promise<WorkbenchThread> {
    return this.#mutate(() => {
      const { workspace, thread: parent } = this.#locateThread(threadId)
      const now = new Date().toISOString()
      const sessionId = typeof input.dshSessionId === 'string' && input.dshSessionId !== '' ? input.dshSessionId : null
      if (sessionId !== null) {
        const existing = workspace.threads.find(item => item.dshSessionId === sessionId)
        if (existing !== undefined) {
          existing.parentId ??= parent.id
          if (typeof input.title === 'string' && input.title.trim() !== '') existing.title = requiredText(input.title, MAX_TITLE_LENGTH, 'title')
          if (typeof input.dshSessionTitle === 'string') existing.dshSessionTitle = input.dshSessionTitle.slice(0, MAX_TITLE_LENGTH)
          existing.updatedAt = now
          workspace.updatedAt = now
          return structuredClone(existing)
        }
      }
      const siblings = workspace.threads.filter(item => item.parentId === parent.id)
      const thread: WorkbenchThread = {
        id: randomUUID(),
        title: requiredText(input.title ?? '新的分支', MAX_TITLE_LENGTH, 'title'),
        parentId: parent.id,
        sourceParentSessionId: parent.dshSessionId,
        sourceSeedLength: null,
        dshSessionId: sessionId,
        dshSessionTitle: typeof input.dshSessionTitle === 'string' ? input.dshSessionTitle.slice(0, MAX_TITLE_LENGTH) : null,
        color: parent.color,
        position: positionOf(input.position ?? { x: parent.position.x + 420, y: parent.position.y + siblings.length * 248 }),
        createdAt: now,
        updatedAt: now,
        messages: [],
        pendingProcess: [],
      }
      workspace.threads.push(thread)
      workspace.updatedAt = now
      return structuredClone(thread)
    })
  }

  /** Replay a live session into its seat workspace (startup / created). */
  async projectSession(session: ProjectableSession, replayFrom = 0): Promise<void> {
    const events = session.events ?? []
    await this.#mutate(() => {
      if (this.#state!.hiddenSessionIds.includes(session.id)) return
      const workspace = this.#seatWorkspace(session)
      const thread = this.#sessionThread(workspace, session)
      for (const event of events) {
        if (event.seq >= replayFrom) this.#projectEventInto(workspace, thread, event)
      }
    }, { deferred: true })
  }

  /** Project a batch of committed events for one session in a single write. */
  async projectEvents(session: ProjectableSession, events: readonly ProjectableEvent[]): Promise<void> {
    if (events.length === 0) return
    await this.#mutate(() => {
      if (this.#state!.hiddenSessionIds.includes(session.id)) return
      const workspace = this.#seatWorkspace(session)
      const thread = this.#sessionThread(workspace, session)
      for (const event of events) this.#projectEventInto(workspace, thread, event)
    }, { deferred: true })
  }

  /** Flush any deferred writes now (dispose path). */
  async flush(): Promise<void> {
    if (this.#flushTimer !== null) {
      clearTimeout(this.#flushTimer)
      this.#flushTimer = null
    }
    if (!this.#dirty) return
    this.#dirty = false
    const task = this.#serial.then(() => this.#save())
    this.#serial = task.catch(() => undefined)
    await task
  }

  // ---- internals ----------------------------------------------------------

  async #load(): Promise<void> {
    await mkdir(dirname(this.#dataFile), { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(this.#dataFile, 'utf8')) as WorkbenchState
      if (parsed.version !== 1 || !Array.isArray(parsed.workspaces)) throw new Error('unexpected workbench data version')
      this.#state = parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`workbench: cannot read ${this.#dataFile}: ${String(error)}`)
      }
      this.#state = { version: 1, hiddenSessionIds: [], workspaces: [] }
      await this.#save()
    }
  }

  async #mutate<T>(action: () => T, { deferred = false } = {}): Promise<T> {
    await this.#ready
    const task = this.#serial.then(async () => {
      const result = action()
      if (deferred) this.#markDirty()
      else await this.#save()
      return result
    })
    this.#serial = task.catch(() => undefined)
    return task
  }

  #markDirty(): void {
    this.#dirty = true
    if (this.#flushTimer !== null) return
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null
      if (!this.#dirty) return
      this.#dirty = false
      const task = this.#serial.then(() => this.#save())
      this.#serial = task.catch(() => undefined)
    }, SAVE_DEBOUNCE_MS)
  }

  async #save(): Promise<void> {
    const before = await this.#fileMtime()
    if (this.#lastKnownMtime !== null && before !== null && before !== this.#lastKnownMtime && !this.#warned) {
      this.#warned = true
      process.stderr.write('dsh-amphoreus: workbench.json 被另一实例修改，写入可能相互覆盖——请只运行一个 dsh web 实例\n')
    }
    await this.#acquireLock()
    try {
      const temporary = `${this.#dataFile}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(this.#state)}\n`, 'utf8')
      await rename(temporary, this.#dataFile)
      this.#lastKnownMtime = (await stat(this.#dataFile)).mtimeMs
    } finally {
      await unlink(`${this.#dataFile}.lock`).catch(() => {})
    }
  }

  async #fileMtime(): Promise<number | null> {
    try {
      return (await stat(this.#dataFile)).mtimeMs
    } catch {
      return null
    }
  }

  async #acquireLock(): Promise<void> {
    const lockFile = `${this.#dataFile}.lock`
    try {
      await writeFile(lockFile, `${process.pid}\n`, { flag: 'wx' })
      return
    } catch {
      // Below: break a stale lock, else proceed with a warning-free best effort.
    }
    try {
      const stats = await stat(lockFile)
      if (Date.now() - stats.mtimeMs > LOCK_STALE_MS) {
        await unlink(lockFile).catch(() => {})
        await writeFile(lockFile, `${process.pid}\n`, { flag: 'wx' }).catch(() => {})
      }
    } catch {
      // Lock owner vanished between checks; the save proceeds unguarded.
    }
  }

  #workspace(workspaceId: string): WorkbenchWorkspace {
    const workspace = this.#state!.workspaces.find(item => item.id === workspaceId)
    if (workspace === undefined) throw new NotFoundError('工作空间不存在')
    return workspace
  }

  #locateThread(threadId: string): { workspace: WorkbenchWorkspace; thread: WorkbenchThread } {
    for (const workspace of this.#state!.workspaces) {
      const thread = workspace.threads.find(item => item.id === threadId)
      if (thread !== undefined) return { workspace, thread }
    }
    throw new NotFoundError('节点不存在')
  }

  #seatWorkspace(session: ProjectableSession): WorkbenchWorkspace {
    const heroId = this.#resolver.seatOf(session)
    const id = heroId === null ? ALL_WORKSPACE_ID : `seat:${heroId}`
    let workspace = this.#state!.workspaces.find(item => item.id === id)
    const title = heroId === null ? '全体会议' : this.#resolver.seatTitle(heroId)
    if (workspace !== undefined) {
      if (workspace.title !== title) workspace.title = title
      return workspace
    }
    const now = new Date().toISOString()
    workspace = { id, heroId, title, createdAt: now, updatedAt: now, threads: [] }
    this.#state!.workspaces.unshift(workspace)
    return workspace
  }

  #sessionThread(workspace: WorkbenchWorkspace, session: ProjectableSession): WorkbenchThread {
    let thread = workspace.threads.find(item => item.dshSessionId === session.id)
    if (thread !== undefined) {
      if (typeof session.title === 'string' && session.title.trim() !== '') {
        const title = session.title.slice(0, MAX_TITLE_LENGTH)
        thread.title = title
        thread.dshSessionTitle = title
      }
      const seedLength = session.header?.seedLength
      if (Number.isSafeInteger(seedLength) && (seedLength as number) >= 0) thread.sourceSeedLength = seedLength as number
      return thread
    }
    const parentSessionId = typeof session.header?.parentSession === 'string' ? session.header.parentSession : null
    const parent = parentSessionId === null ? undefined : workspace.threads.find(item => item.dshSessionId === parentSessionId)
    const now = new Date().toISOString()
    thread = {
      id: randomUUID(),
      title: typeof session.title === 'string' && session.title.trim() !== ''
        ? session.title.slice(0, MAX_TITLE_LENGTH)
        : (parent === undefined ? 'DSH 会话' : `${parent.title} 分支`),
      parentId: parent?.id ?? null,
      sourceParentSessionId: parentSessionId,
      sourceSeedLength: Number.isSafeInteger(session.header?.seedLength) && (session.header!.seedLength as number) >= 0
        ? session.header!.seedLength as number
        : null,
      dshSessionId: session.id,
      dshSessionTitle: typeof session.title === 'string' ? session.title.slice(0, MAX_TITLE_LENGTH) : null,
      color: TOPIC_COLORS[workspace.threads.length % TOPIC_COLORS.length]!,
      position: parent === undefined ? { x: 86, y: 82 } : { x: parent.position.x + 400, y: parent.position.y },
      createdAt: now,
      updatedAt: now,
      messages: [],
      pendingProcess: [],
    }
    workspace.threads.push(thread)
    for (const child of workspace.threads) {
      if (child.sourceParentSessionId === session.id && child.parentId === null) child.parentId = thread.id
    }
    workspace.updatedAt = now
    return thread
  }

  #projectEventInto(workspace: WorkbenchWorkspace, thread: WorkbenchThread, event: ProjectableEvent): void {
    if (event.type === 'session/title' && typeof (event.data as { title?: unknown } | undefined)?.title === 'string') {
      thread.title = ((event.data as { title: string }).title).slice(0, MAX_TITLE_LENGTH)
      thread.dshSessionTitle = thread.title
      thread.updatedAt = new Date(event.time).toISOString()
      workspace.updatedAt = thread.updatedAt
      return
    }
    if (event.type === 'tool/call' || event.type === 'tool/result') {
      this.#foldToolProcess(thread, event)
      workspace.updatedAt = thread.updatedAt
      return
    }
    const projection = projectableEvent(event)
    if (projection === null || thread.messages.some(message => message.sourceSeq === event.seq)) return
    const at = new Date(event.time).toISOString()
    const data = event.data as { turn?: number; step?: number } | undefined
    const message: ThreadMessage = {
      id: randomUUID(),
      text: projection.text,
      kind: projection.kind,
      sourceSeq: event.seq,
      at,
      ...(projection.kind === 'assistant' || projection.kind === 'error'
        ? { ...(data?.turn === undefined ? {} : { turn: data.turn }), ...(data?.step === undefined ? {} : { step: data.step }), process: [] }
        : {}),
    }
    this.#attachPendingProcess(thread, message)
    thread.messages.push(message)
    thread.updatedAt = at
    workspace.updatedAt = at
    if (thread.dshSessionTitle === null && projection.kind === 'user') {
      thread.title = titleFromText(projection.text)
      thread.dshSessionTitle = thread.title
    }
  }

  #foldToolProcess(thread: WorkbenchThread, event: ProjectableEvent): void {
    const at = new Date(event.time).toISOString()
    const data = (event.data ?? {}) as Record<string, unknown>
    const turn = data.turn as number | undefined
    const step = data.step as number | undefined
    const target = [...thread.messages].reverse().find(message =>
      (message.kind === 'assistant' || message.kind === 'error')
      && ((message.turn === turn && message.step === step)
        || (message.turn === undefined && message.step === undefined)))
    const process = target === undefined ? (thread.pendingProcess ??= []) : (target.process ??= [])
    const callId = String(event.type === 'tool/call'
      ? data.callId
      : (data.message as { source?: { callId?: unknown } } | undefined)?.source?.callId ?? '')
    const entry = process.find(item => item.callId === callId)
    if (event.type === 'tool/call') {
      if (entry === undefined) {
        process.push({
          callId,
          ...(turn === undefined ? {} : { turn }),
          ...(step === undefined ? {} : { step }),
          name: String(data.name ?? '工具调用'),
          arguments: typeof data.arguments === 'string' ? data.arguments : null,
          result: null,
          error: null,
        })
      } else {
        entry.name = String(data.name ?? entry.name)
        entry.arguments = typeof data.arguments === 'string' ? data.arguments : entry.arguments
      }
    } else {
      const outcome = contentText((data.message as { content?: unknown } | undefined)?.content)
      const error = errorText(data.error)
      if (entry === undefined) {
        process.push({
          callId,
          ...(turn === undefined ? {} : { turn }),
          ...(step === undefined ? {} : { step }),
          name: '工具调用',
          arguments: null,
          result: outcome,
          error,
        })
      } else {
        entry.result = outcome
        entry.error = error
      }
    }
    thread.updatedAt = at
  }

  #attachPendingProcess(thread: WorkbenchThread, message: ThreadMessage): void {
    if (thread.pendingProcess.length === 0 || !Array.isArray(message.process)) return
    const matching = thread.pendingProcess.filter(entry => entry.turn === message.turn && entry.step === message.step)
    if (matching.length === 0) return
    message.process.push(...matching.map(({ turn: _turn, step: _step, ...entry }) => entry))
    thread.pendingProcess = thread.pendingProcess.filter(entry => entry.turn !== message.turn || entry.step !== message.step)
  }

  #summary(workspace: WorkbenchWorkspace): WorkspaceSummary {
    let updatedThreadAt: string | null = null
    for (const thread of workspace.threads) {
      if (updatedThreadAt === null || thread.updatedAt > updatedThreadAt) updatedThreadAt = thread.updatedAt
    }
    return {
      id: workspace.id,
      heroId: workspace.heroId,
      title: workspace.title,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      threadCount: workspace.threads.length,
      updatedThreadAt,
    }
  }
}

/** Build a SeatResolver over the amphoreus bindings + seat folders. */
export function createSeatResolver(options: {
  bindingSeat(sessionId: string): string | undefined
  heroIdOfSkill(skillName: string): string | undefined
  seatDirs: readonly { heroId: string; dir: string }[]
  seatTitle(heroId: string): string
}): SeatResolver {
  const normalizedDirs = options.seatDirs.map(entry => ({
    heroId: entry.heroId,
    prefix: entry.dir.replaceAll('/', sep).toLowerCase().replace(/[\\/]+$/, '') + sep,
    exact: entry.dir.replaceAll('/', sep).toLowerCase().replace(/[\\/]+$/, ''),
  }))
  return {
    seatOf(session) {
      const bound = options.bindingSeat(session.id)
      if (bound !== undefined) {
        const heroId = options.heroIdOfSkill(bound)
        if (heroId !== undefined) return heroId
      }
      const cwd = session.header?.cwd
      if (typeof cwd === 'string' && cwd !== '') {
        const lowered = cwd.replaceAll('/', sep).toLowerCase().replace(/[\\/]+$/, '')
        for (const entry of normalizedDirs) {
          if (lowered === entry.exact || lowered.startsWith(entry.prefix)) return entry.heroId
        }
      }
      return null
    },
    seatTitle: options.seatTitle,
  }
}

// ---- pure helpers ----------------------------------------------------------

export function projectableEvent(event: ProjectableEvent): { kind: ThreadMessage['kind']; text: string } | null {
  const data = event.data as Record<string, unknown> | undefined
  switch (event.type) {
    case 'user/message': {
      const text = contentText((data as { content?: unknown } | undefined)?.content)
      return isRuntimeContextText(text) ? null : noteProjection('user', text)
    }
    case 'assistant/message':
      return noteProjection('assistant', contentText((data?.message as { content?: unknown } | undefined)?.content))
    case 'todo/write':
      return noteProjection('todo', Array.isArray(data?.todos)
        ? (data.todos as { status?: unknown; content?: unknown }[]).map(todo => `[${String(todo.status)}] ${String(todo.content)}`).join('\n')
        : '')
    case 'turn/end': {
      const reason = data?.reason as { kind?: string; error?: unknown } | undefined
      if (reason?.kind === 'error') return noteProjection('error', errorText(reason.error) ?? '本轮执行失败')
      if (reason?.kind === 'cancelled' || reason?.kind === 'canceled' || reason?.kind === 'aborted') return noteProjection('error', '本轮已取消')
      return null
    }
    default:
      return /(?:error|failed|failure|cancel(?:led)?|abort)/i.test(event.type)
        ? noteProjection('error', errorText(data?.error ?? data?.reason ?? data) ?? 'Harness 运行失败')
        : null
  }
}

function noteProjection(kind: ThreadMessage['kind'], text: string): { kind: ThreadMessage['kind']; text: string } | null {
  const normalized = text.trim()
  if (normalized === '') return null
  if (normalized.length <= MAX_PROJECTION_LENGTH) return { kind, text: normalized }
  return { kind, text: `${normalized.slice(0, MAX_PROJECTION_LENGTH)}${PROJECTION_TRUNCATED_SUFFIX}` }
}

function isRuntimeContextText(text: string): boolean {
  return text.trimStart().startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.')
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

function errorText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (value === null || value === undefined || typeof value !== 'object') return null
  const record = value as { name?: unknown; code?: unknown; message?: unknown }
  const name = typeof record.name === 'string' && record.name.trim() !== '' ? record.name.trim() : ''
  const code = typeof record.code === 'string' && record.code.trim() !== '' ? record.code.trim() : ''
  const message = typeof record.message === 'string' && record.message.trim() !== '' ? record.message.trim() : ''
  if (message !== '') return [name, code].filter(Boolean).concat(message).join(': ')
  return [name, code].filter(Boolean).join(': ') || null
}

function titleFromText(text: string): string {
  const line = text.replaceAll(/\s+/g, ' ').trim()
  return (line.length > 42 ? `${line.slice(0, 42)}...` : line) || 'DSH 会话'
}

function positionOf(value: { x?: unknown; y?: unknown } | undefined): { x: number; y: number } {
  const x = Number(value?.x)
  const y = Number(value?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new InputError('position 必须包含有效坐标')
  return { x: Math.round(Math.max(-2000, Math.min(5000, x))), y: Math.round(Math.max(-2000, Math.min(5000, y))) }
}

function requiredText(value: unknown, maxLength: number, field: string): string {
  if (typeof value !== 'string') throw new InputError(`${field} 必须是文本`)
  const text = value.trim()
  if (text.length === 0) throw new InputError(`${field} 不能为空`)
  if (text.length > maxLength) throw new InputError(`${field} 超过长度限制`)
  return text
}
