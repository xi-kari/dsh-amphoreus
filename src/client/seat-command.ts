/**
 * `/seat <name>` as the plugin's OWN InputTriggerSource on the '/' trigger.
 * Client-side command contributions (ctx.commandUi) are bare-token popups
 * and cannot take an argument; a host command could not switch the browser's
 * current session. So this source parses the line itself and answers with a
 * {claim} whose submit enters the seat — the composer commits/clears the
 * draft on success and keeps it on an error outcome.
 */
import type {
  CandidateRequest,
  ClientSessionContext,
  InputTriggerCandidate,
  InputTriggerPick,
  InputTriggerSource,
  PickOutcome,
  SubmitOutcome,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { PublicCard } from '../shared/api.ts'
import type { AmphoreusKey } from './locales.ts'
import type { SeatView } from './seat-model.ts'
import { hotkeyLabel, orderedHotkeySeats, parseSeatLine, resolveSeatByName, type SeatSwitchTarget } from './seat-switch.ts'

export const SEAT_COMMAND_NAME = 'seat'
export const SEAT_COMMAND_TOKEN = `/${SEAT_COMMAND_NAME} `
const PORTAL_VALUE = 'all'

export interface SeatCommandDeps {
  readonly seats: () => readonly SeatView[]
  readonly cards: () => readonly PublicCard[]
  readonly enter: (view: SeatView) => Promise<void>
  readonly openPortal: () => void
  readonly t: (key: AmphoreusKey, params?: Record<string, unknown>) => string
}

/** Menu rows: one per deployed seat plus `seat all`; the value carries the exact resolvable name. */
export function seatCandidates(deps: SeatCommandDeps, query: string): InputTriggerCandidate[] {
  const folded = query.trim().toLowerCase()
  const argument = folded.startsWith(`${SEAT_COMMAND_NAME} `)
    ? folded.slice(SEAT_COMMAND_NAME.length + 1).trim()
    : undefined
  if (argument === undefined && folded !== '' && !SEAT_COMMAND_NAME.startsWith(folded)) return []
  const section = deps.t('seat.command.section')
  const rows: InputTriggerCandidate[] = orderedHotkeySeats(deps.seats()).map((view, index) => {
    const hotkey = hotkeyLabel(index)
    const description = [hotkey, view.duty].filter((part): part is string => part !== undefined).join(' · ')
    return {
      name: `${SEAT_COMMAND_NAME} ${view.displayName}`,
      ...(description === '' ? {} : { description }),
      section,
      value: view.skillName,
    }
  })
  rows.push({
    name: `${SEAT_COMMAND_NAME} ${PORTAL_VALUE}`,
    description: `Alt+0 · ${deps.t('seats.portal')}`,
    section,
    value: PORTAL_VALUE,
  })
  if (argument === undefined || argument === '') return rows
  return rows.filter(row => row.name.slice(SEAT_COMMAND_NAME.length + 1).toLowerCase().includes(argument)
    || (row.value ?? '').toLowerCase().includes(argument))
}

async function applyTarget(deps: SeatCommandDeps, target: SeatSwitchTarget): Promise<SubmitOutcome> {
  if (target.kind === 'portal') deps.openPortal()
  else await deps.enter(target.view)
  return { kind: 'success' }
}

/** Submit `/seat <args>`: resolve the name, enter the seat / open the portal, or report notFound (draft stays). */
export async function submitSeatArgs(deps: SeatCommandDeps, args: string): Promise<SubmitOutcome> {
  const name = args.trim()
  if (name === '') return { kind: 'error', text: deps.t('seat.command.hint') }
  const target = resolveSeatByName(name, deps.seats(), deps.cards())
  if (target === undefined) return { kind: 'error', text: deps.t('seat.notFound', { name }) }
  return applyTarget(deps, target)
}

export function createSeatCommandSource(deps: SeatCommandDeps): InputTriggerSource {
  const claim = (): PickOutcome => ({
    claim: {
      token: SEAT_COMMAND_TOKEN,
      hint: deps.t('seat.command.hint'),
      submit: args => submitSeatArgs(deps, args),
    },
  })
  return {
    trigger: '/',
    name: SEAT_COMMAND_NAME,
    order: 10,
    showGroupTitle: false,
    candidates: async (_session: ClientSessionContext, req: CandidateRequest) => (
      req.position === 'leading' ? seatCandidates(deps, req.query) : []
    ),
    onPick: (pick: InputTriggerPick): PickOutcome => {
      const value = pick.candidate.value
      if (pick.action !== 'pick' || value === undefined) return undefined
      // A menu pick fixes the target inside the claim token; Enter then confirms.
      const label = pick.candidate.name.slice(SEAT_COMMAND_NAME.length + 1)
      return {
        claim: {
          token: `${SEAT_COMMAND_TOKEN}${label} `,
          submit: args => submitSeatArgs(deps, args.trim() === '' ? value : args),
        },
      }
    },
    matchSpace: (_session, token) => token === `/${SEAT_COMMAND_NAME}` ? claim() : undefined,
    matchEnter: async (_session, line) => parseSeatLine(line) === undefined ? undefined : claim(),
  }
}
