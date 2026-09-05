import { useRef, useState, type CSSProperties } from 'react'
import { CUSTOM_WALLPAPER_PLACEMENT_DEFAULTS, type CustomWallpaperInfo, type CustomWallpaperPlacement } from '../shared/api.ts'
import { HERO_VISUALS, type HeroVisual } from '../shared/heroes.ts'
import type { AmphoreusKey } from './locales.ts'
import { seatColorOf } from './seat-model.ts'
import css from './settings.module.css'

type Translate = (key: AmphoreusKey, params?: Record<string, unknown>) => string

export interface WallpaperPanelProps {
  readonly customWallpapers: readonly CustomWallpaperInfo[]
  readonly seatNames: ReadonlyMap<string, string>
  readonly busy: boolean
  readonly t: Translate
  readonly onUpload: (heroId: string, file: File) => void
  readonly onRemove: (heroId: string) => void
  readonly onPlacement: (heroId: string, patch: Partial<CustomWallpaperPlacement> | null) => void
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/apng,video/mp4,video/webm'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/**
 * Settings panel: one row per seat with upload / replace / remove of a custom home
 * wallpaper (any image or video the browser can read, no size cap), and — when one is
 * set — position, fit, zoom and, for videos, speed / mute / loop / pause. Placement
 * edits update the live wallpaper immediately (debounced PUT).
 */
export function WallpaperPanel({ customWallpapers, seatNames, busy, t, onUpload, onRemove, onPlacement }: WallpaperPanelProps) {
  const [open, setOpen] = useState<string | undefined>(undefined)
  const [drafts, setDrafts] = useState<Record<string, Partial<CustomWallpaperPlacement>>>({})
  const timers = useRef(new Map<string, number>())
  const inputs = useRef(new Map<string, HTMLInputElement | null>())
  const byHero = new Map(customWallpapers.map(item => [item.heroId, item]))

  const patch = (heroId: string, next: Partial<CustomWallpaperPlacement>): void => {
    setDrafts(current => ({ ...current, [heroId]: { ...current[heroId], ...next } }))
    const pending = timers.current.get(heroId)
    if (pending !== undefined) window.clearTimeout(pending)
    timers.current.set(heroId, window.setTimeout(() => {
      timers.current.delete(heroId)
      setDrafts(current => {
        const batch = current[heroId]
        if (batch !== undefined) onPlacement(heroId, batch)
        const { [heroId]: _drop, ...rest } = current
        return rest
      })
    }, 200))
  }

  const row = (hero: HeroVisual) => {
    const info = byHero.get(hero.heroId)
    const placement = { ...CUSTOM_WALLPAPER_PLACEMENT_DEFAULTS, ...info?.placement, ...drafts[hero.heroId] }
    const color = seatColorOf(hero.skill)
    const expanded = open === hero.heroId
    const inputId = `amphoreus-wp-${hero.heroId}`
    return (
      <li key={hero.heroId} className={css.wpRow} style={{ '--amph-seat-accent': color.accent } as CSSProperties} data-has-custom={info !== undefined || undefined}>
        <div className={css.wpHead}>
          <span className={css.wpName}>{seatNames.get(hero.skill) ?? hero.heroId}</span>
          <span className={css.wpMeta}>
            {info === undefined
              ? t('settings.wallpaperBuiltin')
              : `${info.kind === 'video' ? t('settings.wallpaperVideo') : t('settings.wallpaperImage')} · ${formatBytes(info.bytes)}`}
          </span>
          <input
            id={inputId}
            ref={element => { inputs.current.set(hero.heroId, element) }}
            className={css.wpFile}
            type="file"
            accept={ACCEPT}
            disabled={busy}
            onChange={event => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file !== undefined) onUpload(hero.heroId, file)
            }}
          />
          <button className={css.secondaryButton} type="button" disabled={busy} onClick={() => inputs.current.get(hero.heroId)?.click()}>
            {info === undefined ? t('settings.wallpaperUpload') : t('settings.wallpaperReplace')}
          </button>
          {info !== undefined && (
            <>
              <button className={css.linkButton} type="button" disabled={busy} aria-expanded={expanded} onClick={() => setOpen(expanded ? undefined : hero.heroId)}>
                {t('settings.wallpaperAdjust')}
              </button>
              <button className={css.linkButton} type="button" disabled={busy} onClick={() => onRemove(hero.heroId)}>
                {t('settings.wallpaperRemove')}
              </button>
            </>
          )}
        </div>
        {info !== undefined && expanded && (
          <div className={css.wpControls}>
            <div className={css.segmented} role="radiogroup" aria-label={t('settings.wallpaperFit')}>
              {(['cover', 'contain', 'fill'] as const).map(fit => (
                <button key={fit} type="button" role="radio" aria-checked={placement.fit === fit} className={css.segment} onClick={() => patch(hero.heroId, { fit })}>
                  {t(`settings.wallpaperFit.${fit}` as AmphoreusKey)}
                </button>
              ))}
            </div>
            <div className={css.sliderList}>
              <div className={css.sliderRow}>
                <label htmlFor={`${inputId}-x`}>{t('settings.wallpaperX')}</label>
                <input id={`${inputId}-x`} type="range" min={0} max={100} step={1} value={placement.x} onChange={event => patch(hero.heroId, { x: Number(event.currentTarget.value) })} />
                <output>{placement.x}%</output>
              </div>
              <div className={css.sliderRow}>
                <label htmlFor={`${inputId}-y`}>{t('settings.wallpaperY')}</label>
                <input id={`${inputId}-y`} type="range" min={0} max={100} step={1} value={placement.y} onChange={event => patch(hero.heroId, { y: Number(event.currentTarget.value) })} />
                <output>{placement.y}%</output>
              </div>
              <div className={css.sliderRow}>
                <label htmlFor={`${inputId}-scale`}>{t('settings.wallpaperScale')}</label>
                <input id={`${inputId}-scale`} type="range" min={1} max={3} step={0.05} value={placement.scale} onChange={event => patch(hero.heroId, { scale: Number(event.currentTarget.value) })} />
                <output>×{placement.scale.toFixed(2)}</output>
              </div>
              {info.kind === 'video' && (
                <div className={css.sliderRow}>
                  <label htmlFor={`${inputId}-rate`}>{t('settings.wallpaperRate')}</label>
                  <input id={`${inputId}-rate`} type="range" min={0.25} max={2} step={0.05} value={placement.playbackRate} onChange={event => patch(hero.heroId, { playbackRate: Number(event.currentTarget.value) })} />
                  <output>×{placement.playbackRate.toFixed(2)}</output>
                </div>
              )}
            </div>
            {info.kind === 'video' && (
              <p className={css.hintLine}>
                <label className={css.switchRow}><input type="checkbox" checked={!placement.paused} onChange={event => patch(hero.heroId, { paused: !event.currentTarget.checked })} /><span>{t('settings.wallpaperPlay')}</span></label>
                <label className={css.switchRow}><input type="checkbox" checked={placement.loop} onChange={event => patch(hero.heroId, { loop: event.currentTarget.checked })} /><span>{t('settings.wallpaperLoop')}</span></label>
                <label className={css.switchRow}><input type="checkbox" checked={!placement.muted} onChange={event => patch(hero.heroId, { muted: !event.currentTarget.checked })} /><span>{t('settings.wallpaperSound')}</span></label>
              </p>
            )}
            <p className={css.hintLine}>
              <button type="button" className={css.linkButton} onClick={() => onPlacement(hero.heroId, null)}>{t('settings.wallpaperResetPlacement')}</button>
            </p>
          </div>
        )}
      </li>
    )
  }

  return (
    <section className={css.panel} aria-labelledby="amphoreus-wallpapers" data-amph-wallpaper-panel="">
      <div className={css.sectionHeading}>
        <div>
          <h2 id="amphoreus-wallpapers">{t('settings.wallpaperHeading')}</h2>
          <p>{t('settings.wallpaperHint')}</p>
        </div>
        <span className={css.index}>{String(customWallpapers.length).padStart(2, '0')} / 13</span>
      </div>
      <ul className={css.wpList}>{HERO_VISUALS.map(row)}</ul>
    </section>
  )
}
