import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useRef, useState, useSyncExternalStore } from 'react'
import { GrammarPanel } from './grammar-panel.tsx'
import type { AmphoreusClientModel } from './state.ts'
import css from './settings.module.css'

export interface AmphoreusSettingsInjected {
  readonly model: AmphoreusClientModel
}

export type AmphoreusSettingsProps = PropsRuntime<'settings.section'> & PropsLocale<'amphoreus'> & AmphoreusSettingsInjected

type SettingsAction = 'reparse' | 'magazine-light' | 'magazine-full' | 'magazine-reset' | 'derive' | 'derive-force' | 'grammar'

export function AmphoreusSettings({ model, t }: AmphoreusSettingsProps) {
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const [actionError, setActionError] = useState<string>()
  const [activeAction, setActiveAction] = useState<SettingsAction>()
  const actionLock = useRef(false)
  const run = async (action: SettingsAction, operation: () => Promise<void>): Promise<void> => {
    if (actionLock.current) return
    actionLock.current = true
    setActionError(undefined)
    setActiveAction(action)
    try {
      await operation()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      actionLock.current = false
      setActiveAction(undefined)
    }
  }

  if (snapshot.phase === 'loading') {
    return (
      <section className={css.page} aria-busy="true">
        <header className={css.hero}>
          <p className={css.eyebrow}>{t('settings.eyebrow')}</p>
          <h1>{t('settings.loading')}</h1>
          <span className={css.skeleton} />
        </header>
      </section>
    )
  }

  if (snapshot.phase === 'error' || snapshot.state === undefined) {
    return (
      <section className={css.page}>
        <header className={css.hero} data-level="L3">
          <p className={css.eyebrow}>{t('settings.eyebrow')}</p>
          <h1>{t('settings.error')}</h1>
          <p className={css.subtitle}>{snapshot.error}</p>
          <button className={css.primaryButton} type="button" onClick={() => { void model.refresh() }}>{t('settings.retry')}</button>
        </header>
      </section>
    )
  }

  const state = snapshot.state
  const suite = state.suite
  const wb = state.effectiveConfig.workbench
  const wbState = state.workbench
  const level = suite?.level ?? 'L3'
  const deployed = state.seats.filter(seat => seat.status === 'deployed').length
  const diagnostics = suite?.diagnostics ?? []
  const statusLabel = level === 'L0' ? t('settings.ready') : level === 'L3' ? t('settings.missing') : t('settings.degraded')
  const busy = activeAction !== undefined || snapshot.refreshing
  const deriving = state.assets.running || activeAction === 'derive' || activeAction === 'derive-force'
  const deriveDisabled = busy || state.assets.running || state.assets.root === '' || state.assets.magick === null

  return (
    <section className={css.page} data-amph-console="">
      <header className={css.hero} data-level={level}>
        <div className={css.heroCopy}>
          <p className={css.eyebrow}>{t('settings.eyebrow')}</p>
          <div className={css.titleLine}>
            <h1>{t('settings.title')}</h1>
            <span className={css.status}><i aria-hidden="true" />{statusLabel}</span>
          </div>
          <p className={css.subtitle}>{t('settings.subtitle')}</p>
        </div>
        <div className={css.heroActions}>
          <button className={css.primaryButton} type="button" disabled={busy} onClick={() => { void run('reparse', () => model.reparse()) }}>
            {activeAction === 'reparse' ? t('settings.reparsing') : t('settings.reparse')}
          </button>
        </div>
        {actionError === undefined ? null : <p className={css.actionError} role="alert">{actionError}</p>}
      </header>

      <div className={css.metrics} aria-label={t('settings.title')}>
        <Metric label={t('settings.cards')} value={String(suite?.cards.length ?? 0)} />
        <Metric label={t('settings.seats')} value={String(deployed)} />
        <Metric label={t('settings.generation')} value={String(state.revision)} />
        <Metric label={t('settings.version')} value={suite?.fingerprint?.label ?? '—'} mono />
      </div>

      <div className={css.contentGrid}>
        <div className={css.mainColumn}>
          <section className={css.panel} aria-labelledby="amphoreus-seat-directory">
            <div className={css.sectionHeading}>
              <div>
                <h2 id="amphoreus-seat-directory">{t('settings.cardsHeading')}</h2>
                <p>{t('settings.cardsHint')}</p>
              </div>
              <span className={css.index}>{String(suite?.cards.length ?? 0).padStart(2, '0')} / 13</span>
            </div>
            <ol className={css.cardList}>
              {(suite?.cards ?? []).map((card, index) => (
                <li key={card.name} className={css.cardRow}>
                  <span className={css.ordinal}>{String(card.ordinal ?? index + 1).padStart(2, '0')}</span>
                  <span className={css.cardIdentity}>
                    <strong>{card.displayName}</strong>
                    <code>{card.name}</code>
                  </span>
                  <span className={css.duties}>{card.duties.length === 0 ? t('settings.noDuty') : card.duties.join(' · ')}</span>
                  <span className={css.policy} data-relaxed={card.modelInvocable || undefined}>
                    {card.modelInvocable ? t('settings.modelCallable') : t('settings.userOnly')}
                  </span>
                  {card.hasPersona ? null : <span className={css.warning}>{t('settings.personaMissing')}</span>}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className={css.sideColumn}>
          <section className={css.panel} aria-labelledby="amphoreus-runtime">
            <div className={css.sectionHeading}>
              <h2 id="amphoreus-runtime">{t('settings.root')}</h2>
            </div>
            <dl className={css.factList}>
              <div><dt>{t('settings.root')}</dt><dd><code>{suite?.root?.canonical ?? '—'}</code></dd></div>
              <div><dt>{t('settings.updated')}</dt><dd>{formatTime(suite?.parsedAt)}</dd></div>
              <div><dt>Parser</dt><dd>v{suite?.parserVersion ?? '—'}</dd></div>
              <div><dt>Assets</dt><dd>{state.effectiveConfig.assetsConfigured ? t('settings.assetsReady') : t('settings.assetsMissing')}</dd></div>
            </dl>
          </section>

          <section className={css.panel} aria-labelledby="amphoreus-visual">
            <div className={css.sectionHeading}><div><h2 id="amphoreus-visual">{t('settings.visualHeading')}</h2><p>{t('settings.visualHint')}</p></div></div>
            <div className={css.segmented} role="radiogroup" aria-label={t('settings.magazineMode')}>
              {(['light', 'full'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={state.effectiveConfig.magazineMode === mode}
                  className={css.segment}
                  disabled={busy}
                  onClick={() => { void run(`magazine-${mode}`, () => model.setMagazineMode(mode)) }}
                >
                  {t(mode === 'light' ? 'settings.magazineLight' : 'settings.magazineFull')}
                </button>
              ))}
            </div>
            <p className={css.hintLine}>
              {state.effectiveConfig.magazineModeSource === 'prefs' ? t('settings.magazineFromPrefs') : t('settings.magazineFromConfig')}
              {state.effectiveConfig.magazineModeSource === 'prefs'
                ? <button type="button" className={css.linkButton} disabled={busy} onClick={() => { void run('magazine-reset', () => model.setMagazineMode(null)) }}>{t('settings.magazineReset')}</button>
                : null}
            </p>
            <dl className={css.factList}>
              <div><dt>assetsRoot</dt><dd><code>{state.assets.root === '' ? '—' : state.assets.root}</code></dd></div>
              <div><dt>{t('settings.assetsCache')}</dt><dd><code>{state.assets.cacheDir}</code><br />{t('settings.derivedCount', { n: String(state.assets.derivedCount) })}</dd></div>
              <div><dt>ImageMagick</dt><dd>{state.assets.magick ?? t('settings.magickMissing')}</dd></div>
            </dl>
            <div className={css.heroActions}>
              <button className={css.secondaryButton} type="button" disabled={deriveDisabled} onClick={() => { void run('derive', () => model.deriveAssets(false)) }}>{deriving ? t('settings.deriving') : t('settings.derive')}</button>
              <button className={css.linkButton} type="button" disabled={deriveDisabled} onClick={() => { void run('derive-force', () => model.deriveAssets(true)) }}>{t('settings.deriveForce')}</button>
            </div>
            {snapshot.deriveProgress !== undefined && state.assets.running
              ? <p className={css.hintLine} aria-live="polite" aria-atomic="true">{snapshot.deriveProgress.kind} {snapshot.deriveProgress.done}/{snapshot.deriveProgress.total} · {snapshot.deriveProgress.current}</p>
              : null}
            {state.assets.lastDerive === null
              ? null
              : <p className={css.hintLine}>{t('settings.lastDerive')} {formatTime(state.assets.lastDerive.at)} · {state.assets.lastDerive.written}/{state.assets.lastDerive.failed}{state.assets.lastDerive.error === undefined ? '' : ` · ${state.assets.lastDerive.error}`}</p>}
          </section>

          <GrammarPanel
            grammar={state.effectiveConfig.grammar}
            busy={busy}
            t={t}
            onPatch={patch => { void run('grammar', () => model.setGrammar(patch)) }}
          />

          <section className={css.panel} aria-labelledby="amphoreus-workbench">
            <div className={css.sectionHeading}><h2 id="amphoreus-workbench">{t('settings.workbenchHeading')}</h2></div>
            <dl className={css.factList}>
              <div><dt>{t('settings.workbenchStatus')}</dt><dd data-status={wbState.status.kind}>
                {wbState.status.kind === 'ready' ? t('settings.workbenchReady')
                  : wbState.status.kind === 'disabled' ? t('settings.workbenchDisabled')
                    : `${t('settings.workbenchUnavailable')}：${wbState.status.reason}`}
              </dd></div>
              <div><dt>{t('settings.workbenchHost')}</dt><dd><code>{wb.host}</code>{wb.host === 'native' ? ` — ${t('settings.workbenchHostNative')}` : ''}</dd></div>
              <div><dt>{t('settings.workbenchDefaultView')}</dt><dd>{wb.defaultView === 'workbench' ? t('settings.workbenchDefaultWorkbench') : t('settings.workbenchDefaultChat')}</dd></div>
              <div><dt>{t('settings.workbenchCardLimit')}</dt><dd>{wb.cardTextLimit}</dd></div>
            </dl>
            <div className={css.sectionHeading}><h2>{t('settings.workbenchUnprojectable')}</h2><span className={css.index}>{String(wbState.unprojectable.length).padStart(2, '0')}</span></div>
            {wbState.unprojectable.length === 0
              ? <p className={css.empty}>{t('settings.workbenchUnprojectableEmpty')}</p>
              : <ul className={css.diagnosticList}>{wbState.unprojectable.slice(0, 12).map(item => (
                  <li key={item.sessionId} data-severity="warn"><code>{item.sessionId}</code><span>{item.title ?? '—'} · {item.reason}</span></li>))}</ul>}
          </section>

          <section className={css.panel} aria-labelledby="amphoreus-diagnostics">
            <div className={css.sectionHeading}>
              <h2 id="amphoreus-diagnostics">{t('settings.diagnosticsHeading')}</h2>
              <span className={css.index}>{String(diagnostics.length).padStart(2, '0')}</span>
            </div>
            {diagnostics.length === 0
              ? <p className={css.empty}>{t('settings.diagnosticsEmpty')}</p>
              : (
                <ul className={css.diagnosticList}>
                  {diagnostics.slice(0, 12).map((diagnostic, index) => (
                    <li key={`${diagnostic.code}-${index}`} data-severity={diagnostic.severity}>
                      <code>{diagnostic.code}</code>
                      <span>{diagnostic.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
          </section>
        </aside>
      </div>
      <footer className={css.credit}>
        <span>{t('settings.credit')}</span>
        <a href="https://github.com/liangmianya/dsh-synapse" target="_blank" rel="noreferrer">github.com/liangmianya/dsh-synapse</a>
      </footer>
    </section>
  )
}

function Metric({ label, value, mono = false }: { readonly label: string; readonly value: string; readonly mono?: boolean }) {
  return (
    <div className={css.metric}>
      <span>{label}</span>
      <strong className={mono ? css.mono : undefined}>{value}</strong>
    </div>
  )
}

function formatTime(value: number | undefined): string {
  if (value === undefined || value <= 0) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}
