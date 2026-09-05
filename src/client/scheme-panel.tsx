import { useEffect, useRef, useState } from 'react'
import type { AmphoreusKey } from './locales.ts'
import css from './settings.module.css'

type Translate = (key: AmphoreusKey, params?: Record<string, unknown>) => string

export type SchemeAction = 'export' | 'import'

export interface SchemePanelProps {
  readonly busy: boolean
  /** Which scheme action the settings page is currently running (drives the button labels). */
  readonly active: SchemeAction | undefined
  /** True when the page-level action line is showing an error (suppresses the success line). */
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
 */
export function SchemePanel({ busy, active, errored, t, onExport, onImport }: SchemePanelProps) {
  const input = useRef<HTMLInputElement | null>(null)
  const [done, setDone] = useState<SchemeAction | undefined>(undefined)
  const previous = useRef<SchemeAction | undefined>(undefined)

  useEffect(() => {
    if (active !== undefined) {
      previous.current = active
      setDone(undefined)
      return
    }
    if (previous.current !== undefined) {
      setDone(errored ? undefined : previous.current)
      previous.current = undefined
    }
  }, [active, errored])

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
      {done === undefined
        ? null
        : <p className={css.hintLine} role="status" aria-live="polite">{t(done === 'import' ? 'settings.schemeImported' : 'settings.schemeExported')}</p>}
    </section>
  )
}
