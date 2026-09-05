import { useEffect, useRef, useState } from 'react'
import type { AmphoreusKey } from './locales.ts'
import { reduceSchemeStatus, SCHEME_STATUS_IDLE, type SchemeAction } from './scheme-status.ts'
import css from './settings.module.css'

export type { SchemeAction } from './scheme-status.ts'

type Translate = (key: AmphoreusKey, params?: Record<string, unknown>) => string

export interface SchemePanelProps {
  /** Disables the controls (any action running or a refresh in flight). */
  readonly busy: boolean
  /** True while *any* settings action runs; clears a lingering success line. */
  readonly acting: boolean
  /** Which scheme action the settings page is currently running (drives the button labels). */
  readonly active: SchemeAction | undefined
  /** True when the page-level action line is showing an error (suppresses / clears the success line). */
  readonly errored: boolean
  readonly t: Translate
  readonly onExport: () => void
  readonly onImport: (file: File) => void
}

const ACCEPT = 'application/json,.json'

/**
 * Settings panel: export the stored visual prefs (magazine mode, grammar, wallpaper
 * placements) to a JSON file, or restore them from one. Wallpaper binaries are not part of
 * the file. The file input is visually hidden and triggered by the import button, like the
 * wallpaper panel. A success line appears once the running action has finished; failures
 * are surfaced by the page-level action error line, and the success line is suppressed then.
 * The line goes away again when another action starts or an error appears (see scheme-status.ts).
 */
export function SchemePanel({ busy, acting, active, errored, t, onExport, onImport }: SchemePanelProps) {
  const input = useRef<HTMLInputElement | null>(null)
  const [status, setStatus] = useState(SCHEME_STATUS_IDLE)

  useEffect(() => {
    setStatus(previous => reduceSchemeStatus(previous, { active, acting, errored }))
  }, [active, acting, errored])

  return (
    <section className={css.panel} aria-labelledby="amphoreus-scheme" data-amph-scheme-panel="">
      <div className={css.sectionHeading}>
        <div>
          <h2 id="amphoreus-scheme">{t('settings.schemeHeading')}</h2>
          <p>{t('settings.schemeHint')}</p>
        </div>
      </div>
      <input
        ref={input}
        className={css.wpFile}
        type="file"
        accept={ACCEPT}
        disabled={busy}
        tabIndex={-1}
        aria-label={t('settings.schemeImport')}
        onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file !== undefined) onImport(file)
        }}
      />
      <div className={css.heroActions}>
        <button className={css.secondaryButton} type="button" disabled={busy} onClick={onExport}>
          {active === 'export' ? t('settings.schemeExporting') : t('settings.schemeExport')}
        </button>
        <button className={css.secondaryButton} type="button" disabled={busy} onClick={() => input.current?.click()}>
          {active === 'import' ? t('settings.schemeImporting') : t('settings.schemeImport')}
        </button>
      </div>
      {status.done === undefined
        ? null
        : <p className={css.hintLine} role="status" aria-live="polite">{t(status.done === 'import' ? 'settings.schemeImported' : 'settings.schemeExported')}</p>}
    </section>
  )
}
