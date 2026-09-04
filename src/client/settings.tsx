import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useState, useSyncExternalStore } from 'react'
import type { AmphoreusClientModel } from './state.ts'
import css from './settings.module.css'

export interface AmphoreusSettingsInjected {
  readonly model: AmphoreusClientModel
}

export type AmphoreusSettingsProps = PropsRuntime<'settings.section'> & PropsLocale<'amphoreus'> & AmphoreusSettingsInjected

export function AmphoreusSettings({ model, t }: AmphoreusSettingsProps) {
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const [actionError, setActionError] = useState<string>()
  const [reparsing, setReparsing] = useState(false)

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
  const reparse = async (): Promise<void> => {
    setActionError(undefined)
    setReparsing(true)
    try {
      await model.reparse()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setReparsing(false)
    }
  }

  return (
    <section className={css.page}>
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
          <button className={css.primaryButton} type="button" disabled={reparsing || snapshot.refreshing} onClick={() => { void reparse() }}>
            {reparsing ? t('settings.reparsing') : t('settings.reparse')}
          </button>
          {wb.enabled ? <a className={css.secondaryButton} href="/amphoreus/workbench/" target="_blank" rel="noreferrer">{t('settings.openWorkbench')}</a> : null}
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
