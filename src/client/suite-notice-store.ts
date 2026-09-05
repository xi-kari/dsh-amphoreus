/**
 * Suite-update awareness derived from the single AmphoreusClientModel channel.
 * Pure store: no DOM, no fetch, no second EventSource. The host already
 * re-parses live and pushes SSE 'snapshot'; the model refetches state. This
 * store compares consecutive published states and emits one notice per
 * genuine change (manifest sha or level). A forced reparse with identical
 * content bumps generation only and is deliberately silent.
 */
import type { AmphoreusBoot, AmphoreusState } from '../shared/api.ts'
import type { SuiteLevel } from '../host/suite/types.ts'
import type { AmphoreusClientSnapshot } from './state.ts'

export type SuiteNoticeKind = 'updated' | 'degraded' | 'missing' | 'recovered'

export interface SuiteNotice {
  readonly id: string
  readonly kind: SuiteNoticeKind
  readonly label: string
  readonly generation: number
  readonly level: SuiteLevel
  readonly diagnosticsCount: number
  readonly at: number
  /** Bindings whose card was injected before this parse: they keep the old card until /clear, resume or a new session. */
  readonly staleSessions: number
}

export interface SuiteNoticeSnapshot {
  /** Every emitted notice, newest first (capped). */
  readonly notices: readonly SuiteNotice[]
  /** The newest notice unless dismissed; the banner renders exactly this. */
  readonly active: SuiteNotice | undefined
  /** True when the suite root was missing at process startup: no watcher exists, so recovery needs a restart. */
  readonly startedMissing: boolean
}

export interface SuiteNoticeStore {
  readonly getSnapshot: () => SuiteNoticeSnapshot
  readonly subscribe: (listener: () => void) => () => void
  readonly dismiss: (id: string) => void
  readonly dispose: () => void
}

export interface SuiteNoticeModel {
  readonly getSnapshot: () => AmphoreusClientSnapshot
  readonly subscribe: (listener: () => void) => () => void
}

export type SuiteNoticeStorage = Pick<Storage, 'getItem' | 'setItem'>

export interface SuiteNoticeOptions {
  readonly model: SuiteNoticeModel
  readonly boot?: Pick<AmphoreusBoot, 'revision' | 'level'> | undefined
  readonly storage?: SuiteNoticeStorage | undefined
  readonly now?: () => number
}

export const SUITE_NOTICE_STORAGE_KEY = 'dsh-amphoreus:suite-notice'
const MAX_NOTICES = 8
const MAX_DISMISSED = 32

interface Baseline {
  readonly sha: string | undefined
  readonly level: SuiteLevel
}

export function suiteNoticeId(level: SuiteLevel, sha: string | undefined): string {
  return `${level}:${sha ?? 'none'}`
}

export function classifySuiteChange(previous: SuiteLevel, next: SuiteLevel): SuiteNoticeKind {
  if (next === 'L3') return 'missing'
  if (next === 'L1' || next === 'L2') return 'degraded'
  return previous === 'L0' ? 'updated' : 'recovered'
}

export function countStaleSessions(state: AmphoreusState): number {
  const parsedAt = state.suite?.parsedAt
  if (parsedAt === undefined) return 0
  return state.bindings.filter(binding => binding.injection.state === 'done' && binding.boundAt < parsedAt).length
}

/** sessionStorage access can throw (sandboxed frames, disabled storage); degrade to no persistence. */
export function safeSessionStorage(): SuiteNoticeStorage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

function readDismissed(storage: SuiteNoticeStorage | undefined): Set<string> {
  if (storage === undefined) return new Set()
  try {
    const raw = storage.getItem(SUITE_NOTICE_STORAGE_KEY)
    if (raw === null) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((item): item is string => typeof item === 'string'))
  } catch {
    return new Set()
  }
}

function writeDismissed(storage: SuiteNoticeStorage | undefined, dismissed: ReadonlySet<string>): void {
  if (storage === undefined) return
  try {
    storage.setItem(SUITE_NOTICE_STORAGE_KEY, JSON.stringify([...dismissed].slice(-MAX_DISMISSED)))
  } catch {
    // storage full or unavailable: the in-memory set still hides the notice for this page
  }
}

export function createSuiteNoticeStore(options: SuiteNoticeOptions): SuiteNoticeStore {
  const { model, boot, storage } = options
  const now = options.now ?? (() => Date.now())
  const listeners = new Set<() => void>()
  const dismissed = readDismissed(storage)
  const startedMissing = boot?.level === 'L3'
  let baseline: Baseline | undefined
  let notices: readonly SuiteNotice[] = []
  let snapshot: SuiteNoticeSnapshot = { notices, active: undefined, startedMissing }
  let disposed = false

  const publish = (): void => {
    const newest = notices[0]
    snapshot = {
      notices,
      active: newest !== undefined && !dismissed.has(newest.id) ? newest : undefined,
      startedMissing,
    }
    for (const listener of listeners) listener()
  }

  const emit = (state: AmphoreusState, kind: SuiteNoticeKind, level: SuiteLevel, sha: string | undefined): void => {
    const notice: SuiteNotice = {
      id: suiteNoticeId(level, sha),
      kind,
      label: state.suite?.fingerprint?.label ?? '',
      generation: state.suite?.generation ?? state.revision,
      level,
      diagnosticsCount: state.suite?.diagnostics.length ?? 0,
      at: state.suite?.parsedAt ?? now(),
      staleSessions: countStaleSessions(state),
    }
    notices = [notice, ...notices.filter(item => item.id !== notice.id)].slice(0, MAX_NOTICES)
    publish()
  }

  const inspect = (): void => {
    if (disposed) return
    const current = model.getSnapshot()
    if (current.phase !== 'ready' || current.state === undefined) return
    const state = current.state
    const level: SuiteLevel = state.suite?.level ?? 'L3'
    const sha = state.suite?.fingerprint?.manifestSha256
    if (baseline === undefined) {
      // The first ready state is the reference. Boot contributes only its
      // level: a level that moved between first paint and first fetch is real.
      const bootLevel = boot?.level
      baseline = { sha, level }
      if (bootLevel !== undefined && bootLevel !== 'loading' && bootLevel !== level) {
        emit(state, classifySuiteChange(bootLevel, level), level, sha)
      }
      return
    }
    if (baseline.sha === sha && baseline.level === level) return
    const kind = classifySuiteChange(baseline.level, level)
    baseline = { sha, level }
    emit(state, kind, level, sha)
  }

  const unsubscribe = model.subscribe(inspect)
  inspect()

  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dismiss: id => {
      if (dismissed.has(id)) return
      dismissed.add(id)
      writeDismissed(storage, dismissed)
      publish()
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      unsubscribe()
      listeners.clear()
    },
  }
}
