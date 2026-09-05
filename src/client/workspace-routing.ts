const WINDOWS_DRIVE_PATH = /^[a-z]:[\\/]/iu
const WINDOWS_UNC_PATH = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/u

function windowsPath(value: string): boolean {
  return WINDOWS_DRIVE_PATH.test(value) || WINDOWS_UNC_PATH.test(value)
}

export function workspacePathKey(value: string): string {
  const windows = windowsPath(value)
  const slashed = windows ? value.replace(/\\/gu, '/') : value
  const trimmed = slashed.length > 1 ? slashed.replace(/\/+$/u, '') : slashed
  return windows ? trimmed.toLowerCase() : trimmed
}

export function sameWorkspacePath(left: string, right: string): boolean {
  return workspacePathKey(left) === workspacePathKey(right)
}

export function withoutSeatWorkspaces<T extends { readonly path: string }>(
  workspaces: readonly T[],
  seatDirectories: readonly string[],
): T[] {
  const seatPaths = new Set(seatDirectories.map(workspacePathKey))
  return workspaces.filter(workspace => !seatPaths.has(workspacePathKey(workspace.path)))
}

export function currentOrdinaryWorkspace<T extends {
  readonly path: string
  readonly sessionIds: readonly string[]
}>(
  workspaces: readonly T[],
  seatDirectories: readonly string[],
  currentSessionId: string | undefined,
): T | undefined {
  if (currentSessionId === undefined) return undefined
  return withoutSeatWorkspaces(workspaces, seatDirectories)
    .find(workspace => workspace.sessionIds.includes(currentSessionId))
}

interface SnapshotSource<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

interface ReadySnapshot {
  readonly phase: 'pending' | 'loading' | 'ready' | 'error'
  readonly state?: unknown
  readonly error?: unknown
}

export function waitForReadySnapshot<T extends ReadySnapshot>(
  source: SnapshotSource<T>,
  label: string,
  timeoutMs = 15_000,
  matches: (snapshot: T) => boolean = () => true,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let dispose = (): void => {}
    let settled = false
    const timer = setTimeout(() => finish(undefined, new Error(`${label} 初始化超时，请重试`)), timeoutMs)
    const finish = (snapshot: T | undefined, error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      dispose()
      if (error !== undefined) reject(error)
      else resolve(snapshot!)
    }
    const check = (): void => {
      const snapshot = source.getSnapshot()
      if (snapshot.phase === 'error' || snapshot.state === 'error') {
        const detail = typeof snapshot.error === 'object' && snapshot.error !== null && 'message' in snapshot.error
          ? String(snapshot.error.message) : String(snapshot.error ?? '')
        finish(undefined, new Error(`${label} 初始化失败${detail ? `：${detail}` : ''}`))
      } else if (snapshot.phase === 'ready' && snapshot.state !== 'loading' && matches(snapshot)) finish(snapshot)
    }
    dispose = source.subscribe(check)
    if (settled) dispose()
    else check()
  })
}

export function workspaceOfSession<T extends { readonly sessionIds: readonly string[] }>(
  workspaces: readonly T[],
  sessionId: string,
): T | undefined {
  return workspaces.find(workspace => workspace.sessionIds.includes(sessionId))
}

export function orphanSeatWorkspacePath(
  workspaces: readonly { readonly sessionIds: readonly string[] }[],
  sessionId: string,
  cwd: string | undefined,
  seatDir: string | undefined,
): string | undefined {
  if (workspaceOfSession(workspaces, sessionId) !== undefined) return undefined
  return cwd !== undefined && seatDir !== undefined && sameWorkspacePath(cwd, seatDir)
    ? seatDir : undefined
}

interface WorkspaceMembership {
  readonly workspaceId: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

export async function syncWorkspaceSession(
  workspaces: {
    readonly list: SnapshotSource<ReadySnapshot & { readonly items: readonly WorkspaceMembership[] }>
    create(input: { path: string }): Promise<WorkspaceMembership>
  },
  workspaceId: string,
  sessionId: string,
  timeoutMs = 15_000,
): Promise<void> {
  const snapshot = await waitForReadySnapshot(workspaces.list, '工作区')
  const workspace = snapshot.items.find(item => item.workspaceId === workspaceId)
  if (workspace === undefined) throw new Error('会话所属工作区已移除，请重新进入席位')
  if (workspace.sessionIds.includes(sessionId)) return
  const refreshed = await workspaces.create({ path: workspace.path })
  if (refreshed.workspaceId !== workspaceId) {
    throw new Error('会话工作区关联尚未完成，请重新进入席位')
  }
  await waitForReadySnapshot(workspaces.list, '会话工作区关联', timeoutMs, snapshot =>
    snapshot.items.some(item => item.workspaceId === workspaceId && item.sessionIds.includes(sessionId)))
}
