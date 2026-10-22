import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  bindingIndex,
  currentSeatOf,
  seatColorOf,
  seatViewsFrom,
} from './seat-model.ts'
import type { AmphoreusClientModel } from './state.ts'
import { currentSessionId } from './session-adapter.ts'
import css from './seat-browser.module.css'
import { unboundSeatWorkspaces, withoutSeatWorkspaces } from './workspace-routing.ts'
import {
  beginSessionPinDrag, filterNavigationSessions, MAX_SESSION_PINS, mergeMessageSearch, navigationSessions,
  readSessionPins, reorderSessionPin, saveSessionPins, SESSION_SEARCH_LIMIT, setSessionPinned,
  type MessageSearchResult, type NavigationSession, type PinDropTarget,
} from './session-navigation.ts'

export interface SeatBrowserInjected {
  readonly model: AmphoreusClientModel
  readonly openSession: (sessionId: string, skillName?: string) => Promise<void>
  readonly archiveSession: (sessionId: string) => Promise<void>
  /** Resolves undefined when a start for the seat was already in flight (shared guard) and nothing was created. */
  readonly startSeatSession: (skillName: string) => Promise<string | undefined>
  readonly startDirectorySession: (workspaceId: string) => void
  readonly createDirectoryWorkspace: (fallbackPrompt: () => string | null) => Promise<void>
  /** Remove a directory workspace from the registry (official delete; sessions and files are untouched). */
  readonly removeDirectoryWorkspace: (workspaceId: string) => Promise<void>
  readonly searchMessages: (query: string, signal: AbortSignal) => Promise<MessageSearchResult>
}

export type SeatBrowserProps =
  PropsRuntime<'sidebar.workspaces'>
  & PropsLocale<'amphoreus'>
  & SeatBrowserInjected

const seatVars = (value: { accent: string; hue: number | null }): CSSProperties => ({
  '--amph-seat-accent': value.accent,
  '--amph-seat-hue': value.hue ?? 0,
} as CSSProperties)

export function SeatBrowser({
  wide,
  expandSidebar,
  useSessions,
  useWorkspaces,
  model,
  openSession,
  archiveSession,
  startSeatSession,
  startDirectorySession,
  createDirectoryWorkspace,
  removeDirectoryWorkspace,
  searchMessages,
  t,
}: SeatBrowserProps) {
  const snap = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const list = useSessions(state => state)
  const current = currentSessionId(list)
  const workspaces = useWorkspaces(state => state)
  const [seatsExpanded, setSeatsExpanded] = useState(true)
  const [directoriesExpanded, setDirectoriesExpanded] = useState(true)
  const [seatOpen, setSeatOpen] = useState<ReadonlySet<string>>(() => new Set())
  const [seatShowAll, setSeatShowAll] = useState<ReadonlySet<string>>(() => new Set())
  const [creating, setCreating] = useState<ReadonlySet<string>>(() => new Set())
  const creatingSkills = useRef(new Set<string>())
  const [archiveConfirm, setArchiveConfirm] = useState<string>()
  const [archiving, setArchiving] = useState<ReadonlySet<string>>(() => new Set())
  const archivingIds = useRef(new Set<string>())
  const [archiveRetry, setArchiveRetry] = useState<string>()
  const [removeConfirm, setRemoveConfirm] = useState<string>()
  const [removing, setRemoving] = useState<ReadonlySet<string>>(() => new Set())
  const removingIds = useRef(new Set<string>())
  const [error, setError] = useState<string>()
  const [query, setQuery] = useState('')
  const [pins, setPins] = useState(readSessionPins)
  const [messageSearch, setMessageSearch] = useState<{ phase: 'idle' | 'loading' | 'ready' | 'error'; items: MessageSearchResult['items']; hasMore: boolean; error?: string }>({ phase: 'idle', items: [], hasMore: false })
  const [liveNote, setLiveNote] = useState('')
  const [pinDrag, setPinDrag] = useState<{ id: string; target: PinDropTarget | null } | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const resultsList = useRef<HTMLUListElement>(null)
  const pinList = useRef<HTMLUListElement>(null)
  const pinOrder = useRef(pins)
  const available = useRef<readonly NavigationSession[]>([])
  const searchAbort = useRef<AbortController | null>(null)
  const searchRevision = useRef(0)
  const stopPinDrag = useRef<(() => void) | null>(null)
  const alive = useRef(true)
  const focusSearchOnExpand = useRef(false)
  const focusPinAfterMove = useRef<string | null>(null)
  pinOrder.current = pins

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      searchRevision.current++
      searchAbort.current?.abort()
      stopPinDrag.current?.()
    }
  }, [])
  useEffect(() => {
    if (wide && focusSearchOnExpand.current) {
      focusSearchOnExpand.current = false
      searchInput.current?.focus()
    }
  }, [wide])
  useEffect(() => {
    const id = focusPinAfterMove.current
    focusPinAfterMove.current = null
    if (id !== null) [...(pinList.current?.querySelectorAll<HTMLButtonElement>('[data-pin-handle]') ?? [])]
      .find(button => button.dataset.pinHandle === id)?.focus({ preventScroll: true })
  }, [pins])

  const views = seatViewsFrom(snap, list, workspaces)
  const archived = new Set(workspaces.archivedSessionIds)
  const bindings = bindingIndex(snap.state?.bindings ?? [])
  const currentSeat = currentSeatOf(bindings, current)
  const deployed = views.filter(view => !view.hidden && view.deployed)
  const undeployed = views.filter(view => !view.hidden && !view.deployed)
  const suiteMissing = snap.state?.suite === undefined || snap.state.suite.level === 'L3'
  const seatDirectories = (snap.state?.seatDirs ?? []).map(item => item.dir)
  const visibleWorkspaces = workspaces.items.filter(workspace => !('hidden' in workspace) || workspace.hidden !== true)
  const directoryWorkspaces = withoutSeatWorkspaces(visibleWorkspaces, seatDirectories)
  const unboundWorkspaces = unboundSeatWorkspaces(
    visibleWorkspaces, seatDirectories, bindings.keys(), workspaces.archivedSessionIds,
    Object.keys(list.byId).filter(id => list.byId[id as SessionId] !== undefined),
  )
  const navigation = navigationSessions({ sessions: list.byId, bindings: bindings.values(), roles: views,
    workspaces: workspaces.items, archived, untitled: t('seats.untitledSession') })
  available.current = navigation
  const navigationById = new Map(navigation.map(item => [item.id, item]))
  const pinned = pins.flatMap(id => navigationById.has(id) ? [navigationById.get(id)!] : [])
  const localMatches = filterNavigationSessions(navigation, query)
  const matches = mergeMessageSearch(localMatches, navigation, messageSearch.items)
  const searching = query.trim() !== ''

  const persistPins = (next: string[]): void => {
    pinOrder.current = next
    setPins(next)
    if (!saveSessionPins(next)) setError(t('seats.pinStorageFailed'))
  }
  const togglePin = (id: string): void => {
    stopPinDrag.current?.()
    if (!available.current.some(item => item.id === id)) return
    persistPins(setSessionPinned(pinOrder.current, id, !pinOrder.current.includes(id)))
  }
  const movePin = (id: string, target: PinDropTarget): void => {
    if (![id, target.id].every(value => available.current.some(item => item.id === value))) return
    const next = reorderSessionPin(pinOrder.current, id, target.id, target.edge)
    if (next.every((value, index) => value === pinOrder.current[index])) return
    persistPins(next)
    const title = available.current.find(item => item.id === id)?.title ?? id
    const visible = next.filter(value => available.current.some(item => item.id === value))
    setLiveNote(t('seats.moved', { title, n: String(visible.indexOf(id) + 1) }))
  }
  const pinKey = (event: KeyboardEvent<HTMLButtonElement>, id: string): void => {
    if (!event.altKey || event.ctrlKey || event.metaKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    const visible = pinOrder.current.filter(value => available.current.some(item => item.id === value))
    const index = visible.indexOf(id)
    const target = visible[index + (event.key === 'ArrowUp' ? -1 : 1)]
    if (index < 0 || target === undefined) return
    focusPinAfterMove.current = id
    movePin(id, { id: target, edge: event.key === 'ArrowUp' ? 'before' : 'after' })
  }
  const dragPin = (event: ReactPointerEvent<HTMLButtonElement>, id: string): void => {
    stopPinDrag.current?.()
    event.currentTarget.focus({ preventScroll: true })
    stopPinDrag.current = beginSessionPinDrag(event.nativeEvent, event.currentTarget, {
      id,
      rows: () => [...(pinList.current?.querySelectorAll<HTMLElement>('[data-pinned-session]') ?? [])].map(row => {
        const rect = row.getBoundingClientRect()
        return { id: row.dataset.pinnedSession!, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
      }),
      preview: (target, active) => { if (alive.current) setPinDrag(active ? { id, target } : null) },
      commit: target => { if (alive.current) movePin(id, target) },
      finish: cancelled => {
        stopPinDrag.current = null
        if (alive.current && cancelled) setLiveNote(t('seats.orderCancelled'))
      },
    })
  }
  const changeQuery = (value: string): void => {
    stopPinDrag.current?.()
    searchRevision.current++
    searchAbort.current?.abort()
    setQuery(value)
    setMessageSearch({ phase: 'idle', items: [], hasMore: false })
  }
  const findMessages = (): void => {
    const wanted = query.trim()
    if (wanted === '' || messageSearch.phase === 'loading') return
    searchAbort.current?.abort()
    const controller = new AbortController()
    searchAbort.current = controller
    const revision = ++searchRevision.current
    setMessageSearch({ phase: 'loading', items: [], hasMore: false })
    void Promise.resolve().then(() => searchMessages(wanted, controller.signal)).then(result => {
      if (!alive.current || controller.signal.aborted || revision !== searchRevision.current) return
      setMessageSearch({ phase: 'ready', items: result.items, hasMore: result.hasMore })
    }).catch(cause => {
      if (!alive.current || controller.signal.aborted || revision !== searchRevision.current) return
      setMessageSearch({ phase: 'error', items: [], hasMore: false, error: cause instanceof Error ? cause.message : String(cause) })
    })
  }
  const resultKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const rows = [...(resultsList.current?.querySelectorAll<HTMLButtonElement>('[data-search-session]') ?? [])]
    const index = rows.indexOf(event.currentTarget)
    const target = event.key === 'ArrowDown' ? Math.min(rows.length - 1, index + 1)
      : event.key === 'ArrowUp' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : undefined
    if (event.key === 'Escape') { event.preventDefault(); changeQuery(''); searchInput.current?.focus(); return }
    if (target === undefined || event.altKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    if (target < 0) searchInput.current?.focus()
    else rows[target]?.focus({ preventScroll: false })
  }

  const run = (operation: () => Promise<unknown>): void => {
    setError(undefined)
    setArchiveRetry(undefined)
    void operation().catch(cause => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  const toggleSeat = (skillName: string): void => {
    setSeatOpen(current => {
      const next = new Set(current)
      if (next.has(skillName)) next.delete(skillName)
      else next.add(skillName)
      return next
    })
  }

  const createSeat = (skillName: string): void => {
    if (creatingSkills.current.has(skillName)) return
    creatingSkills.current.add(skillName)
    setCreating(new Set(creatingSkills.current))
    setSeatOpen(current => new Set([...current, skillName]))
    setError(undefined)
    setArchiveRetry(undefined)
    void Promise.resolve().then(() => startSeatSession(skillName)).catch(cause => {
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      creatingSkills.current.delete(skillName)
      setCreating(new Set(creatingSkills.current))
    })
  }

  const boundMark = (sessionId: string) => {
    const binding = bindings.get(sessionId)
    if (binding === undefined) return null
    return <i className={css.dot} style={seatVars(seatColorOf(binding.skillName))} aria-hidden="true" />
  }

  const promptForDirectory = (): string | null => window.prompt(t('seats.newDirectoryPrompt'))
  const createDirectory = (): void => run(() => createDirectoryWorkspace(promptForDirectory))

  const removeDirectory = (workspaceId: string): void => {
    if (removingIds.current.has(workspaceId)) return
    removingIds.current.add(workspaceId)
    setRemoving(new Set(removingIds.current))
    setError(undefined)
    void Promise.resolve().then(() => removeDirectoryWorkspace(workspaceId)).then(() => {
      setRemoveConfirm(current => current === workspaceId ? undefined : current)
    }).catch(cause => {
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      removingIds.current.delete(workspaceId)
      setRemoving(new Set(removingIds.current))
    })
  }

  const archive = (sessionId: string): void => {
    if (archivingIds.current.has(sessionId)) return
    archivingIds.current.add(sessionId)
    setArchiving(new Set(archivingIds.current))
    setError(undefined)
    setArchiveRetry(undefined)
    void Promise.resolve().then(() => archiveSession(sessionId)).then(() => {
      setArchiveConfirm(current => current === sessionId ? undefined : current)
    }).catch(cause => {
      setError(cause instanceof Error ? cause.message : String(cause))
      setArchiveRetry(sessionId)
    }).finally(() => {
      archivingIds.current.delete(sessionId)
      setArchiving(new Set(archivingIds.current))
    })
  }

  const sessionEntry = (sessionId: string, skillName?: string) => {
    const session = list.byId[sessionId as SessionId]
    const title = session?.displayTitle || t('seats.untitledSession')
    const pending = archiving.has(sessionId)
    return (
      <li key={sessionId} className={css.sessionEntry}>
        <button
          className={css.sessionRow}
          type="button"
          title={title}
          data-active={current === sessionId || undefined}
          disabled={pending}
          onClick={() => run(() => openSession(sessionId, skillName))}
        >
          <span className={css.sessionName}>{title}</span>
          {skillName === undefined && boundMark(sessionId)}
        </button>
        <button className={css.pin} type="button" aria-pressed={pins.includes(sessionId)}
          aria-label={t(pins.includes(sessionId) ? 'seats.unpinNamed' : 'seats.pinNamed', { title })}
          disabled={pending || !pins.includes(sessionId) && pins.length >= MAX_SESSION_PINS}
          onClick={() => togglePin(sessionId)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 2 6 0-1 4 2 2v1H9l-1 5-1-5H4V8l2-2Z" /></svg>
        </button>
        <button
          className={css.archive}
          type="button"
          aria-label={t('seats.archiveNamed').replace('{title}', title)}
          aria-expanded={archiveConfirm === sessionId}
          disabled={pending}
          onClick={() => setArchiveConfirm(sessionId)}
        >
          {pending ? t('seats.archiving') : t('seats.archive')}
        </button>
        {archiveConfirm === sessionId && (
          <div className={css.archiveConfirm}>
            <p>{t('seats.archiveConfirm')}</p>
            <button className={css.archive} type="button" disabled={pending} onClick={() => archive(sessionId)}>
              {pending ? t('seats.archiving') : t('seats.archiveConfirmAction')}
            </button>
            <button className={css.archive} type="button" disabled={pending} onClick={() => setArchiveConfirm(undefined)}>
              {t('seats.archiveCancel')}
            </button>
          </div>
        )}
      </li>
    )
  }

  if (!wide) {
    return (
      <div className={`${css.root} ${css.rail}`} data-amphoreus-seat-browser>
        <button className={css.railButton} type="button" aria-label={t('seats.searchLabel')} title={t('seats.searchLabel')}
          onClick={() => { focusSearchOnExpand.current = true; expandSidebar() }}>
          <svg className={css.searchIcon} viewBox="0 0 16 16" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4" /><path d="m9.5 9.5 4 4" /></svg>
        </button>
        {deployed.map(view => (
          <button
            key={view.skillName}
            className={css.railButton}
            type="button"
            title={view.displayName}
            aria-label={view.displayName}
            data-current={currentSeat?.skillName === view.skillName || undefined}
            style={seatVars(view)}
            onClick={() => {
              expandSidebar()
              setSeatsExpanded(true)
              setSeatOpen(current => new Set([...current, view.skillName]))
            }}
          >
            {view.stickerUrl !== null
              ? <img className={css.mark} src={view.stickerUrl} alt="" aria-hidden="true" />
              : <span className={css.markGeneric} aria-hidden="true" />}
          </button>
        ))}
        <button
          className={css.railButton}
          type="button"
          title={t('seats.newDirectory')}
          aria-label={t('seats.newDirectory')}
          onClick={() => {
            expandSidebar()
            createDirectory()
          }}
        >
          <span className={css.directoryPlus} aria-hidden="true">＋</span>
        </button>
      </div>
    )
  }

  return (
    <div className={css.root} data-amphoreus-seat-browser>
      <form className={css.search} role="search" onSubmit={event => { event.preventDefault(); findMessages() }}>
        <div className={css.searchField}>
          <input ref={searchInput} type="search" value={query} maxLength={200}
            aria-label={t('seats.searchLabel')} placeholder={t('seats.searchPlaceholder')}
            onChange={event => changeQuery(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Escape') { event.preventDefault(); changeQuery('') }
              if (event.key === 'ArrowDown') { event.preventDefault(); resultsList.current?.querySelector<HTMLButtonElement>('[data-search-session]')?.focus() }
            }} />
          {searching && <button className={css.clearSearch} type="button" aria-label={t('seats.searchClear')}
            onClick={() => { changeQuery(''); searchInput.current?.focus() }}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg></button>}
        </div>
        {searching && <button className={css.contentSearch} type="submit" disabled={messageSearch.phase === 'loading'}>
          {t(messageSearch.phase === 'loading' ? 'seats.searchPending' : 'seats.searchMessages')}
        </button>}
      </form>
      {searching ? <section className={css.group} aria-label={t('seats.searchResults')}>
        <p className={css.searchSummary} role="status">{t('seats.searchResultCount', { n: String(matches.length) })}</p>
        <ul className={css.navigationList} ref={resultsList}>
          {matches.map(item => <li className={css.navigationRow} key={item.id}>
            <button type="button" className={css.navigationOpen} data-search-session={item.id} data-active={current === item.id || undefined}
              onKeyDown={resultKey} onClick={() => run(() => openSession(item.id, item.skillName))}>
              <span className={css.sessionName}>{item.title}</span>
              <small>{[item.role, item.directory || item.path].filter(Boolean).join(' · ')}</small>
              {item.snippet && <span className={css.snippet}>{item.snippet}</span>}
            </button>
            <button className={css.pin} type="button" aria-pressed={pins.includes(item.id)}
              aria-label={t(pins.includes(item.id) ? 'seats.unpinNamed' : 'seats.pinNamed', { title: item.title })}
              disabled={!pins.includes(item.id) && pins.length >= MAX_SESSION_PINS} onClick={() => togglePin(item.id)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 2 6 0-1 4 2 2v1H9l-1 5-1-5H4V8l2-2Z" /></svg>
            </button>
          </li>)}
        </ul>
        {matches.length === 0 && messageSearch.phase !== 'loading' && messageSearch.phase !== 'error' && <p className={css.empty}>{t('seats.searchEmpty')}</p>}
        {(messageSearch.hasMore || localMatches.length > SESSION_SEARCH_LIMIT) && <p className={css.empty}>{t('seats.searchHasMore')}</p>}
        {messageSearch.phase === 'error' && <div className={css.error} role="alert">
          <p>{t('seats.searchUnavailable')}</p>
          <details><summary>{t('seats.searchDetails')}</summary><p>{messageSearch.error}</p></details>
        </div>}
      </section> : <>
      {pinned.length > 0 && <section className={css.group} data-group="pinned" aria-label={t('seats.pinned')}>
        <header className={css.groupHead} title={t('seats.pinLocalHint')}>{t('seats.pinned')}</header>
        <p className={css.navigationHint}>{t('seats.reorderHint')}</p>
        <ul className={css.navigationList} ref={pinList} data-pin-dragging={pinDrag !== null || undefined}>
          {pinned.map(item => <li className={`${css.navigationRow} ${css.pinnedRow}`} key={item.id} data-pinned-session={item.id}
            data-dragging={pinDrag?.id === item.id || undefined} data-drop-edge={pinDrag?.target?.id === item.id ? pinDrag.target.edge : undefined}>
            <button className={css.navigationOpen} type="button" data-active={current === item.id || undefined}
              onKeyDown={event => pinKey(event, item.id)} onClick={() => run(() => openSession(item.id, item.skillName))}>
              <span className={css.sessionName}>{item.title}</span><small>{item.role || item.directory || item.path}</small>
            </button>
            <button className={css.pin} type="button" aria-label={t('seats.unpinNamed', { title: item.title })}
              aria-pressed="true" onClick={() => togglePin(item.id)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 2 6 0-1 4 2 2v1H9l-1 5-1-5H4V8l2-2Z" /></svg>
            </button>
            <button className={css.dragHandle} type="button" data-pin-handle={item.id}
              aria-label={t('seats.reorderNamed', { title: item.title })} title={t('seats.reorderHint')}
              onPointerDown={event => dragPin(event, item.id)} onKeyDown={event => pinKey(event, item.id)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v.1M11 3v.1M5 8v.1M11 8v.1M5 13v.1M11 13v.1" /></svg>
            </button>
          </li>)}
        </ul>
      </section>}
      <section className={css.group} data-group="seats">
        <header className={css.groupHead}>
          <button
            className={css.fold}
            type="button"
            aria-expanded={seatsExpanded}
            onClick={() => setSeatsExpanded(value => !value)}
          >
            {t('seats.section')}
          </button>
        </header>
        {seatsExpanded && (
          <ul className={css.seatList}>
            {deployed.map(view => (
              <li
                key={view.skillName}
                className={css.seatRow}
                style={seatVars(view)}
                data-current={currentSeat?.skillName === view.skillName || undefined}
              >
                <button
                  className={css.seatMain}
                  type="button"
                  title={deployed.indexOf(view) < 9 ? `${view.duty ?? view.displayName} · ${t('seat.hotkeyHint', { key: `Alt+${deployed.indexOf(view) + 1}` })}` : view.duty ?? view.displayName}
                  aria-expanded={seatOpen.has(view.skillName)}
                  onClick={() => toggleSeat(view.skillName)}
                >
                  {view.stickerUrl !== null
                    ? <img className={css.mark} src={view.stickerUrl} alt="" aria-hidden="true" />
                    : <span className={css.markGeneric} aria-hidden="true" />}
                  <span className={css.name}>{view.displayName}</span>
                  <span className={css.count}>
                    {view.sessionIds.length > 0
                      ? t('seats.sessions').replace('{n}', String(view.sessionIds.length))
                      : t('seats.noSessions')}
                  </span>
                </button>
                <button
                  className={css.plus}
                  type="button"
                  aria-label={t('seats.newSession')}
                  disabled={creating.has(view.skillName)}
                  aria-busy={creating.has(view.skillName)}
                  onClick={() => createSeat(view.skillName)}
                >
                  <span aria-hidden="true">{creating.has(view.skillName) ? '…' : '＋'}</span>
                </button>
                {view.sessionIds.length > 0 && (
                  <div data-amph-disclosure="" data-open={seatOpen.has(view.skillName) || undefined}
                    aria-hidden={!seatOpen.has(view.skillName) || undefined}
                    {...(seatOpen.has(view.skillName) ? {} : { inert: '' })}>
                  <div>
                  <ul className={css.sessionList}>
                    {(seatShowAll.has(view.skillName) ? view.sessionIds : view.sessionIds.slice(0, 5))
                      .map(sessionId => sessionEntry(sessionId, view.skillName))}
                    {view.sessionIds.length > 5 && (
                      <li>
                        <button
                          className={css.more}
                          type="button"
                          aria-expanded={seatShowAll.has(view.skillName)}
                          onClick={() => setSeatShowAll(current => {
                            const next = new Set(current)
                            if (next.has(view.skillName)) next.delete(view.skillName)
                            else next.add(view.skillName)
                            return next
                          })}
                        >
                          {seatShowAll.has(view.skillName)
                            ? t('seats.showLess')
                            : t('seats.showAll').replace('{n}', String(view.sessionIds.length))}
                        </button>
                      </li>
                    )}
                  </ul>
                  </div>
                  </div>
                )}
              </li>
            ))}
            {undeployed.length > 0 && (
              <li className={css.undeployedGroup}>
                <details>
                  <summary>{t('seats.undeployedGroup')}（{undeployed.length}）</summary>
                  {undeployed.map(view => (
                    <div key={view.skillName} className={css.seatRowDisabled}>{view.displayName}</div>
                  ))}
                </details>
              </li>
            )}
          </ul>
        )}
        {suiteMissing && <p className={css.empty}>{t('settings.missing')}</p>}
      </section>

      <section className={css.group} data-group="directories">
        <header className={css.groupHead}>
          <button
            className={css.fold}
            type="button"
            aria-expanded={directoriesExpanded}
            onClick={() => setDirectoriesExpanded(value => !value)}
          >
            {t('seats.directories')}
          </button>
          <button className={css.plus} type="button" aria-label={t('seats.newDirectory')} onClick={createDirectory}>
            <span aria-hidden="true">＋</span>
          </button>
        </header>
        {directoriesExpanded && (
          <div className={css.directoryList}>
            {directoryWorkspaces.map(workspace => {
              const seatBound = workspace.sessionIds.filter(sessionId =>
                bindings.has(sessionId) && !archived.has(sessionId) && list.byId[sessionId as SessionId] !== undefined)
              const pending = removing.has(workspace.workspaceId)
              return (
                <div key={workspace.workspaceId} className={css.dir}>
                  <div className={css.dirRow}>
                    <button
                      className={css.dirHead}
                      type="button"
                      title={workspace.path}
                      onClick={() => startDirectorySession(workspace.workspaceId)}
                    >
                      {workspace.title}
                    </button>
                    <button
                      className={css.archive}
                      type="button"
                      aria-label={t('seats.removeDirectoryNamed').replace('{title}', workspace.title)}
                      aria-expanded={removeConfirm === workspace.workspaceId}
                      disabled={pending}
                      onClick={() => setRemoveConfirm(workspace.workspaceId)}
                    >
                      {pending ? t('seats.removing') : t('seats.removeDirectory')}
                    </button>
                  </div>
                  {removeConfirm === workspace.workspaceId && (
                    <div className={css.archiveConfirm}>
                      <p>{t('seats.removeDirectoryConfirm')}</p>
                      <button className={css.archive} type="button" disabled={pending} onClick={() => removeDirectory(workspace.workspaceId)}>
                        {pending ? t('seats.removing') : t('seats.removeDirectoryAction')}
                      </button>
                      <button className={css.archive} type="button" disabled={pending} onClick={() => setRemoveConfirm(undefined)}>
                        {t('seats.archiveCancel')}
                      </button>
                    </div>
                  )}
                  <ul className={css.sessionList}>
                    {workspace.sessionIds.map(sessionId => {
                      const session = list.byId[sessionId as SessionId]
                      // Seat-bound sessions are listed under 黄金裔席位; a directory shows only its plain conversations.
                      if (archived.has(sessionId) || session === undefined || bindings.has(sessionId)) return null
                      return sessionEntry(sessionId)
                    })}
                  </ul>
                  {seatBound.length > 0 && (
                    <p className={css.dirNote}>{t('seats.directorySeatSessions').replace('{n}', String(seatBound.length))}</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {unboundWorkspaces.length > 0 && (
        <section className={css.group} data-group="unbound-sessions">
          <header className={css.groupHead}>{t('seats.unboundSessions')}</header>
          <p className={css.empty}>{t('seats.unboundSessionsHint')}</p>
          <div className={css.directoryList}>
            {unboundWorkspaces.map(workspace => (
              <div key={workspace.workspaceId} className={css.dir}>
                <div className={css.dirLabel} title={workspace.path}>{workspace.title}</div>
                <ul className={css.sessionList}>
                  {workspace.sessionIds.map(sessionId => sessionEntry(sessionId))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
      </>}
      <p className={css.srOnly} role="status" aria-live="polite">{liveNote}</p>

      {error !== undefined && (
        <div className={css.error} role="alert">
          <p>{error}</p>
          {archiveRetry !== undefined && (
            <button className={css.archive} type="button" disabled={archiving.has(archiveRetry)} onClick={() => archive(archiveRetry)}>
              {t('seats.archiveRetry')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
