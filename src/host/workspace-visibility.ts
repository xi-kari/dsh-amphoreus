import { realpath } from 'node:fs/promises'
import type { SeatDirRecord } from './seatdirs.ts'

export const WORKSPACE_VISIBILITY_OWNER = 'dsh-amphoreus'

export interface SeatWorkspaceRegistry {
  list(): readonly { readonly id: string; readonly path: string }[]
  setHiddenByOwner(owner: string, workspaceIds: readonly string[]): Promise<void>
}

export function requireWorkspaceVisibility(value: unknown): SeatWorkspaceRegistry {
  const registry = value as Partial<SeatWorkspaceRegistry> | undefined
  if (typeof registry?.list !== 'function' || typeof registry.setHiddenByOwner !== 'function') {
    throw new Error('dsh-amphoreus requires DSH workspaceRegistry.setHiddenByOwner and workspace visibility support. Stock dsh-v0.2.1-rc.2 does not provide this capability; use the matching dsh-amphoreus host kit or rebuild DSH with the included compatibility patch. Installing the plugin alone does not upgrade the host.')
  }
  return registry as SeatWorkspaceRegistry
}

export async function activateSeatWorkspaces(registry: SeatWorkspaceRegistry, seats: readonly SeatDirRecord[]): Promise<() => Promise<void>> {
  const paths = new Set(await Promise.all(seats.map(seat => realpath(seat.dir))))
  await registry.setHiddenByOwner(WORKSPACE_VISIBILITY_OWNER, [])
  return async () => {
    const ids = registry.list().filter(workspace => paths.has(workspace.path)).map(workspace => workspace.id)
    await registry.setHiddenByOwner(WORKSPACE_VISIBILITY_OWNER, ids)
  }
}
