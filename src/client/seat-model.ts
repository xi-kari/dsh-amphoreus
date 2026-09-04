import type { BindingRecord, SeatRecord } from '../host/store.ts'
import type { PublicCard } from '../shared/api.ts'
import { fallbackHue, heroVisualOf, stickerAssetUrl, type HeroVisual } from '../shared/heroes.ts'
import type { AmphoreusClientSnapshot } from './state.ts'

export interface SeatView {
  readonly skillName: string
  readonly heroId: string | null
  readonly displayName: string
  readonly duty: string | undefined
  readonly deployed: boolean
  readonly hidden: boolean
  readonly order: number
  readonly visual: HeroVisual | undefined
  readonly accent: string
  readonly accent2: string
  readonly hue: number | null
  readonly stickerUrl: string | null
  readonly sessionIds: readonly string[]
}

export const GLOBAL_SEAT_HERO = 'cyrene'

export interface SessionListLike {
  readonly ids: readonly string[]
  readonly byId: Record<string, { updatedAt: number } | undefined>
  readonly current?: string
}

export interface WorkspaceSnapshotLike {
  readonly archivedSessionIds: readonly string[]
}

interface SessionReference {
  readonly id: string
  readonly updatedAt: number
}

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

export function bindingIndex(bindings: readonly BindingRecord[]): ReadonlyMap<string, BindingRecord> {
  return new Map(bindings.map(binding => [binding.sessionId, binding]))
}

export function currentSeatOf(
  bindings: ReadonlyMap<string, BindingRecord>,
  currentSessionId: string | undefined,
): BindingRecord | undefined {
  return currentSessionId === undefined ? undefined : bindings.get(currentSessionId)
}

export function seatColorOf(
  skillName: string | null | undefined,
): { accent: string; accent2: string; hue: number | null } {
  if (skillName === null || skillName === undefined) {
    return { accent: '#8a681c', accent2: '#37305e', hue: null }
  }

  const visual = heroVisualOf(skillName)
  if (visual !== undefined) {
    return { accent: visual.palette.accent, accent2: visual.palette.accent2, hue: null }
  }

  const hue = fallbackHue(skillName)
  return {
    accent: `hsl(${hue} 45% 52%)`,
    accent2: `hsl(${hue} 35% 30%)`,
    hue,
  }
}

export function seatViews(input: {
  readonly seats: readonly SeatRecord[]
  readonly cards: readonly PublicCard[]
  readonly bindings: readonly BindingRecord[]
  readonly sessions: SessionListLike
  readonly archived: readonly string[]
  readonly assetsConfigured: boolean
}): SeatView[] {
  const cardsBySkill = new Map(input.cards.map(card => [card.name, card]))
  const archived = new Set(input.archived)
  const sessionsBySkill = new Map<string, SessionReference[]>()

  for (const [sessionId, binding] of bindingIndex(input.bindings)) {
    if (archived.has(sessionId)) continue
    const session = input.sessions.byId[sessionId]
    if (session === undefined) continue
    const references = sessionsBySkill.get(binding.skillName)
    const reference = { id: sessionId, updatedAt: session.updatedAt }
    if (references === undefined) sessionsBySkill.set(binding.skillName, [reference])
    else references.push(reference)
  }

  for (const references of sessionsBySkill.values()) {
    references.sort((left, right) => right.updatedAt - left.updatedAt || compareText(left.id, right.id))
  }

  return input.seats
    .map((seat): SeatView => {
      const card = cardsBySkill.get(seat.skillName)
      const visual = heroVisualOf(seat.skillName)
      const color = seatColorOf(seat.skillName)
      return {
        skillName: seat.skillName,
        heroId: seat.heroId,
        displayName: seat.userDisplayName ?? card?.displayName ?? seat.displayName,
        duty: card?.duties[0],
        deployed: seat.status === 'deployed',
        hidden: seat.hidden === true,
        order: seat.userOrder ?? seat.order,
        visual,
        ...color,
        stickerUrl: input.assetsConfigured && visual !== undefined
          ? stickerAssetUrl(visual.assets.sticker)
          : null,
        sessionIds: sessionsBySkill.get(seat.skillName)?.map(reference => reference.id) ?? [],
      }
    })
    .sort((left, right) => left.order - right.order || compareText(left.skillName, right.skillName))
}

export function seatViewsFrom(
  snap: AmphoreusClientSnapshot,
  list: SessionListLike,
  ws: WorkspaceSnapshotLike,
): SeatView[] {
  const state = snap.state
  if (state === undefined) return []
  return seatViews({
    seats: state.seats,
    cards: state.suite?.cards ?? [],
    bindings: state.bindings,
    sessions: list,
    archived: ws.archivedSessionIds,
    assetsConfigured: state.effectiveConfig.assetsConfigured,
  })
}
