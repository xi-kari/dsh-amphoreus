/**
 * Per-seat memory pipeline (host half).
 *
 * Notes live ONLY in the plugin storage domain (table `memory`, keyed by skill name);
 * nothing here ever appends to a session log. Three producers feed the same table:
 *   • the seat itself — a `留言：<text>` line in its final turn output (captured on `turn/end`),
 *   • the Trailblazer — the `/remember` command or the settings panel,
 * and one consumer reads it: the seat prompt (see seat-prompt.ts), which labels every
 * injected note as plugin-owned context that is not part of the factual layer.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { randomUUID } from 'node:crypto'
import { SEAT_NOTE_MAX_CHARS, type MemorySettings } from '../shared/api.ts'
import type { AmphoreusConfig } from './config.ts'
import { contractLines } from './observer.ts'
import type { AmphoreusStores, BindingRecord, MemoryRecord } from './store.ts'
import type { SuiteSnapshot } from './suite/types.ts'

/** Matches the plugin-owned note line; ASCII colon tolerated because models drift between widths. */
const NOTE_LINE = /^留言[：:]\s*(.+)$/u
/** Only the tail of a message may carry the note line (mirrors the observer's contract window). */
/** Trailing non-fenced lines inspected for `留言：`; wide enough for a note placed before a multi-row 台账 block plus the receipt. */
const TAIL_LINES = 16
/** Cross-seat context along a handoff edge is capped independently of the seat's own limit. */
const HANDOFF_NOTE_LIMIT = 3
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u

type MemoryTable = KvTable<string, MemoryRecord>
type MemoryNote = MemoryRecord['notes'][number]

export interface SeatNoteInput {
  readonly text: string
  readonly author: 'user' | 'seat'
  readonly id?: string
  readonly sessionId?: string
  readonly seq?: number
}

export interface SeatMemoryNoteView {
  readonly author: 'user' | 'seat' | undefined
  readonly text: string
}

/** What the seat prompt renders; `undefined` from the reader means "nothing to add". */
export interface SeatMemoryContext {
  /** Own notes, oldest first (newest last), already capped by the effective inject limit. */
  readonly notes: readonly SeatMemoryNoteView[]
  /** Latest notes of the seat that handed this session over, when that seat differs. */
  readonly handoff?: { readonly sourceDisplayName: string; readonly notes: readonly SeatMemoryNoteView[] }
  /** Whether to instruct the seat to leave a note line at turn end. */
  readonly autoNote: boolean
}

export type SeatMemoryReader = (binding: BindingRecord) => SeatMemoryContext | undefined

export interface SeatMemoryOptions {
  readonly config: AmphoreusConfig
  readonly stores: AmphoreusStores
  readonly current: () => SuiteSnapshot | undefined
}

export function effectiveMemorySettings(config: AmphoreusConfig, record: MemoryRecord | undefined): MemorySettings {
  const overrides = record?.settings
  return {
    inject: overrides?.inject ?? config.memory.inject,
    autoNote: overrides?.autoNote ?? config.memory.autoNote,
    injectLimit: overrides?.injectLimit ?? config.memory.injectLimit,
  }
}

/** Trim, collapse line breaks and clamp to the shared cap (code points, not UTF-16 units). */
export function normalizeNoteText(text: string): string {
  const flat = text.replace(/\s*\r?\n\s*/gu, ' ').trim()
  const points = [...flat]
  return points.length <= SEAT_NOTE_MAX_CHARS ? flat : points.slice(0, SEAT_NOTE_MAX_CHARS).join('')
}

/** Upper bound of remembered tombstones per seat (oldest dropped first). */
const MAX_TOMBSTONES = 200

const writeChains = new WeakMap<object, Promise<unknown>>()

/**
 * Serialize every memory write (observer, web routes, slash command) on one chain per table.
 * The platform's `put` is an unconditional overwrite, so two "first notes" for the same seat
 * racing through get→put would silently drop one; inside the chain the existence check and the
 * following put/update are atomic with respect to every other memory.ts writer.
 */
export function enqueueMemoryWrite<T>(table: MemoryTable, job: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(table) ?? Promise.resolve()
  const next = previous.then(job, job)
  writeChains.set(table, next.catch(() => undefined))
  return next
}

/** Whether a note can be re-derived from a session log (and therefore needs a tombstone once deleted). */
function replayable(note: Pick<MemoryNote, 'seq' | 'author'>): boolean {
  return note.seq !== undefined || note.author === 'seat'
}

function withTombstone(record: MemoryRecord, ids: readonly string[]): MemoryRecord {
  if (ids.length === 0) return record
  const merged = [...(record.deletedNoteIds ?? []).filter(id => !ids.includes(id)), ...ids]
  return { ...record, deletedNoteIds: merged.slice(-MAX_TOMBSTONES) }
}

/**
 * Whole-record replace (legacy PUT route): notes that vanished but could be replayed from a
 * session log are tombstoned so a restart does not resurrect what the workbench ledger deleted.
 * Tombstones only grow: the stored list is unioned with the caller's, and a note the caller
 * still carries but that was tombstoned meanwhile (panel delete racing a stale ledger echo) is
 * dropped rather than resurrected.
 */
export function withReplacementTombstones(previous: MemoryRecord | undefined, next: MemoryRecord): MemoryRecord {
  const tombstones = [...new Set([...(previous?.deletedNoteIds ?? []), ...(next.deletedNoteIds ?? [])])]
  const notes = tombstones.length === 0 ? next.notes : next.notes.filter(note => !tombstones.includes(note.id))
  const kept = new Set(notes.map(note => note.id))
  const removed = (previous?.notes ?? []).filter(note => replayable(note) && !kept.has(note.id)).map(note => note.id)
  const base: MemoryRecord = tombstones.length === 0
    ? { ...next, notes }
    : { ...next, notes, deletedNoteIds: tombstones.slice(-MAX_TOMBSTONES) }
  return withTombstone(base, removed)
}

/**
 * Append one note to a seat's memory record (creating the record when absent).
 * Idempotent by note id: a replayed turn or a retried request never duplicates, and an id the
 * user deleted (tombstoned) is never re-added. Returns the STORED note for that id, or
 * `undefined` when the text is empty after normalization or the id is tombstoned.
 */
export async function appendSeatNote(
  table: MemoryTable,
  skillName: string,
  input: SeatNoteInput,
  now: number = Date.now(),
): Promise<MemoryNote | undefined> {
  const text = normalizeNoteText(input.text)
  if (text === '') return undefined
  const note: MemoryNote = {
    id: input.id ?? `note-${randomUUID()}`,
    text,
    createdAt: now,
    author: input.author,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    ...(input.seq === undefined ? {} : { seq: input.seq }),
  }
  const stored = (record: MemoryRecord | undefined): MemoryNote | undefined => record?.notes.find(candidate => candidate.id === note.id)
  return enqueueMemoryWrite(table, async () => {
    const existing = table.get(skillName)
    if (existing?.deletedNoteIds?.includes(note.id) === true) return undefined
    const duplicate = stored(existing)
    if (duplicate !== undefined) return duplicate
    if (existing === undefined) {
      await table.put(skillName, { skillName, notes: [note], pinnedSessionIds: [], updatedAt: now })
    } else {
      await table.update(skillName, current => current.notes.some(candidate => candidate.id === note.id)
        ? current
        : { ...current, notes: [...current.notes, note], updatedAt: now })
    }
    return stored(table.get(skillName)) ?? note
  })
}

/**
 * Remove one note by id; resolves false when the record or the note does not exist.
 * Replayable (seat-authored / seq-keyed) notes leave a tombstone so `ownEvents()` replay on the
 * next start cannot bring them back.
 */
export async function deleteSeatNote(table: MemoryTable, skillName: string, id: string, now: number = Date.now()): Promise<boolean> {
  return enqueueMemoryWrite(table, async () => {
    const existing = table.get(skillName)
    const target = existing?.notes.find(note => note.id === id)
    if (existing === undefined || target === undefined) return false
    await table.update(skillName, current => withTombstone(
      { ...current, notes: current.notes.filter(note => note.id !== id), updatedAt: now },
      replayable(target) ? [id] : [],
    ))
    return true
  })
}

/** Merge a partial settings patch into the seat record (creating an otherwise empty record). */
export async function patchSeatMemorySettings(
  table: MemoryTable,
  skillName: string,
  patch: Partial<MemorySettings>,
  now: number = Date.now(),
): Promise<MemoryRecord> {
  const merge = (current: MemoryRecord): MemoryRecord => ({
    ...current,
    settings: { ...current.settings, ...definedEntries(patch) },
    updatedAt: now,
  })
  return enqueueMemoryWrite(table, async () => {
    if (table.get(skillName) === undefined) {
      const created = merge({ skillName, notes: [], pinnedSessionIds: [], updatedAt: now })
      await table.put(skillName, created)
      return created
    }
    return table.update(skillName, merge)
  })
}

/**
 * Find the seat's note in a completed message: the LAST `留言：…` line among the trailing
 * non-fenced lines. Fenced examples and `<details>台账` wrappers are ignored by contractLines;
 * a receipt line never matches this shape, so the two contracts coexist.
 */
export function extractSeatNote(text: string): string | undefined {
  const tail = contractLines(text).slice(-TAIL_LINES)
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const match = NOTE_LINE.exec(tail[index]!)
    if (match?.[1] !== undefined) {
      const note = normalizeNoteText(match[1])
      if (note !== '') return note
    }
  }
  return undefined
}

/** Build the prompt-facing reader over the live tables (sync; called on every prompt assembly). */
export function createSeatMemoryReader(options: SeatMemoryOptions): SeatMemoryReader {
  const memory = () => options.stores.main.table('memory')
  const bindings = () => options.stores.main.table('bindings')
  const view = (note: MemoryNote): SeatMemoryNoteView => ({ author: note.author, text: note.text })
  return binding => {
    const record = memory().get(binding.skillName)
    const settings = effectiveMemorySettings(options.config, record)
    const notes = settings.inject && settings.injectLimit > 0
      ? (record?.notes ?? []).slice(-settings.injectLimit).map(view)
      : []
    let handoff: SeatMemoryContext['handoff']
    if (settings.inject && settings.injectLimit > 0 && binding.handoffFrom !== undefined) {
      const source = bindings().get(binding.handoffFrom.sessionId)
      if (source !== undefined && source.skillName !== binding.skillName) {
        const sourceRecord = memory().get(source.skillName)
        const sourceSettings = effectiveMemorySettings(options.config, sourceRecord)
        // The source seat's own switches govern what leaves it: inject off OR injectLimit 0 → nothing crosses.
        const sourceNotes = sourceSettings.inject && sourceSettings.injectLimit > 0
          ? (sourceRecord?.notes ?? []).slice(-Math.min(HANDOFF_NOTE_LIMIT, sourceSettings.injectLimit)).map(view)
          : []
        if (sourceNotes.length > 0) {
          handoff = { sourceDisplayName: displayNameOf(options, source.skillName), notes: sourceNotes }
        }
      }
    }
    if (notes.length === 0 && handoff === undefined && !settings.autoNote) return undefined
    return { notes, ...(handoff === undefined ? {} : { handoff }), autoNote: settings.autoNote }
  }
}

const installedReaders = new WeakMap<AmphoreusStores, SeatMemoryReader>()

/**
 * Reader the seat prompt falls back to when its caller passed none. Keyed by the store
 * instance so the prompt hook (registered before this module starts) resolves it lazily.
 */
export function installedSeatMemoryReader(stores: AmphoreusStores): SeatMemoryReader | undefined {
  return installedReaders.get(stores)
}

export type DisposeSeatMemory = () => Promise<void>

/**
 * Capture the seat's `留言：` line when a turn completes. Listens to the durable session log
 * (`turn/end` with reason `completed`), locates the final non-interrupted assistant message of
 * that turn and appends `{author:'seat'}` with a seq-stable id so startup replay is idempotent.
 * Aborted / errored / blocked turns leave no note. Writes are serialized on one promise chain.
 */
export function registerSeatNoteObserver(ctx: Context, options: Pick<SeatMemoryOptions, 'config' | 'stores'>): DisposeSeatMemory {
  let accepting = true
  let pending: Promise<void> = Promise.resolve()
  const memory = options.stores.main.table('memory')
  const bindings = options.stores.main.table('bindings')

  const record = async (session: Session, turnEnd: SessionEvent<'turn/end'>): Promise<void> => {
    const binding = bindings.get(session.id)
    if (binding === undefined) return
    if (!effectiveMemorySettings(options.config, memory.get(binding.skillName)).autoNote) return
    const final = finalAssistantMessage(session, turnEnd)
    if (final === undefined) return
    const text = extractSeatNote(contentTextOf(final.data.message.content))
    if (text === undefined) return
    await appendSeatNote(memory, binding.skillName, {
      text,
      author: 'seat',
      id: `${session.id}:${final.seq}:note`,
      sessionId: session.id,
      seq: final.seq,
    })
  }

  const enqueue = (session: Session, event: SessionEvent): void => {
    if (!accepting || event.type !== 'turn/end' || event.data.reason.kind !== 'completed') return
    pending = pending
      .then(() => record(session, event))
      .catch(error => {
        ctx.logger.warn(`amphoreus seat note: ${String(error)}`)
      })
  }

  // Live listener first so the replay window cannot lose an event.
  const offEvent = ctx.on('session/event', (session, event) => { enqueue(session, event) })
  const replay = (session: Session): void => {
    try {
      for (const event of session.ownEvents()) enqueue(session, event)
    } catch (error) {
      ctx.logger.warn(`amphoreus seat note replay ${session.id}: ${String(error)}`)
    }
  }
  const offCreated = ctx.on('session/created', replay)
  for (const session of ctx.sessions.list()) replay(session)

  let disposal: Promise<void> | undefined
  return () => {
    if (disposal !== undefined) return disposal
    accepting = false
    offEvent()
    offCreated()
    disposal = pending
    return disposal
  }
}

/**
 * `/remember <text>`: the Trailblazer leaves a note for the seat bound to the receiving session.
 * Errors keep the composer draft (unbound session, empty or over-long text). Registration
 * failures (invalid or duplicate name) are logged and degrade to "no command".
 */
export function registerRememberCommand(ctx: Context, options: SeatMemoryOptions): () => void {
  const name = options.config.memory.command.trim()
  if (!COMMAND_NAME.test(name)) {
    ctx.logger.warn(`amphoreus memory: command name "${name}" is invalid; /remember disabled`)
    return () => {}
  }
  const handler = async (invocation: CommandInvocation): Promise<CommandResult> => {
    const sessionId = invocation.agent.session.id
    const binding = options.stores.main.table('bindings').get(sessionId)
    if (binding === undefined) return { kind: 'error', text: '当前会话未绑定黄金裔席位，没有可以留言的对象。' }
    const text = normalizeNoteText(invocation.rawInput)
    if (text === '') return { kind: 'error', text: `请在 /${name} 后写下要让本席下次记得的话。` }
    const length = [...invocation.rawInput.replace(/\s*\r?\n\s*/gu, ' ').trim()].length
    if (length > SEAT_NOTE_MAX_CHARS) return { kind: 'error', text: `留言最多 ${SEAT_NOTE_MAX_CHARS} 字，当前 ${length} 字。` }
    await appendSeatNote(options.stores.main.table('memory'), binding.skillName, { text, author: 'user', sessionId })
    return { kind: 'success', text: `已为「${displayNameOf(options, binding.skillName)}」记下：${text}` }
  }
  try {
    return ctx.commands.register({
      name,
      description: '为当前席位留一条记忆（保存在插件存储，不写入会话记录）',
      input: { hint: '要让本席下次记得的话，不超过 200 字' },
      handler,
    })
  } catch (error) {
    ctx.logger.warn(`amphoreus memory: command /${name} not registered: ${String(error)}`)
    return () => {}
  }
}

/** Wire the whole pipeline: prompt reader, turn-end capture and the slash command. */
export function registerSeatMemory(ctx: Context, options: SeatMemoryOptions): DisposeSeatMemory {
  installedReaders.set(options.stores, createSeatMemoryReader(options))
  const disposeCommand = registerRememberCommand(ctx, options)
  const disposeObserver = registerSeatNoteObserver(ctx, options)
  return async () => {
    disposeCommand()
    installedReaders.delete(options.stores)
    await disposeObserver()
  }
}

function displayNameOf(options: SeatMemoryOptions, skillName: string): string {
  const card = options.current()?.cards.get(skillName)
  if (card !== undefined) return card.displayName
  const seat = options.stores.main.table('seats').get(skillName)
  return seat?.userDisplayName ?? seat?.displayName ?? skillName
}

function finalAssistantMessage(session: Session, turnEnd: SessionEvent<'turn/end'>): SessionEvent<'assistant/message'> | undefined {
  const events = session.snapshotEvents()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.seq >= turnEnd.seq) continue
    if (event.type !== 'assistant/message') continue
    if (event.data.turn !== turnEnd.data.turn) {
      // Events are in log order: once we pass into an earlier turn nothing later can match.
      if (event.data.turn < turnEnd.data.turn) return undefined
      continue
    }
    if (event.data.interrupted === true) continue
    return event
  }
  return undefined
}

function contentTextOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const text: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const value = block as Record<string, unknown>
    if (value.type === 'text' && typeof value.text === 'string') text.push(value.text)
  }
  return text.join('\n')
}

function definedEntries<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>
}
