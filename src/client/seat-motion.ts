import type { SeatWatch } from './seat-watch.ts'

const installations = new WeakMap<Document, () => void>()

export interface SeatMotionOptions {
  readonly document?: Document
  readonly window?: Window
  readonly enabled?: () => boolean
  readonly subscribe?: (listener: () => void) => () => void
}

export function installSeatMotion(seat: Pick<SeatWatch, 'getSnapshot' | 'subscribe'>, options: SeatMotionOptions = {}): () => void {
  const doc = options.document ?? document
  const view = options.window ?? window
  installations.get(doc)?.()
  const root = doc.documentElement
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)')
  let current = seat.getSnapshot()
  let timer: number | undefined
  let alternate = false
  let revision = 0
  let disposed = false
  const clear = (): void => {
    revision++
    if (timer !== undefined) view.clearTimeout(timer)
    timer = undefined
    delete root.dataset.amphChanging
  }
  const enabled = (): boolean => options.enabled?.() !== false && !reduced.matches && doc.visibilityState !== 'hidden'
  const reconcile = (): void => {
    if (disposed) return
    root.dataset.amphMotion = enabled() ? 'on' : 'off'
    if (!enabled()) clear()
  }
  const changed = (): void => {
    if (disposed) return
    const next = seat.getSnapshot()
    if (next === current) return
    current = next
    clear()
    reconcile()
    if (!enabled()) return
    alternate = !alternate
    root.dataset.amphChanging = alternate ? 'a' : 'b'
    const ownRevision = revision
    timer = view.setTimeout(() => { if (!disposed && ownRevision === revision) clear() }, 280)
  }
  const unsubscribeSeat = seat.subscribe(changed)
  const unsubscribePrefs = options.subscribe?.(reconcile)
  reduced.addEventListener('change', reconcile)
  doc.addEventListener('visibilitychange', reconcile)
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    clear()
    unsubscribeSeat()
    unsubscribePrefs?.()
    reduced.removeEventListener('change', reconcile)
    doc.removeEventListener('visibilitychange', reconcile)
    delete root.dataset.amphMotion
    if (installations.get(doc) === dispose) installations.delete(doc)
  }
  installations.set(doc, dispose)
  reconcile()
  return dispose
}
