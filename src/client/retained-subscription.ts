import type { SessionLease } from './session-reference.ts'

export function subscribeRetainedSession<T>(
  retain: () => SessionLease<T>,
  connect: (binding: T) => () => void,
  onError: (error: unknown) => void,
): () => void {
  let lease: SessionLease<T>
  try {
    lease = retain()
  } catch (error) {
    onError(error)
    return () => {}
  }

  let disposed = false
  let detach: (() => void) | undefined
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    const errors: unknown[] = []
    try {
      detach?.()
    } catch (error) {
      errors.push(error)
    }
    detach = undefined
    try {
      lease.release()
    } catch (error) {
      errors.push(error)
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, 'Session subscription cleanup failed')
  }

  void lease.ready.then(binding => {
    if (disposed) return
    const disconnect = connect(binding)
    if (disposed) disconnect()
    else detach = disconnect
  }).catch(error => {
    if (disposed) return
    try {
      dispose()
    } catch (cleanupError) {
      onError(new AggregateError([error, cleanupError], 'Session subscription and cleanup failed'))
      return
    }
    onError(error)
  })

  return dispose
}
