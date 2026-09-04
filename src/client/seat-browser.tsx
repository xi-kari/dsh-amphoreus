import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { useState, useSyncExternalStore, type CSSProperties } from 'react'
import {
  bindingIndex,
  currentSeatOf,
  seatColorOf,
  seatViewsFrom,
  type SeatView,
} from './seat-model.ts'
import type { AmphoreusClientModel } from './state.ts'
import css from './seat-browser.module.css'

export interface SeatBrowserInjected {
  readonly model: AmphoreusClientModel
  readonly openSession: (sessionId: string) => void
  readonly startSeatSession: (skillName: string) => Promise<string>
  readonly startDirectorySession: (workspaceId: string) => void
  readonly createDirectoryWorkspace: (fallbackPrompt: () => string | null) => Promise<void>
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
  startSeatSession,
  startDirectorySession,
  createDirectoryWorkspace,
  t,
}: SeatBrowserProps) {
  const snap = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const list = useSessions(state => state)
  const workspaces = useWorkspaces(state => state)
  const [seatsExpanded, setSeatsExpanded] = useState(true)
  const [directoriesExpanded, setDirectoriesExpanded] = useState(true)
  const [seatOpen, setSeatOpen] = useState<ReadonlySet<string>>(() => new Set())
  const [error, setError] = useState<string>()

  const views = seatViewsFrom(snap, list as unknown as Parameters<typeof seatViewsFrom>[1], workspaces)
  const archived = new Set(workspaces.archivedSessionIds)
  const bindings = bindingIndex(snap.state?.bindings ?? [])
  const currentSeat = currentSeatOf(bindings, list.current)
  const deployed = views.filter(view => !view.hidden && view.deployed)
  const undeployed = views.filter(view => !view.hidden && !view.deployed)
  const suiteMissing = snap.state?.suite === undefined || snap.state.suite.level === 'L3'

  const run = (operation: () => Promise<unknown>): void => {
    setError(undefined)
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

  const enter = (view: SeatView): void => {
    toggleSeat(view.skillName)
    const latest = view.sessionIds[0]
    if (latest === undefined) run(() => startSeatSession(view.skillName))
    else openSession(latest)
  }

  const boundMark = (sessionId: string) => {
    const binding = bindings.get(sessionId)
    if (binding === undefined) return null
    return <i className={css.dot} style={seatVars(seatColorOf(binding.skillName))} aria-hidden="true" />
  }

  const promptForDirectory = (): string | null => window.prompt(t('seats.newDirectoryPrompt'))
  const createDirectory = (): void => run(() => createDirectoryWorkspace(promptForDirectory))

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
                  title={view.duty ?? view.displayName}
                  aria-expanded={seatOpen.has(view.skillName)}
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
                  onClick={() => run(() => startSeatSession(view.skillName))}
                >
                  <span aria-hidden="true">＋</span>
                </button>
                {seatOpen.has(view.skillName) && view.sessionIds.length > 0 && (
                  <ul className={css.sessionList}>
                    {view.sessionIds.slice(0, 5).map(sessionId => (
                      <li key={sessionId}>
                        <button
                          className={css.sessionRow}
                          type="button"
                          data-active={list.current === sessionId || undefined}
                          onClick={() => openSession(sessionId)}
                        >
                          <span className={css.sessionName}>{list.byId[sessionId as SessionId]?.displayTitle ?? sessionId}</span>
                        </button>
                      </li>
                    ))}
                    {view.sessionIds.length > 5 && <li className={css.more}>…</li>}
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
            {workspaces.items.map(workspace => (
              <div key={workspace.workspaceId} className={css.dir}>
                <button
                  className={css.dirHead}
                  type="button"
                  title={workspace.path}
                  onClick={() => startDirectorySession(workspace.workspaceId)}
                >
                  {workspace.title}
                </button>
                <ul className={css.sessionList}>
                  {workspace.sessionIds.map(sessionId => {
                    const session = list.byId[sessionId]
                    if (archived.has(sessionId) || session === undefined || session.blank) return null
                    return (
                      <li key={sessionId}>
                        <button
                          className={css.sessionRow}
                          type="button"
                          data-active={list.current === sessionId || undefined}
                          onClick={() => openSession(sessionId)}
                        >
                          <span className={css.sessionName}>{session.displayTitle}</span>
                          {boundMark(sessionId)}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {error !== undefined && <p className={css.error} role="alert">{error}</p>}
    </div>
  )
}
