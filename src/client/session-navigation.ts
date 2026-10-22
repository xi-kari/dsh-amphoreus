export const SESSION_PINS_KEY = 'dsh-amphoreus:session-pins:v1'
export const MAX_SESSION_PINS = 200
export const SESSION_SEARCH_LIMIT = 100

export interface NavigationSession {
  readonly id: string
  readonly title: string
  readonly updatedAt: number
  readonly skillName?: string
  readonly role: string
  readonly directory: string
  readonly path: string
  readonly snippet?: string
}

export interface MessageSearchResult {
  readonly items: readonly { readonly sessionId: string; readonly snippet: string }[]
  readonly hasMore: boolean
}

interface SessionRow {
  readonly displayTitle?: string
  readonly title?: string
  readonly cwd?: string
  readonly updatedAt: number
}

export function navigationSessions(input: {
  readonly sessions: Readonly<Record<string, SessionRow | undefined>>
  readonly bindings: Iterable<{ readonly sessionId: string; readonly skillName: string }>
  readonly roles: readonly { readonly skillName: string; readonly displayName: string; readonly hidden: boolean; readonly deployed: boolean }[]
  readonly workspaces: readonly { readonly title: string; readonly path: string; readonly sessionIds: readonly string[]; readonly hidden?: boolean }[]
  readonly archived: Iterable<string>
  readonly untitled: string
}): NavigationSession[] {
  const archived = new Set(input.archived)
  const roles = new Map(input.roles.map(role => [role.skillName, role]))
  const bindings = new Map([...input.bindings].map(binding => [binding.sessionId, binding.skillName]))
  const visible = new Map<string, typeof input.workspaces[number]>()
  const hidden = new Set<string>()
  for (const workspace of input.workspaces) for (const id of workspace.sessionIds) {
    if (workspace.hidden) hidden.add(id)
    else if (!visible.has(id)) visible.set(id, workspace)
  }
  return Object.entries(input.sessions).flatMap(([id, session]) => {
    if (session === undefined || archived.has(id) || hidden.has(id) && !visible.has(id)) return []
    const skillName = bindings.get(id)
    const role = skillName === undefined ? undefined : roles.get(skillName)
    if (skillName !== undefined && (role === undefined || role.hidden || !role.deployed)) return []
    const workspace = visible.get(id)
    return [{
      id, title: session.displayTitle || session.title || input.untitled,
      updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt : 0,
      ...(skillName === undefined ? {} : { skillName }), role: role?.displayName ?? '',
      directory: workspace?.title ?? '', path: workspace?.path ?? session.cwd ?? '',
    }]
  }).sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function filterNavigationSessions(items: readonly NavigationSession[], query: string): NavigationSession[] {
  const terms = query.normalize('NFKC').trim().toLowerCase().split(/\s+/u).filter(Boolean)
  return items.filter(item => {
    const haystack = [item.title, item.role, item.directory, item.path, item.skillName ?? ''].join('\n').normalize('NFKC').toLowerCase()
    return terms.every(term => haystack.includes(term))
  })
}

export function mergeMessageSearch(local: readonly NavigationSession[], available: readonly NavigationSession[], hits: MessageSearchResult['items']): NavigationSession[] {
  const allowed = new Map(available.map(item => [item.id, item]))
  const merged = new Map(local.filter(item => allowed.has(item.id)).map(item => [item.id, item]))
  for (const hit of hits) {
    const item = allowed.get(hit.sessionId)
    if (item === undefined) continue
    merged.set(item.id, { ...item, snippet: hit.snippet.slice(0, 800) })
  }
  return [...merged.values()].slice(0, SESSION_SEARCH_LIMIT)
}

export function normalizeSessionPins(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const id of value) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 256 || id.trim() !== id || /[\u0000-\u001f]/u.test(id) || ids.includes(id)) continue
    ids.push(id)
    if (ids.length === MAX_SESSION_PINS) break
  }
  return ids
}

export function readSessionPins(storage?: Pick<Storage, 'getItem'>): string[] {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage)
    const value = target?.getItem(SESSION_PINS_KEY)
    return value === null || value === undefined || value.length > 65_536 ? [] : normalizeSessionPins(JSON.parse(value))
  } catch { return [] }
}

export function saveSessionPins(ids: readonly string[], storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage)
    if (target === undefined) return false
    target.setItem(SESSION_PINS_KEY, JSON.stringify(normalizeSessionPins(ids)))
    return true
  } catch { return false }
}

export function setSessionPinned(ids: readonly string[], id: string, pinned: boolean): string[] {
  const clean = normalizeSessionPins(ids)
  if (!pinned) return clean.filter(candidate => candidate !== id)
  if (clean.includes(id) || clean.length >= MAX_SESSION_PINS) return clean
  return normalizeSessionPins([...clean, id])
}

export function reorderSessionPin(ids: readonly string[], id: string, target: string, edge: 'before' | 'after'): string[] {
  const clean = normalizeSessionPins(ids)
  if (id === target || !clean.includes(id) || !clean.includes(target)) return clean
  const remaining = clean.filter(candidate => candidate !== id)
  remaining.splice(remaining.indexOf(target) + (edge === 'after' ? 1 : 0), 0, id)
  return remaining
}

export interface PinDropTarget { readonly id: string; readonly edge: 'before' | 'after' }
export interface PinRowRect { readonly id: string; readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }

export function pinDropTarget(rows: readonly PinRowRect[], x: number, y: number, dragged: string): PinDropTarget | null {
  const row = rows.find(row => x >= row.left && x <= row.right && y >= row.top && y <= row.bottom)
  return row === undefined || row.id === dragged ? null : { id: row.id, edge: y < (row.top + row.bottom) / 2 ? 'before' : 'after' }
}

/** One pointer gesture; completion owns no navigation or Host mutation. */
export function beginSessionPinDrag(event: PointerEvent, handle: HTMLElement, options: {
  readonly id: string
  readonly rows: () => readonly PinRowRect[]
  readonly preview: (target: PinDropTarget | null, active: boolean) => void
  readonly commit: (target: PinDropTarget) => void
  readonly finish: (cancelled: boolean) => void
}): () => void {
  if (event.button !== 0 || event.isPrimary === false) return () => {}
  event.preventDefault()
  event.stopPropagation()
  const doc = handle.ownerDocument
  let stopped = false
  let active = false
  let target: PinDropTarget | null = null
  const origin = { x: event.clientX, y: event.clientY }
  const move = (next: PointerEvent): void => {
    if (stopped || next.pointerId !== event.pointerId) return
    if (!active && Math.hypot(next.clientX - origin.x, next.clientY - origin.y) < 4) return
    active = true
    target = pinDropTarget(options.rows(), next.clientX, next.clientY, options.id)
    options.preview(target, true)
  }
  const stop = (cancelled: boolean): void => {
    if (stopped) return
    stopped = true
    doc.removeEventListener('pointermove', move)
    doc.removeEventListener('pointerup', up)
    doc.removeEventListener('pointercancel', cancel)
    doc.removeEventListener('keydown', key, true)
    handle.removeEventListener('lostpointercapture', cancel)
    try { handle.releasePointerCapture(event.pointerId) } catch {}
    if (!cancelled && active && target !== null) options.commit(target)
    options.preview(null, false)
    options.finish(cancelled && active)
  }
  const up = (next: PointerEvent): void => { if (next.pointerId === event.pointerId) { move(next); stop(false) } }
  const cancel = (next: PointerEvent): void => { if (next.pointerId === event.pointerId) stop(true) }
  const key = (next: KeyboardEvent): void => {
    if (next.key !== 'Escape') return
    next.preventDefault()
    next.stopPropagation()
    stop(true)
  }
  doc.addEventListener('pointermove', move)
  doc.addEventListener('pointerup', up)
  doc.addEventListener('pointercancel', cancel)
  doc.addEventListener('keydown', key, true)
  handle.addEventListener('lostpointercapture', cancel)
  try { handle.setPointerCapture(event.pointerId) } catch {}
  return () => stop(true)
}
