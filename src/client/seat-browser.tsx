import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import {
  bindingIndex,
  currentSeatOf,
  seatColorOf,
  seatViewsFrom,
  type SeatView,
} from './seat-model.ts'
import type { AmphoreusClientModel } from './state.ts'
import css from './seat-browser.module.css'
import { unboundSeatWorkspaces, withoutSeatWorkspaces } from './workspace-routing.ts'

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
  t,
}: SeatBrowserProps) {
  const snap = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const list = useSessions(state => state)
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

  const views = seatViewsFrom(snap, list as unknown as Parameters<typeof seatViewsFrom>[1], workspaces)
  const archived = new Set(workspaces.archivedSessionIds)
  const bindings = bindingIndex(snap.state?.bindings ?? [])
  const currentSeat = currentSeatOf(bindings, list.current)
  const deployed = views.filter(view => !view.hidden && view.deployed)
  const undeployed = views.filter(view => !view.hidden && !view.deployed)
  const suiteMissing = snap.state?.suite === undefined || snap.state.suite.level === 'L3'
  const seatDirectories = (snap.state?.seatDirs ?? []).map(item => item.dir)
  const directoryWorkspaces = withoutSeatWorkspaces(workspaces.items, seatDirectories)
  const unboundWorkspaces = unboundSeatWorkspaces(
    workspaces.items, seatDirectories, bindings.keys(), workspaces.archivedSessionIds,
    Object.keys(list.byId).filter(id => list.byId[id as SessionId] !== undefined),
  )

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

  const enter = (view: SeatView): void => {
    if (creatingSkills.current.has(view.skillName)) return
    toggleSeat(view.skillName)
    const latest = view.sessionIds[0]
    if (latest === undefined) createSeat(view.skillName)
    else run(() => openSession(latest, view.skillName))
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
          data-active={list.current === sessionId || undefined}
          disabled={pending}
          onClick={() => run(() => openSession(sessionId, skillName))}
        >
          <span className={css.sessionName}>{title}</span>
          {skillName === undefined && boundMark(sessionId)}
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
        {deployed.map(view => (
          <button
            key={view.skillName}
            className={css.railButton}
            type="button"
            title={view.displayName}
            aria-label={view.displayName}
            disabled={creating.has(view.skillName)}
            aria-busy={creating.has(view.skillName)}
            data-current={currentSeat?.skillName === view.skillName || undefined}
            style={seatVars(view)}
            onClick={() => {
              expandSidebar()
              enter(view)
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
                  disabled={creating.has(view.skillName)}
                  aria-busy={creating.has(view.skillName)}
                  onClick={() => enter(view)}
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
                {seatOpen.has(view.skillName) && view.sessionIds.length > 0 && (
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
