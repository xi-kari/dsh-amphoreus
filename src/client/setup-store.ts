/**
 * First-run setup wizard: external store (open / step) plus the pure helpers that
 * decide when the wizard offers itself and how the folder chooser degrades
 * (native picker → in-app directory browser → manual path entry).
 */
import type { AssetsCheckReport } from '../shared/api.ts'
import type { AmphoreusClientSnapshot } from './state.ts'

export type SetupStep = 'root' | 'check' | 'derive'

export interface SetupSnapshot {
  readonly open: boolean
  readonly step: SetupStep
  /** True once the wizard auto-offered itself (or was closed) in this page; it never auto-opens again. */
  readonly offered: boolean
}

export interface SetupStore {
  readonly getSnapshot: () => SetupSnapshot
  readonly subscribe: (listener: () => void) => () => void
  /** Open explicitly (settings button); always allowed, restarts at the given step. */
  readonly open: (step?: SetupStep) => void
  /** Auto-open at most once per page; returns whether it opened. */
  readonly offer: () => boolean
  readonly close: () => void
  readonly setStep: (step: SetupStep) => void
}

const INITIAL: SetupSnapshot = { open: false, step: 'root', offered: false }

export function createSetupStore(): SetupStore {
  const listeners = new Set<() => void>()
  let snapshot = INITIAL

  const publish = (next: SetupSnapshot): void => {
    if (next.open === snapshot.open && next.step === snapshot.step && next.offered === snapshot.offered) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    open: (step = 'root') => publish({ open: true, step, offered: true }),
    offer: () => {
      if (snapshot.offered || snapshot.open) return false
      publish({ open: true, step: 'root', offered: true })
      return true
    },
    close: () => {
      if (!snapshot.open) return
      publish({ ...snapshot, open: false, offered: true })
    },
    setStep: step => publish({ ...snapshot, step }),
  }
}

const STORES = new WeakMap<object, SetupStore>()

/** Bind a setup store to its model so consumers that only receive the model (settings) can reopen the wizard. */
export function bindSetupStore(model: object, store: SetupStore): void {
  STORES.set(model, store)
}

export function setupStoreOf(model: object): SetupStore | undefined {
  return STORES.get(model)
}

/** The wizard offers itself only on a ready state that still needs setup and was never dismissed. */
export function shouldOfferSetup(snapshot: AmphoreusClientSnapshot): boolean {
  if (snapshot.phase !== 'ready' || snapshot.state === undefined) return false
  const state = snapshot.state
  return state.effectiveConfig.setupNeeded === true && state.prefs.setupDismissedAt === undefined
}

/** Subscribe the store to the model: auto-open once when the gate first passes. Returns the disposer. */
export function watchSetupAutoOpen(
  model: { readonly getSnapshot: () => AmphoreusClientSnapshot; readonly subscribe: (listener: () => void) => () => void },
  store: SetupStore,
): () => void {
  const check = (): void => {
    if (shouldOfferSetup(model.getSnapshot())) store.offer()
  }
  check()
  return model.subscribe(check)
}

export interface DirectoryEntryLike {
  readonly name: string
  readonly path: string
  readonly hidden?: boolean
}

export interface DirectoryListingLike {
  readonly path: string
  readonly home?: string
  readonly crumbs: readonly DirectoryEntryLike[]
  readonly entries: readonly DirectoryEntryLike[]
  readonly truncated?: boolean
}

export interface FolderChooserDeps {
  readonly pickDirectory: () => Promise<string | null>
  readonly listDirectory: (path?: string) => Promise<DirectoryListingLike>
}

export type FolderChoice =
  | { readonly mode: 'native'; readonly path: string | null }
  | { readonly mode: 'browse'; readonly listing: DirectoryListingLike }
  | { readonly mode: 'manual'; readonly reason: string }

/**
 * Fallback chain of the folder step: exactly one directory capability is mounted per
 * deployment (native chooser on loopback desktops, browse primitives over LAN/SSH), so a
 * failing picker means "try the browser", and a failing browser means "type the path".
 */
export async function chooseFolder(deps: FolderChooserDeps, start?: string): Promise<FolderChoice> {
  let pickError: unknown
  try {
    return { mode: 'native', path: await deps.pickDirectory() }
  } catch (error) {
    pickError = error
  }
  try {
    return { mode: 'browse', listing: await deps.listDirectory(start === undefined || start.trim() === '' ? undefined : start) }
  } catch (error) {
    const reason = [pickError, error].map(value => value instanceof Error ? value.message : String(value)).join('; ')
    return { mode: 'manual', reason }
  }
}

export interface CheckDigest {
  readonly requiredOk: number
  readonly requiredTotal: number
  readonly optionalOk: number
  readonly optionalTotal: number
  readonly homePopulated: number
  readonly homeTotal: number
  readonly large: number
  readonly missingRequired: readonly string[]
  readonly complete: boolean
}

/** Compact view of a report for the wizard and the settings panel: counts plus the first missing required paths. */
export function digestCheck(report: AssetsCheckReport, limit = 5): CheckDigest {
  const missing = report.required.filter(item => item.status === 'missing').map(item => item.path)
  return {
    requiredOk: report.summary.requiredOk,
    requiredTotal: report.summary.requiredTotal,
    optionalOk: report.summary.optionalOk,
    optionalTotal: report.summary.optionalTotal,
    homePopulated: report.summary.homePopulated,
    homeTotal: report.summary.homeTotal,
    large: report.summary.large,
    missingRequired: missing.slice(0, Math.max(0, limit)),
    complete: report.ok,
  }
}
