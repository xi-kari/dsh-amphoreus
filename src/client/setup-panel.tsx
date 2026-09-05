/**
 * Settings sub-panel for the assets folder: shows where the effective root comes from
 * and the last self-check digest; buttons reopen the wizard, re-run the check, or
 * drop the saved override back to cordis.patch.yml. Keeps its own pending state so the
 * shared settings action union stays untouched.
 */
import { useRef, useState } from 'react'
import type { AmphoreusAssetsStatus } from '../shared/api.ts'
import type { AmphoreusKey } from './locales.ts'
import { digestCheck } from './setup-store.ts'
import css from './settings.module.css'

type Translate = (key: AmphoreusKey, params?: Record<string, unknown>) => string

export interface SetupPanelProps {
  readonly assets: AmphoreusAssetsStatus
  readonly busy: boolean
  readonly t: Translate
  readonly onOpenWizard: () => void
  readonly onRecheck: () => Promise<void>
  readonly onResetRoot: () => Promise<void>
}

export function SetupPanel({ assets, busy, t, onOpenWizard, onRecheck, onResetRoot }: SetupPanelProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const lock = useRef(false)
  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (lock.current) return
    lock.current = true
    setPending(true)
    setError(undefined)
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      lock.current = false
      setPending(false)
    }
  }
  const disabled = busy || pending
  const digest = assets.check === undefined ? undefined : digestCheck(assets.check, 3)
  const sourceLabel = assets.rootSource === 'prefs'
    ? t('setup.rootFromPrefs')
    : assets.rootSource === 'config' ? t('setup.rootFromConfig') : t('setup.currentRootNone')

  return (
    <section className={css.panel} aria-labelledby="amphoreus-setup">
      <div className={css.sectionHeading}><div><h2 id="amphoreus-setup">{t('setup.settingsHeading')}</h2><p>{t('setup.settingsHint')}</p></div></div>
      <dl className={css.factList}>
        <div><dt>{t('setup.rootSource')}</dt><dd>{sourceLabel}</dd></div>
        <div>
          <dt>{t('setup.checkSummary')}</dt>
          <dd>
            {digest === undefined
              ? t('setup.checkNone')
              : t('setup.checkLine', {
                  ok: String(digest.requiredOk),
                  total: String(digest.requiredTotal),
                  optOk: String(digest.optionalOk),
                  optTotal: String(digest.optionalTotal),
                  home: String(digest.homePopulated),
                  homeTotal: String(digest.homeTotal),
                })}
            {digest !== undefined && digest.missingRequired.length > 0 && (
              <ul className={css.diagnosticList}>
                {digest.missingRequired.map(path => <li key={path} data-severity="warn"><code>{path}</code></li>)}
              </ul>
            )}
          </dd>
        </div>
      </dl>
      <div className={css.heroActions}>
        <button className={css.secondaryButton} type="button" disabled={disabled} onClick={onOpenWizard}>{t('setup.changeRoot')}</button>
        <button className={css.secondaryButton} type="button" disabled={disabled || assets.root === ''} onClick={() => { void run(onRecheck) }}>{pending ? t('setup.checking') : t('setup.recheck')}</button>
        {assets.rootSource === 'prefs' && (
          <button className={css.linkButton} type="button" disabled={disabled} onClick={() => { void run(onResetRoot) }}>{t('setup.resetRoot')}</button>
        )}
      </div>
      {error !== undefined && <p className={css.hintLine} role="alert">{error}</p>}
    </section>
  )
}
