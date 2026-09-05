/**
 * Pure helpers behind the seat-switch surfaces (Alt+digit hotkeys and the
 * `/seat <name>` composer command). No DOM, no ctx — unit-tested directly.
 */
import type { PublicCard } from '../shared/api.ts'
import type { SeatView } from './seat-model.ts'

/** Words that address the δ-me13 portal instead of one seat. */
const PORTAL_WORDS: ReadonlySet<string> = new Set(['all', 'portal', '全体', '总览', '全体会议'])

/** Skill-name prefix shared by every suite seat; `/seat anaxa` should hit `amphoreus-anaxa`. */
const SKILL_PREFIX = /^amphoreus-/u

export type SeatSwitchTarget =
  | { readonly kind: 'seat'; readonly view: SeatView }
  | { readonly kind: 'portal' }

/**
 * Seats reachable by Alt+1..9, in sidebar order. `seatViewsFrom` already
 * sorts by `userOrder ?? order` then skillName, so a plain filter keeps the
 * digit mapping identical to what the user sees in the sidebar.
 */
export function orderedHotkeySeats(views: readonly SeatView[]): SeatView[] {
  return views.filter(view => view.deployed && !view.hidden)
}

/** Digit key (1-9) → seat; 0 is reserved for the portal toggle. */
export function seatForDigit(seats: readonly SeatView[], digit: number): SeatView | undefined {
  if (!Number.isInteger(digit) || digit < 1 || digit > 9) return undefined
  return seats[digit - 1]
}

function namesOf(view: SeatView, card: PublicCard | undefined): string[] {
  const names = [view.displayName, view.skillName, view.skillName.replace(SKILL_PREFIX, '')]
  if (view.heroId !== null) names.push(view.heroId)
  if (card !== undefined) names.push(card.displayName, ...card.aliases)
  return names.map(name => name.trim()).filter(name => name !== '')
}

/**
 * Resolve a typed name to a seat (or the portal). Exact match wins over a
 * case-insensitive match; both scan displayName, skillName (with and without
 * the `amphoreus-` prefix), heroId, and the suite card's displayName + aliases.
 * Only deployed seats are addressable — an undeployed seat has no directory
 * to start a session in.
 */
export function resolveSeatByName(
  query: string,
  views: readonly SeatView[],
  cards: readonly PublicCard[],
): SeatSwitchTarget | undefined {
  const wanted = query.trim()
  if (wanted === '') return undefined
  if (PORTAL_WORDS.has(wanted.toLowerCase())) return { kind: 'portal' }
  const cardsBySkill = new Map(cards.map(card => [card.name, card]))
  const candidates = views
    .filter(view => view.deployed)
    .map(view => ({ view, names: namesOf(view, cardsBySkill.get(view.skillName)) }))
  const exact = candidates.find(candidate => candidate.names.includes(wanted))
  if (exact !== undefined) return { kind: 'seat', view: exact.view }
  const folded = wanted.toLowerCase()
  const loose = candidates.find(candidate => candidate.names.some(name => name.toLowerCase() === folded))
  return loose === undefined ? undefined : { kind: 'seat', view: loose.view }
}

/** `/seat`, `/seat  anaxa ` → `{ name }` (name trimmed, '' for the bare token); anything else → undefined. */
export function parseSeatLine(line: string): { readonly name: string } | undefined {
  const match = /^\s*\/seat(?:\s+(.*))?\s*$/su.exec(line)
  if (match === null) return undefined
  return { name: (match[1] ?? '').trim() }
}

/** Sidebar/menu affordance text: "Alt+3" for the third hotkey seat, undefined past the ninth. */
export function hotkeyLabel(index: number): string | undefined {
  return index >= 0 && index < 9 ? `Alt+${index + 1}` : undefined
}
