export interface EnterSeatRequest {
  readonly workspaceId: 'all' | `seat:${string}`
  readonly dispatchText?: string
}

export interface EnterSeatQueue {
  readonly set: (request: EnterSeatRequest) => void
  readonly take: () => EnterSeatRequest | undefined
  readonly subscribe: (listener: () => void) => () => void
}

export function createEnterSeatQueue(): EnterSeatQueue {
  const listeners = new Set<() => void>()
  let pending: EnterSeatRequest | undefined
  return {
    set: request => {
      pending = { ...request }
      for (const listener of listeners) listener()
    },
    take: () => {
      const request = pending
      pending = undefined
      return request
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
