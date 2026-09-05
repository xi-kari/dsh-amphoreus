/**
 * Window-level Alt+digit seat switching. Plain function with injected
 * closures (no ctx, no React) so `node --test` can drive it with a fake
 * window. Alt is the chord because Ctrl+digit is browser-reserved for tab
 * switching and cannot be intercepted by page script.
 */
import type { SeatView } from './seat-model.ts'
import { seatForDigit } from './seat-switch.ts'

/** The subset of KeyboardEvent the installer reads (tests hand in plain objects). */
export interface SeatHotkeyEvent {
  readonly key: string
  readonly code?: string
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly isComposing?: boolean
  readonly repeat?: boolean
  readonly defaultPrevented?: boolean
  readonly target: unknown
  preventDefault(): void
}

export interface SeatHotkeyWindow {
  addEventListener(type: 'keydown', listener: (event: SeatHotkeyEvent) => void): void
  removeEventListener(type: 'keydown', listener: (event: SeatHotkeyEvent) => void): void
}

export interface SeatHotkeyDeps {
  readonly target: SeatHotkeyWindow
  /** Hotkey seats in digit order (index 0 = Alt+1). */
  readonly seats: () => readonly SeatView[]
  readonly enter: (view: SeatView) => Promise<void>
  /** Alt+0. */
  readonly togglePortal: () => void
  /** Extra busy predicate (e.g. the sidebar's own in-flight set); the installer also tracks its own starts. */
  readonly isBusy?: (skillName: string) => boolean
  readonly onError?: (error: unknown) => void
}

const EDITABLE_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** Whether the event target would consume plain keystrokes (composer, inputs, contenteditable). */
export function isEditableTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false
  const element = target as { tagName?: unknown; isContentEditable?: unknown }
  if (element.isContentEditable === true) return true
  return typeof element.tagName === 'string' && EDITABLE_TAGS.has(element.tagName.toUpperCase())
}

/** Digit 0-9 carried by the event (layout-independent `code` first, `key` as fallback), or undefined. */
export function digitOf(event: Pick<SeatHotkeyEvent, 'key' | 'code'>): number | undefined {
  const fromCode = event.code === undefined ? null : /^(?:Digit|Numpad)(\d)$/u.exec(event.code)
  if (fromCode !== null) return Number(fromCode[1])
  return /^\d$/u.test(event.key) ? Number(event.key) : undefined
}

/** Alt alone (no Ctrl/Meta/Shift) + digit → the digit; anything else → undefined. */
export function chordDigit(event: SeatHotkeyEvent): number | undefined {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return undefined
  return digitOf(event)
}

export function installSeatHotkeys(deps: SeatHotkeyDeps): () => void {
  const inflight = new Set<string>()
  const listener = (event: SeatHotkeyEvent): void => {
    if (event.isComposing === true || event.repeat === true || event.defaultPrevented === true) return
    if (isEditableTarget(event.target) && !event.altKey) return
    const digit = chordDigit(event)
    if (digit === undefined) return
    if (digit === 0) {
      event.preventDefault()
      deps.togglePortal()
      return
    }
    const view = seatForDigit(deps.seats(), digit)
    if (view === undefined) return
    event.preventDefault()
    if (inflight.has(view.skillName) || deps.isBusy?.(view.skillName) === true) return
    inflight.add(view.skillName)
    void Promise.resolve()
      .then(() => deps.enter(view))
      .catch(error => { deps.onError?.(error) })
      .finally(() => { inflight.delete(view.skillName) })
  }
  deps.target.addEventListener('keydown', listener)
  return () => { deps.target.removeEventListener('keydown', listener) }
}
