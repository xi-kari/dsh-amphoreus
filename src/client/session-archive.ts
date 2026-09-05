export interface SessionArchiveDeps {
  readonly archive: (sessionId: string) => Promise<void>
  readonly current: () => string | undefined
  readonly clear: () => void
}

export function assertSessionUnarchived(sessionId: string, archivedIds: readonly string[]): void {
  if (archivedIds.includes(sessionId)) throw new Error('会话已归档，请新建会话继续')
}

export function createSessionArchiveAction(deps: SessionArchiveDeps): (sessionId: string) => Promise<void> {
  const pending = new Map<string, Promise<void>>()
  return sessionId => {
    const existing = pending.get(sessionId)
    if (existing !== undefined) return existing
    const attempt = Promise.resolve().then(async () => {
      await deps.archive(sessionId)
      if (deps.current() === sessionId) deps.clear()
    }).finally(() => { pending.delete(sessionId) })
    pending.set(sessionId, attempt)
    return attempt
  }
}
