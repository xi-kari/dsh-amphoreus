import { useEffect, useRef, useState } from 'react'
import { CODE_BACKGROUND_DEFAULTS, type CodeBackgroundPrefs } from '../shared/code-background.ts'
import type { AmphoreusKey } from './locales.ts'
import css from './settings.module.css'

export interface CodeBackgroundPanelProps {
  readonly prefs: CodeBackgroundPrefs
  readonly busy: boolean
  readonly t: (key: AmphoreusKey) => string
  readonly onPatch: (patch: Partial<CodeBackgroundPrefs> | null) => void
}

export function CodeBackgroundPanel({ prefs, busy, t, onPatch }: CodeBackgroundPanelProps) {
  const [draft, setDraft] = useState(prefs)
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef<Partial<CodeBackgroundPrefs>>({})
  useEffect(() => { setDraft(prefs) }, [prefs])
  useEffect(() => () => { if (timer.current !== undefined) window.clearTimeout(timer.current) }, [])
  const cancelPending = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current)
    timer.current = undefined
    pending.current = {}
  }
  const commit = (patch: Partial<CodeBackgroundPrefs>) => {
    pending.current = { ...pending.current, ...patch }
    setDraft(current => ({ ...current, ...patch }))
    if (timer.current !== undefined) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      const batch = pending.current
      pending.current = {}
      onPatch(batch)
    }, 180)
  }
  return <section className={css.panel} aria-labelledby="amphoreus-code-background-heading" data-amph-code-background-settings="">
    <div className={css.sectionHeading}><div>
      <h2 id="amphoreus-code-background-heading">{t('settings.codeBackgroundHeading')}</h2>
      <p>{t('settings.codeBackgroundHint')}</p>
    </div>
      <label className={css.switchRow} htmlFor="amphoreus-code-background-enabled">
        <input id="amphoreus-code-background-enabled" type="checkbox" role="switch" checked={draft.enabled} aria-checked={draft.enabled}
          disabled={busy} onChange={event => commit({ enabled: event.currentTarget.checked })} />
        <span>{t('settings.codeBackgroundEnabled')}</span>
      </label>
    </div>
    <div className={css.sliderList}>
      <div className={css.sliderRow}>
        <label htmlFor="amphoreus-code-background-intensity">{t('settings.codeBackgroundIntensity')}</label>
        <input id="amphoreus-code-background-intensity" type="range" min={0} max={100} step={5} value={Math.round(draft.intensity * 100)}
          disabled={busy || !draft.enabled} aria-describedby="amphoreus-code-background-motion"
          onChange={event => {
            const value = Number(event.currentTarget.value)
            if (Number.isFinite(value)) commit({ intensity: Math.max(0, Math.min(100, value)) / 100 })
          }} />
        <output htmlFor="amphoreus-code-background-intensity">{Math.round(draft.intensity * 100)}%</output>
      </div>
      <label className={css.switchRow} htmlFor="amphoreus-code-background-interactive">
        <input id="amphoreus-code-background-interactive" type="checkbox" role="switch" checked={draft.interactive} aria-checked={draft.interactive}
          disabled={busy || !draft.enabled} onChange={event => commit({ interactive: event.currentTarget.checked })} />
        <span>{t('settings.codeBackgroundInteractive')}</span>
      </label>
    </div>
    <p id="amphoreus-code-background-motion" className={css.hintLine}>{t('settings.codeBackgroundMotion')}</p>
    <button type="button" className={css.linkButton} disabled={busy} onClick={() => {
      cancelPending()
      setDraft(CODE_BACKGROUND_DEFAULTS)
      onPatch(null)
    }}>{t('settings.codeBackgroundReset')}</button>
  </section>
}
