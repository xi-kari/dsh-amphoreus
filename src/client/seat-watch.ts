/**
 * Tiny external store mirroring `body[data-amphoreus-seat]` — the single
 * source of truth the seat layer writes when a seat's visuals are applied.
 * Slot components and DOM garnish subscribe here instead of re-deriving the
 * seat from bindings, so every surface flips on the same frame.
 */
export interface SeatWatch {
  readonly getSnapshot: () => string | null
  readonly subscribe: (listener: () => void) => () => void
  readonly dispose: () => void
}

export function createSeatWatch(body: HTMLElement = document.body): SeatWatch {
  const listeners = new Set<() => void>()
  let current: string | null = body.dataset.amphoreusSeat ?? null
  const observer = new MutationObserver(() => {
    const next = body.dataset.amphoreusSeat ?? null
    if (next === current) return
    current = next
    for (const listener of [...listeners]) listener()
  })
  observer.observe(body, { attributes: true, attributeFilter: ['data-amphoreus-seat'] })
  return {
    getSnapshot: () => current,
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose: () => {
      observer.disconnect()
      listeners.clear()
    },
  }
}
