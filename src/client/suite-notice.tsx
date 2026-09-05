import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useState, useSyncExternalStore } from 'react'
import type { AmphoreusClientModel } from './state.ts'
import type { SuiteNoticeStore } from './suite-notice-store.ts'
import css from './suite-notice.module.css'

export interface SuiteNoticeInjected {
  readonly store: SuiteNoticeStore
  readonly model: Pick<AmphoreusClientModel, 'reparse'>
  readonly portalOpen: () => boolean
  readonly subscribePortal: (listener: () => void) => () => void
}

export type SuiteNoticeBannerProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'amphoreus'>
  & SuiteNoticeInjected

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Truthful suite-change banner. The host re-parses live; only sessions whose
 * card was already injected lag (until /clear, resume or a new session), and a
 * genuine restart is needed only when the suite root was missing at startup.
 */
export function SuiteNoticeBanner({ store, model, portalOpen, subscribePortal, t }: SuiteNoticeBannerProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const portalIsOpen = useSyncExternalStore(subscribePortal, portalOpen)
  const [busy, setBusy] = useState(false)
  // Keyed to the notice so a failure reported for one notice never lingers under the next.
  const [error, setError] = useState<{ readonly id: string; readonly message: string }>()
  const notice = snapshot.active

  if (notice === undefined || portalIsOpen) return null
  const errorText = error?.id === notice.id ? error.message : undefined

  // Reparse is a no-op on the host when no watcher exists (root missing when the resolver started).
  const canReparse = (notice.kind === 'degraded' || notice.kind === 'missing') && !snapshot.startedMissing
  const showStale = notice.kind !== 'missing' && notice.staleSessions > 0
  const headline = notice.kind === 'updated'
    ? t('suite.updated', { label: notice.label })
    : notice.kind === 'degraded'
      ? t('suite.degraded', { n: notice.diagnosticsCount })
      : notice.kind === 'missing'
        ? t('suite.missing')
        : t('suite.recovered', { label: notice.label })

  const reparse = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      await model.reparse()
    } catch (reparseError) {
      setError({ id: notice.id, message: errorMessage(reparseError) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={css.banner}
      role="status"
      aria-live="polite"
      aria-busy={busy}
      data-kind={notice.kind}
      data-amphoreus-suite-notice=""
    >
      <div className={css.copy}>
        <strong>{headline}</strong>
        {showStale && <span className={css.hint}>{t('suite.sessionsStale', { n: notice.staleSessions })}</span>}
        {snapshot.startedMissing && <span className={css.restart}>{t('suite.restartHint')}</span>}
        {errorText === undefined ? null : <span className={css.error}>{errorText}</span>}
      </div>
      <div className={css.actions}>
        {canReparse && (
          <button type="button" className={css.primary} disabled={busy} onClick={() => { void reparse() }}>
            {busy ? t('suite.reparsing') : t('suite.reparse')}
          </button>
        )}
        <button type="button" onClick={() => store.dismiss(notice.id)}>{t('suite.dismiss')}</button>
      </div>
    </div>
  )
}
