import { realpath } from 'node:fs/promises'
import type { SeatDirRecord } from './seatdirs.ts'

export const WORKSPACE_VISIBILITY_OWNER = 'dsh-amphoreus'

export interface SeatWorkspaceRegistry {
  list(): readonly { readonly id: string; readonly path: string }[]
  setHiddenByOwner?(owner: string, workspaceIds: readonly string[]): Promise<void>
}

export function requireWorkspaceRegistry(value: unknown): SeatWorkspaceRegistry {
  const registry = value as Partial<SeatWorkspaceRegistry> | undefined
  if (typeof registry?.list !== 'function') {
    throw new Error('dsh-amphoreus requires DSH workspaceRegistry.list.')
  }
  return registry as SeatWorkspaceRegistry
}

export async function activateSeatWorkspaces(registry: SeatWorkspaceRegistry, seats: readonly SeatDirRecord[]): Promise<() => Promise<void>> {
  const setHiddenByOwner = registry.setHiddenByOwner
  if (typeof setHiddenByOwner !== 'function') return async () => {}
  const paths = new Set(await Promise.all(seats.map(seat => realpath(seat.dir))))
  await setHiddenByOwner.call(registry, WORKSPACE_VISIBILITY_OWNER, [])
  return async () => {
    const ids = registry.list().filter(workspace => paths.has(workspace.path)).map(workspace => workspace.id)
    await setHiddenByOwner.call(registry, WORKSPACE_VISIBILITY_OWNER, ids)
  }
}
