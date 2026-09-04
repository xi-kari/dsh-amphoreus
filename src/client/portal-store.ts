export interface PortalSnapshot {
  readonly open: boolean
}

export interface PortalStore {
  readonly getSnapshot: () => PortalSnapshot
  readonly subscribe: (listener: () => void) => () => void
  readonly open: () => void
  readonly close: () => void
  readonly toggle: () => void
}

const CLOSED: PortalSnapshot = { open: false }

export function createPortalStore(): PortalStore {
  const listeners = new Set<() => void>()
  let snapshot = CLOSED

  const setOpen = (open: boolean): void => {
    if (snapshot.open === open) return
    snapshot = { open }
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!snapshot.open),
  }
}
