/**
 * Shared in-flight guard for seat session starts. A start is "busy" from the
 * moment it is issued until the model snapshot actually shows a bound session
 * for that skill (or a timeout elapses) — the SSE-driven `model.refresh()`
 * lands *after* `startSeatSession` resolves, so a plain in-flight set would
 * release too early and a second press would create a second session.
 * Pure (no ctx, no DOM) so `node --test` can drive it with a fake clock.
 */
export interface SeatStartGuardDeps {
  /** Whether the current snapshot already shows a session for the skill. */
  readonly hasSession: (skillName: string) => boolean
  /** How long to stay busy after a start resolves while waiting for the snapshot (default 4000 ms). */
  readonly settleMs?: number
  readonly now?: () => number
}

export interface SeatStartGuard {
  /** True while a start for the skill is in flight or not yet visible in the snapshot. */
  isBusy(skillName: string): boolean
  /** Run `start` unless busy; returns false (without calling it) when the skill is busy. */
  run(skillName: string, start: () => Promise<void>): Promise<boolean>
}

export function createSeatStartGuard(deps: SeatStartGuardDeps): SeatStartGuard {
  const now = deps.now ?? (() => Date.now())
  const settleMs = deps.settleMs ?? 4000
  const inflight = new Set<string>()
  const settling = new Map<string, number>()
  const isBusy = (skillName: string): boolean => {
    if (inflight.has(skillName)) return true
    const expiry = settling.get(skillName)
    if (expiry === undefined) return false
    if (deps.hasSession(skillName) || now() >= expiry) {
      settling.delete(skillName)
      return false
    }
    return true
  }
  return {
    isBusy,
    async run(skillName, start) {
      if (isBusy(skillName)) return false
      inflight.add(skillName)
      try {
        await start()
        settling.set(skillName, now() + settleMs)
      } finally {
        inflight.delete(skillName)
      }
      return true
    },
  }
}
