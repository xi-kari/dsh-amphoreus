import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { BindingRecord } from '../host/store.ts'
import type { AmphoreusState } from '../shared/api.ts'
import { fallbackHue, heroVisualOf } from '../shared/heroes.ts'
import { motifDataUri } from '../shared/motifs.ts'

export interface WorkspaceSeat {
  heroId: string | null
  skillName: string
  dir: string | null
  displayName: string | null
  duties: string[]
  ordinal: number | null
  deployed: boolean
  order: number
  accent: string | null
  accent2: string | null
  hue: number | null
  lightBase: string | null
  darkBase: string | null
  volume: number | null
  motif: { name: string; light: string; dark: string } | null
  coverUrl: string | null
  coverWideUrl: string | null
  chronicleUrl: string | null
  cardUrl: string | null
  stickerUrl: string | null
}

export interface WorkspaceSession {
  id: string
  title: string
  parentId: string | null
  cwd: string | null
  running: boolean
  blank: boolean
  skillName: string | null
  face: string | null
  source: BindingRecord['source'] | null
}

export interface WorkspacesPayload {
  seats: WorkspaceSeat[]
  sessions: WorkspaceSession[]
  assetsConfigured: boolean
}

interface ListSnapshot {
  ids: string[]
  byId: Record<string, {
    title?: string
    displayTitle: string
    cwd?: string
    parentId?: string
    running: boolean
    blank: boolean
  } | undefined>
}

const assetUrl = (directory: string, fileName: string): string =>
  `/amphoreus/assets/${encodeURIComponent(directory)}/${encodeURIComponent(fileName)}`

export function derivedUrl(derived: readonly string[], heroId: string, file: string): string | null {
  return derived.includes(`${heroId}/${file}`) ? `/amphoreus/derived/${heroId}/${file}` : null
}

function composeWorkspaces(list: ListSnapshot, state: AmphoreusState | undefined): WorkspacesPayload {
  const assetsConfigured = state?.effectiveConfig.assetsConfigured ?? false
  const derived = state?.assets?.derived ?? []
  const seats = (state?.seats ?? [])
    .filter(seat => seat.hidden !== true)
    .map((seat): WorkspaceSeat => {
      const visual = heroVisualOf(seat.skillName)
      const card = state?.suite?.cards.find(candidate => candidate.name === seat.skillName)
      const dir = state?.seatDirs.find(candidate => candidate.skillName === seat.skillName)?.dir ?? null
      const order = seat.userOrder ?? seat.order
      return {
        heroId: seat.heroId,
        skillName: seat.skillName,
        dir,
        displayName: seat.userDisplayName ?? card?.displayName ?? seat.displayName,
        duties: [...(card?.duties ?? seat.duties)],
        ordinal: card?.ordinal ?? null,
        deployed: seat.status === 'deployed',
        order,
        accent: visual?.palette.accent ?? null,
        accent2: visual?.palette.accent2 ?? null,
        hue: visual === undefined ? fallbackHue(seat.skillName) : null,
        lightBase: visual?.palette.lightBase ?? null,
        darkBase: visual?.palette.darkBase ?? null,
        volume: visual?.volume ?? null,
        motif: visual === undefined ? null : {
          name: visual.motif,
          light: motifDataUri(visual.motif, { color: visual.palette.accent, opacity: 0.12 }),
          dark: motifDataUri(visual.motif, { color: visual.palette.accent2, opacity: 0.16 }),
        },
        coverUrl: visual === undefined ? null : derivedUrl(derived, visual.heroId, 'cover-34.webp'),
        coverWideUrl: visual === undefined ? null : derivedUrl(derived, visual.heroId, 'cover-169.webp'),
        chronicleUrl: visual === undefined ? null : derivedUrl(derived, visual.heroId, 'chronicle.webp')
          ?? (assetsConfigured ? assetUrl('翁法罗斯英雄纪', visual.assets.chronicle) : null),
        cardUrl: visual === undefined ? null : derivedUrl(derived, visual.heroId, 'card.webp')
          ?? (assetsConfigured ? assetUrl('翁法罗斯如我所书卡牌', visual.assets.card) : null),
        stickerUrl: visual === undefined ? null : derivedUrl(derived, visual.heroId, 'sticker.webp')
          ?? (assetsConfigured ? assetUrl('表情包', visual.assets.sticker) : null),
      }
    })
    .sort((left, right) => left.order - right.order)

  const bindings = new Map((state?.bindings ?? []).map(binding => [binding.sessionId, binding]))
  const sessions: WorkspaceSession[] = []
  for (const id of list.ids) {
    const session = list.byId[id]
    if (session === undefined || session.blank) continue
    const binding = bindings.get(id)
    sessions.push({
      id,
      title: session.title ?? session.displayTitle,
      parentId: session.parentId ?? null,
      cwd: session.cwd ?? null,
      running: session.running,
      blank: session.blank,
      skillName: binding?.skillName ?? null,
      face: binding?.face ?? null,
      source: binding?.source ?? null,
    })
  }

  return { seats, sessions, assetsConfigured }
}

export function createWorkspacesSource(
  list: ObservableSnapshot<ListSnapshot>,
  model: ObservableSnapshot<{ state?: AmphoreusState }>,
): ObservableSnapshot<WorkspacesPayload> {
  let cached: WorkspacesPayload | undefined
  let cachedList: ListSnapshot | undefined
  let cachedModel: { state?: AmphoreusState } | undefined

  const getSnapshot = (): WorkspacesPayload => {
    const nextList = list.getSnapshot()
    const nextModel = model.getSnapshot()
    if (cached === undefined || nextList !== cachedList || nextModel !== cachedModel) {
      cachedList = nextList
      cachedModel = nextModel
      cached = composeWorkspaces(nextList, nextModel.state)
    }
    return cached
  }

  const subscribe = (listener: () => void): (() => void) => {
    let active = true
    let scheduled = false
    let frame: number | undefined
    const flush = (): void => {
      scheduled = false
      frame = undefined
      if (active) listener()
    }
    const invalidate = (): void => {
      cached = undefined
      if (scheduled) return
      scheduled = true
      if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(flush)
      else queueMicrotask(flush)
    }
    const disposeList = list.subscribe(invalidate)
    const disposeModel = model.subscribe(invalidate)
    return () => {
      active = false
      disposeList()
      disposeModel()
      if (frame !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    }
  }

  return { getSnapshot, subscribe }
}
