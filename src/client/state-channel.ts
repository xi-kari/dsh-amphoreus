export interface StateChannel {
  start(): Promise<void>
  close(): void
}

export function openStateChannel(model: StateChannel, onError: (error: unknown) => void): () => void {
  let disposed = false
  void model.start().catch(error => { if (!disposed) onError(error) })
  return () => {
    if (disposed) return
    disposed = true
    model.close()
  }
}
