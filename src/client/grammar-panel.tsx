import { useEffect, useRef, useState } from 'react'
import { GRAMMAR_DEFAULTS, GRAMMAR_LIMITS, type GrammarPrefs } from '../shared/api.ts'
import type { AmphoreusKey } from './locales.ts'
import css from './settings.module.css'

type Translate = (key: AmphoreusKey, params?: Record<string, unknown>) => string

export interface GrammarPanelProps {
  readonly grammar: GrammarPrefs
  readonly busy: boolean
  readonly t: Translate
  readonly onPatch: (patch: Partial<GrammarPrefs> | null) => void
}

type SliderKey = keyof typeof GRAMMAR_LIMITS

const SLIDERS: readonly { key: SliderKey; label: AmphoreusKey; format: (value: number) => string }[] = [
  { key: 'blurScale', label: 'settings.grammarBlur', format: value => `×${value.toFixed(1)}` },
  { key: 'frostScale', label: 'settings.grammarFrost', format: value => `×${value.toFixed(2)}` },
  { key: 'scrimBoost', label: 'settings.grammarScrim', format: value => `+${Math.round(value * 100)}%` },
  { key: 'motifScale', label: 'settings.grammarMotif', format: value => `${Math.round(value * 100)}%` },
]

/**
 * Settings sub-panel for the seat visual grammar. Sliders update a local
 * preview value immediately and persist debounced (one PUT per slider release
 * cadence), so dragging never floods the host.
 */
export function GrammarPanel({ grammar, busy, t, onPatch }: GrammarPanelProps) {
  const [draft, setDraft] = useState<GrammarPrefs>(grammar)
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef<Partial<GrammarPrefs>>({})
  useEffect(() => { setDraft(grammar) }, [grammar])
  useEffect(() => () => { if (timer.current !== undefined) window.clearTimeout(timer.current) }, [])

  const commit = (patch: Partial<GrammarPrefs>): void => {
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
  const isDefault = (Object.keys(GRAMMAR_DEFAULTS) as (keyof GrammarPrefs)[]).every(key => draft[key] === GRAMMAR_DEFAULTS[key])

  return (
    <section className={css.panel} aria-labelledby="amphoreus-grammar" data-amph-grammar-panel="">
      <div className={css.sectionHeading}>
        <div>
          <h2 id="amphoreus-grammar">{t('settings.grammarHeading')}</h2>
          <p>{t('settings.grammarHint')}</p>
        </div>
        <label className={css.switchRow}>
          <input
            type="checkbox"
            role="switch"
            aria-checked={draft.enabled}
            checked={draft.enabled}
            disabled={busy}
            onChange={event => commit({ enabled: event.currentTarget.checked })}
          />
          <span>{draft.enabled ? t('settings.grammarOn') : t('settings.grammarOff')}</span>
        </label>
      </div>
      <div className={css.sliderList} aria-disabled={!draft.enabled || undefined}>
        {SLIDERS.map(({ key, label, format }) => {
          const limit = GRAMMAR_LIMITS[key]
          const id = `amphoreus-grammar-${key}`
          return (
            <div key={key} className={css.sliderRow}>
              <label htmlFor={id}>{t(label)}</label>
              <input
                id={id}
                type="range"
                min={limit.min}
                max={limit.max}
                step={limit.step}
                value={draft[key]}
                disabled={busy || !draft.enabled}
                onChange={event => commit({ [key]: Number(event.currentTarget.value) } as Partial<GrammarPrefs>)}
              />
              <output htmlFor={id}>{format(draft[key])}</output>
            </div>
          )
        })}
      </div>
      <div className={css.segmented} role="radiogroup" aria-label={t('settings.grammarMascot')}>
        {(['reactive', 'static', 'off'] as const).map(mode => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={draft.mascot === mode}
            className={css.segment}
            disabled={busy || !draft.enabled}
            onClick={() => commit({ mascot: mode })}
          >
            {t(`settings.grammarMascot.${mode}` as AmphoreusKey)}
          </button>
        ))}
      </div>
      <p className={css.hintLine}>
        <label className={css.switchRow}>
          <input
            type="checkbox"
            checked={draft.ambient}
            disabled={busy || !draft.enabled}
            onChange={event => commit({ ambient: event.currentTarget.checked })}
          />
          <span>{t('settings.grammarAmbient')}</span>
        </label>
        {isDefault
          ? null
          : <button type="button" className={css.linkButton} disabled={busy} onClick={() => onPatch(null)}>{t('settings.grammarReset')}</button>}
      </p>
    </section>
  )
}
