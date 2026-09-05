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
  /** While true (a modal overlay such as the setup wizard is open) every chord is ignored and left to the page. */
  readonly isSuspended?: () => boolean
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

/**
 * Top-row digit 0-9 carried by the event (layout-independent `code` first, `key` as fallback), or undefined.
 * Numpad codes are deliberately NOT accepted: on Windows, Alt + numpad digits is the OS Alt-code character
 * entry, which accumulates regardless of preventDefault and would both switch seats and insert a glyph.
 */
export function digitOf(event: Pick<SeatHotkeyEvent, 'key' | 'code'>): number | undefined {
  if (event.code !== undefined && event.code !== '') {
    // A physical code is authoritative: Numpad*, KeyA, … never count, even when `key` happens to be a digit.
    const fromCode = /^Digit(\d)$/u.exec(event.code)
    return fromCode === null ? undefined : Number(fromCode[1])
  }
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
    if (deps.isSuspended?.() === true) return
    if (isEditableTarget(event.target)) {
      // Plain digits are text; Alt+digit that yields a glyph (macOS Option+1 → '¡') is text input too.
      if (!event.altKey || !/^\d$/u.test(event.key)) return
    }
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
