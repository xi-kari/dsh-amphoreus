import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SuiteResolver } from './bridge.ts'
import type { AmphoreusConfig } from './config.ts'
import { ObservationSchema, type AmphoreusStores, type ObservationRecord } from './store.ts'
import { compileTemplate, NOTIFY_VERB } from './suite/parse.ts'
import type { AliasTarget, SuiteSnapshot } from './suite/types.ts'

export interface Matchers {
  readonly handoff?: RegExp
  readonly notify?: RegExp
  readonly receipt?: RegExp
  readonly absence?: RegExp
}

type ObservedKind = Exclude<ObservationRecord['kind'], 'dispatch'>

export type Draft = Omit<
  ObservationRecord,
  'sessionId' | 'seq' | 'parsedAt' | 'status' | 'skillName' | 'kind'
> & { readonly kind: ObservedKind }

export interface ObserverOptions {
  readonly config: AmphoreusConfig
  readonly stores: AmphoreusStores
  readonly resolver: SuiteResolver
}

export type DisposeObserver = () => Promise<void>

export function buildMatchers(snapshot: SuiteSnapshot | undefined): Matchers {
  const contracts = snapshot?.contracts
  if (contracts === undefined) return {}

  const notifyTemplate = contracts.handoff.template.startsWith(contracts.handoff.verb)
    ? NOTIFY_VERB + contracts.handoff.template.slice(contracts.handoff.verb.length)
    : undefined
  const notify = notifyTemplate === undefined
    ? undefined
    : compileTemplate(notifyTemplate, 'handoff')

  return {
    ...(contracts.handoff.regex === undefined ? {} : { handoff: contracts.handoff.regex }),
    ...(notify === undefined ? {} : { notify }),
    ...(contracts.receipt === undefined ? {} : { receipt: contracts.receipt.regex }),
    ...(contracts.absence.regex === undefined ? {} : { absence: contracts.absence.regex }),
  }
}

/** Parse contract lines without treating fenced examples as live output. */
export function extractObservations(
  text: string,
  matchers: Matchers,
  nameIndex: ReadonlyMap<string, AliasTarget>,
): Draft[] {
  const lines = contractLines(text)
  const tail = lines.slice(-6)
  const observations: Draft[] = []

  const resolveTarget = (rawName: string): {
    readonly targetSkillName: string | null
    readonly targetDisplayName: string
    readonly targetFace?: string
  } => {
    const targetDisplayName = rawName.trim()
    const target = nameIndex.get(targetDisplayName)
    if (target === undefined) return { targetSkillName: null, targetDisplayName }
    return {
      targetSkillName: target.skill,
      targetDisplayName,
      ...(target.face === undefined ? {} : { targetFace: target.face }),
    }
  }

  for (const line of tail) {
    const handoff = execGroups(matchers.handoff, line)
    if (handoff?.target !== undefined && handoff.target.trim() !== '') {
      observations.push({
        kind: 'handoff',
        rawLine: line,
        payload: handoff.payload ?? '',
        ...resolveTarget(handoff.target),
      })
      continue
    }

    const notify = execGroups(matchers.notify, line)
    if (notify?.target !== undefined && notify.target.trim() !== '') {
      observations.push({
        kind: 'notify',
        rawLine: line,
        payload: notify.payload ?? '',
        ...resolveTarget(notify.target),
      })
    }
  }

  const last = lines.at(-1)
  const receipt = last === undefined ? undefined : execGroups(matchers.receipt, last)
  if (last !== undefined && receipt?.card !== undefined && receipt.card.trim() !== '') {
    observations.push({
      kind: 'receipt',
      rawLine: last,
      payload: receipt.read ?? '',
      ...(receipt.tier === undefined ? {} : { tier: receipt.tier }),
      ...resolveTarget(receipt.card),
    })
  }

  for (const line of lines) {
    const absence = execGroups(matchers.absence, line)
    if (absence === undefined) continue
    observations.push({
      kind: 'absence',
      rawLine: line,
      payload: absence.duty ?? absence.payload ?? '',
      targetSkillName: null,
    })
  }

  return observations
}

/** Observe completed assistant messages; never append to the session log. */
export function registerObserver(ctx: Context, options: ObserverOptions): DisposeObserver {
  const initial = options.resolver.current()
  let matchers = buildMatchers(initial)
  let nameIndex: ReadonlyMap<string, AliasTarget> = initial?.nameIndex ?? new Map()
  let accepting = true
  let pending: Promise<void> = Promise.resolve()

  const observations = options.stores.main.table('observations')
  const bindings = options.stores.main.table('bindings')

  const enabled = (kind: ObservedKind): boolean => {
    if (kind === 'handoff' || kind === 'notify') return options.config.handoff.enabled
    return options.config.receiptParsing
  }

  const updateFace = async (observation: ObservationRecord): Promise<void> => {
    const targetFace = observation.targetFace
    const targetSkillName = observation.targetSkillName
    if (observation.kind !== 'receipt' || targetFace === undefined || targetSkillName == null) return

    const before = bindings.get(observation.sessionId)
    if (before?.skillName !== targetSkillName || before.face === targetFace) return

    await bindings.update(observation.sessionId, current => {
      if (current.skillName !== targetSkillName || current.face === targetFace) return current
      return { ...current, face: targetFace }
    })
  }

  const record = async (
    sessionId: string,
    seq: number,
    text: string,
    eventMatchers: Matchers,
    eventNameIndex: ReadonlyMap<string, AliasTarget>,
  ): Promise<void> => {
    if (!options.config.handoff.enabled && !options.config.receiptParsing) return

    for (const draft of extractObservations(text, eventMatchers, eventNameIndex)) {
      if (!enabled(draft.kind)) continue

      const key = `${sessionId}:${seq}:${draft.kind}`
      let observation = observations.get(key)
      if (observation === undefined) {
        const skillName = bindings.get(sessionId)?.skillName
        observation = ObservationSchema.parse({
          ...draft,
          sessionId,
          seq,
          parsedAt: Date.now(),
          status: draft.kind === 'handoff' ? 'open' : 'accepted',
          ...(skillName === undefined ? {} : { skillName }),
        })
        await observations.put(key, observation)
      }

      // Replay can repair a process interruption between receipt persistence and face persistence.
      await updateFace(observation)
    }
  }

  const enqueueEvent = (sessionId: string, event: SessionEvent): void => {
    if (!accepting || event.type !== 'assistant/message' || event.data.interrupted === true) return
    const text = contentTextOf(event.data.message.content)
    const eventMatchers = matchers
    const eventNameIndex = nameIndex
    pending = pending
      .then(() => record(sessionId, event.seq, text, eventMatchers, eventNameIndex))
      .catch(error => {
        ctx.logger.warn(`amphoreus observer: ${String(error)}`)
      })
  }

  const offSnapshot = options.resolver.onSnapshot(snapshot => {
    matchers = buildMatchers(snapshot)
    nameIndex = snapshot.nameIndex
  })

  // Attach the live listener before replay so the registration window cannot lose an event.
  const offEvent = ctx.on('session/event', (session, event) => {
    enqueueEvent(session.id, event)
  })

  const replaySession = (session: Session): void => {
    try {
      for (const event of session.ownEvents()) enqueueEvent(session.id, event)
    } catch (error) {
      ctx.logger.warn(`amphoreus observer replay ${session.id}: ${String(error)}`)
    }
  }

  // Restored sessions are announced after this plugin starts; their seeded events do not emit session/event.
  const offCreated = ctx.on('session/created', replaySession)

  // Only replay child-owned history; a fork's inherited prefix belongs to its parent session.
  for (const session of ctx.sessions.list()) replaySession(session)

  let disposal: Promise<void> | undefined
  return () => {
    if (disposal !== undefined) return disposal
    accepting = false
    offEvent()
    offCreated()
    offSnapshot()
    disposal = pending
    return disposal
  }
}

/** Non-empty trimmed lines outside code fences and `<details>台账` wrappers (shared with the seat-note parser). */
export function contractLines(text: string): string[] {
  let fence: { readonly character: '`' | '~'; readonly length: number } | undefined
  const lines: string[] = []

  for (const raw of text.split(/\r?\n/u)) {
    let line = raw.trim()
    if (fence === undefined) {
      line = line
        .replace(/^<details>\s*(?:<summary>\s*台账\s*<\/summary>)?/u, '')
        .replace(/^<summary>\s*台账\s*<\/summary>/u, '')
        .replace(/<\/details>$/u, '')
        .trim()
    }
    const markerMatch = /^(`{3,}|~{3,})(.*)$/u.exec(line)
    const marker = markerMatch?.[1]
    if (marker !== undefined) {
      const character = marker[0] as '`' | '~'
      if (fence === undefined) fence = { character, length: marker.length }
      else if (
        fence.character === character
        && marker.length >= fence.length
        && markerMatch?.[2]?.trim() === ''
      ) fence = undefined
      continue
    }
    if (fence !== undefined || line === '') continue
    lines.push(line)
  }

  return lines
}

function execGroups(regex: RegExp | undefined, text: string): Readonly<Record<string, string | undefined>> | undefined {
  if (regex === undefined) return undefined
  regex.lastIndex = 0
  try {
    return regex.exec(text)?.groups
  } finally {
    regex.lastIndex = 0
  }
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
