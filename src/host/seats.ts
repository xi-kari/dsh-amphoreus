import { heroVisualOf } from '../shared/heroes.ts'
import { updateAmphoreusGlobal, type AmphoreusDomain, type AmphoreusGlobal, type SeatRecord, type SuiteEventRecord } from './store.ts'
import type { CardName, SuiteSnapshot } from './suite/types.ts'

export interface RenameHint {
  readonly from: CardName
  readonly to: CardName
  readonly similarity?: number
}

export interface SeatPut {
  readonly key: string
  readonly value: SeatRecord
  readonly change: 'added' | 'updated' | 'undeployed' | 'renamed'
}

export interface SeatReconcilePlan {
  readonly puts: readonly SeatPut[]
  readonly global: AmphoreusGlobal
  readonly globalChanged: boolean
  readonly events: readonly SuiteEventRecord[]
}

export interface SeatReconcileResult {
  readonly added: number
  readonly updated: number
  readonly undeployed: number
  readonly renamed: number
  readonly events: number
}

/** Pure reconciliation plan; generated fields change, user overrides survive. */
export function planSeatReconciliation(
  snapshot: SuiteSnapshot,
  existingEntries: readonly (readonly [string, SeatRecord])[],
  currentGlobal: AmphoreusGlobal,
  at: number,
  renames: readonly RenameHint[] = [],
): SeatReconcilePlan {
  const existing = new Map(existingEntries)
  const next = new Map<string, SeatPut>()
  const events: SuiteEventRecord[] = []
  const revision = snapshot.fingerprint?.manifestSha256
  const unknownNames = [...snapshot.cards.keys()]
    .filter(skill => heroVisualOf(skill) === undefined)
    .sort((left, right) => left.localeCompare(right, 'en'))
  const unknownOrder = new Map(unknownNames.map((name, index) => [name, 13 + index]))

  for (const card of snapshot.cards.values()) {
    const old = existing.get(card.name)
    const visual = heroVisualOf(card.name)
    const generated: SeatRecord = {
      skillName: card.name,
      heroId: visual?.heroId ?? null,
      displayName: card.displayName,
      aliases: [...card.aliases],
      duties: [...card.duties],
      status: 'deployed',
      order: visual?.order ?? unknownOrder.get(card.name) ?? 13,
      firstSeenAt: old?.firstSeenAt ?? at,
      lastSeenAt: at,
      ...(card.duties.length === 0 ? {} : { lastDuty: card.duties.join('、') }),
      ...(revision === undefined ? {} : { lastSeenRevision: revision }),
      ...(old?.renamedFrom === undefined ? {} : { renamedFrom: old.renamedFrom }),
      ...(old?.renamedTo === undefined ? {} : { renamedTo: old.renamedTo }),
      ...(old?.userOrder === undefined ? {} : { userOrder: old.userOrder }),
      ...(old?.userDisplayName === undefined ? {} : { userDisplayName: old.userDisplayName }),
      ...(old?.hidden === undefined ? {} : { hidden: old.hidden }),
      // @anchor seat-preserve
      ...(old?.preset === undefined ? {} : { preset: old.preset }),
    }
    if (old === undefined) {
      next.set(card.name, { key: card.name, value: generated, change: 'added' })
      events.push({ at, kind: 'seat-added', detail: `${card.name} (${card.displayName})` })
    } else if (!same(old, generated)) {
      next.set(card.name, { key: card.name, value: generated, change: 'updated' })
    }
  }

  for (const [skill, old] of existing) {
    if (snapshot.cards.has(skill)) continue
    if (old.status === 'undeployed') continue
    const value: SeatRecord = { ...old, status: 'undeployed' }
    next.set(skill, { key: skill, value, change: 'undeployed' })
    events.push({ at, kind: 'seat-removed', detail: `${skill} (${old.displayName})` })
  }

  for (const rename of renames) {
    if (snapshot.cards.has(rename.to) === false || snapshot.cards.has(rename.from)) continue
    const from = next.get(rename.from)?.value ?? existing.get(rename.from)
    const to = next.get(rename.to)?.value ?? existing.get(rename.to)
    if (from === undefined || to === undefined) continue
    const oldValue: SeatRecord = { ...from, status: 'undeployed', renamedTo: rename.to }
    const newValue: SeatRecord = { ...to, renamedFrom: rename.from }
    next.set(rename.from, { key: rename.from, value: oldValue, change: 'renamed' })
    next.set(rename.to, { key: rename.to, value: newValue, change: 'renamed' })
    events.push({
      at,
      kind: 'seat-renamed',
      detail: `${rename.from} → ${rename.to}${rename.similarity === undefined ? '' : ` (${rename.similarity.toFixed(3)})`}`,
    })
  }

  const status = snapshot.level === 'L0' ? 'ok' : snapshot.level === 'L3' ? 'missing' : 'degraded'
  const suiteKind = snapshot.fingerprint?.git === undefined
    ? snapshot.fingerprint === undefined ? 'none' : 'digest'
    : 'git'
  const degradedReasons = status === 'ok'
    ? []
    : unique(snapshot.diagnostics
        .filter(diagnostic => diagnostic.severity !== 'info')
        .map(diagnostic => `${diagnostic.code}: ${diagnostic.detail}`))
  const global: AmphoreusGlobal = {
    ...currentGlobal,
    dataVersion: 1,
    seeded: currentGlobal.seeded || snapshot.cards.size > 0,
    suite: {
      kind: suiteKind,
      parsedAt: snapshot.parsedAt,
      status,
      degradedReasons,
      ...(snapshot.fingerprint === undefined ? {} : { revision: snapshot.fingerprint.label }),
      ...(snapshot.root === undefined ? {} : { rootPath: snapshot.root.canonical }),
    },
  }
  events.unshift({
    at,
    kind: status === 'ok' ? 'parsed' : status === 'degraded' ? 'degraded' : 'missing',
    detail: `generation=${snapshot.generation}; level=${snapshot.level}; cards=${snapshot.cards.size}`,
  })
  return {
    puts: [...next.values()].sort((left, right) => left.key.localeCompare(right.key, 'en')),
    global,
    globalChanged: !same(currentGlobal, global),
    events,
  }
}

export async function reconcileSeats(
  domain: AmphoreusDomain,
  snapshot: SuiteSnapshot,
  at = Date.now(),
  renames: readonly RenameHint[] = [],
): Promise<SeatReconcileResult> {
  const seats = domain.table('seats')
  const plan = planSeatReconciliation(snapshot, [...seats.entries()], domain.global.get(), at, renames)
  const counts = { added: 0, updated: 0, undeployed: 0, renamed: 0 }
  for (const put of plan.puts) {
    await seats.put(put.key, put.value)
    counts[put.change]++
  }
  if (plan.globalChanged) {
    await updateAmphoreusGlobal(domain, current => ({
      ...current,
      dataVersion: plan.global.dataVersion,
      seeded: current.seeded || plan.global.seeded,
      suite: plan.global.suite,
    }))
  }
  const events = domain.table('suite_events')
  let sequence = 0
  for (const event of plan.events) {
    let key = `${event.at}`
    while (events.get(key) !== undefined) key = `${event.at}:${++sequence}`
    await events.put(key, event)
  }
  return { ...counts, events: plan.events.length }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
