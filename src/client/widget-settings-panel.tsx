import { useEffect, useState } from 'react'
import type { WidgetPrefs } from '../shared/api.ts'
import type { AmphoreusKey } from './locales.ts'
import css from './settings.module.css'

export interface WidgetSettingsPanelProps {
  readonly prefs: WidgetPrefs
  readonly busy: boolean
  readonly refreshMs: number | undefined
  readonly t: (key: AmphoreusKey, params?: Record<string, unknown>) => string
  readonly onPatch: (patch: Partial<WidgetPrefs> | null) => void
}

export function widgetAutoHideSeconds(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(300, Math.round(number))) : undefined
}

export function WidgetSettingsPanel({ prefs, busy, refreshMs, t, onPatch }: WidgetSettingsPanelProps) {
  const [seconds, setSeconds] = useState(String(prefs.autoHideSeconds))
  useEffect(() => { setSeconds(String(prefs.autoHideSeconds)) }, [prefs.autoHideSeconds])
  const commitSeconds = () => {
    const next = widgetAutoHideSeconds(seconds)
    setSeconds(String(next ?? prefs.autoHideSeconds))
    if (next !== undefined && next !== prefs.autoHideSeconds) onPatch({ autoHideSeconds: next })
  }
  const switches = [
    ['enabled', 'settings.widgetEnabled'],
    ['allowTopDock', 'settings.widgetTopDock'],
    ['showTurnBubble', 'settings.widgetTurnBubble'],
  ] as const
  return <section className={css.panel} aria-labelledby="amphoreus-widget-settings" data-amph-widget-settings="">
    <div className={css.sectionHeading}><div>
      <h2 id="amphoreus-widget-settings">{t('settings.widgetHeading')}</h2>
      <p>{t('settings.widgetHint')}</p>
    </div></div>
    <div className={css.sliderList}>
      {switches.map(([key, label]) => <label key={key} className={css.switchRow} htmlFor={`amphoreus-widget-${key}`}>
        <input id={`amphoreus-widget-${key}`} type="checkbox" role="switch" checked={prefs[key]} aria-checked={prefs[key]}
          disabled={busy || (key !== 'enabled' && !prefs.enabled)} onChange={event => onPatch({ [key]: event.currentTarget.checked })} />
        <span>{t(label)}</span>
      </label>)}
      <label className={css.switchRow} htmlFor="amphoreus-widget-seconds">
        <span>{t('settings.widgetAutoHide')}</span>
        <input id="amphoreus-widget-seconds" type="number" inputMode="numeric" min={0} max={300} step={1}
          value={seconds} disabled={busy || !prefs.enabled || !prefs.showTurnBubble} aria-describedby="amphoreus-widget-seconds-hint"
          style={{ width: '6em', minHeight: 36, font: 'inherit', color: 'inherit', background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '4px 8px' }}
          onChange={event => setSeconds(event.currentTarget.value)} onBlur={commitSeconds}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitSeconds() } }} />
      </label>
    </div>
    <p id="amphoreus-widget-seconds-hint" className={css.hintLine}>
      {widgetAutoHideSeconds(seconds) === 0 ? t('settings.widgetPersistent') : t('settings.widgetSeconds', { n: widgetAutoHideSeconds(seconds) ?? prefs.autoHideSeconds })}
    </p>
    <p className={css.hintLine}>{refreshMs !== undefined && Number.isFinite(refreshMs) && refreshMs > 0
      ? t('settings.widgetRefresh', { seconds: Math.round(refreshMs / 1000) }) : t('settings.widgetRefreshUnknown')}</p>
    <p className={css.hintLine}>{t('settings.widgetRecording')}</p>
    <button type="button" className={css.linkButton} disabled={busy} onClick={() => onPatch(null)}>{t('settings.widgetReset')}</button>
  </section>
}
