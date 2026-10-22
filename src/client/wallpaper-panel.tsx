import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { CUSTOM_WALLPAPER_PLACEMENT_DEFAULTS, type CustomWallpaperInfo, type CustomWallpaperPlacement } from '../shared/api.ts'
import { WALLPAPER_ACCEPT } from '../shared/wallpaper-media.ts'
import { HERO_VISUALS, type HeroVisual } from '../shared/heroes.ts'
import type { AmphoreusKey } from './locales.ts'
import { seatColorOf } from './seat-model.ts'
import { SegmentedChoice } from './segmented-choice.tsx'
import { ImagePreview, type ImagePreviewItem } from './image-preview.tsx'
import css from './settings.module.css'
import previewCss from './wallpaper-panel.module.css'

type Translate = (key: AmphoreusKey, params?: Record<string, unknown>) => string

export interface WallpaperPanelProps {
  readonly customWallpapers: readonly CustomWallpaperInfo[]
  readonly seatNames: ReadonlyMap<string, string>
  readonly busy: boolean
  readonly t: Translate
  readonly onUpload: (heroId: string, file: File) => void
  readonly onRemove: (heroId: string) => void
  readonly onPlacement: (heroId: string, patch: Partial<CustomWallpaperPlacement> | null) => boolean | void | Promise<boolean | void>
}

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
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Partial<CustomWallpaperPlacement>>>({})
  const timers = useRef(new Map<string, number>())
  const pending = useRef(new Map<string, Partial<CustomWallpaperPlacement> | null>())
  const busyRef = useRef(busy)
  const placement = useRef(onPlacement)
  const running = useRef(false)
  const alive = useRef(true)
  busyRef.current = busy
  placement.current = onPlacement
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      for (const timer of timers.current.values()) window.clearTimeout(timer)
      timers.current.clear()
      pending.current.clear()
    }
  }, [])
  const inputs = useRef(new Map<string, HTMLInputElement | null>())
  const byHero = new Map(customWallpapers.map(item => [item.heroId, item]))
  const previewItems: ImagePreviewItem[] = HERO_VISUALS.flatMap(hero => {
    const info = byHero.get(hero.heroId)
    return info !== undefined && info.kind !== 'video'
      ? [{ id: hero.heroId, url: info.url, label: seatNames.get(hero.skill) ?? hero.heroId }] : []
  })

  const drain = async (): Promise<void> => {
    if (!alive.current || busyRef.current || running.current) return
    const entry = [...pending.current].find(([heroId]) => !timers.current.has(heroId))
    if (entry === undefined) return
    const [heroId, batch] = entry
    running.current = true
    let accepted = false
    let refused = false
    try {
      const result = await placement.current(heroId, batch)
      accepted = result !== false
      refused = result === false
      if (accepted && alive.current && pending.current.get(heroId) === batch) {
        pending.current.delete(heroId)
        setDrafts(current => {
          const { [heroId]: _drop, ...rest } = current
          return rest
        })
      }
    } catch { /* The settings action owns the visible error; keep a refused draft available for retry. */ }
    finally {
      running.current = false
      if (accepted && alive.current) void drain()
      else if (refused && alive.current && !busyRef.current && !timers.current.has(heroId)) {
        timers.current.set(heroId, window.setTimeout(() => {
          timers.current.delete(heroId)
          void drain()
        }, 200))
      }
    }
  }
  useEffect(() => { if (!busy) void drain() }, [busy])

  const patch = (heroId: string, next: Partial<CustomWallpaperPlacement>): void => {
    const batch = { ...pending.current.get(heroId), ...next }
    pending.current.set(heroId, batch)
    setDrafts(current => ({ ...current, [heroId]: batch }))
    const timer = timers.current.get(heroId)
    if (timer !== undefined) window.clearTimeout(timer)
    timers.current.set(heroId, window.setTimeout(() => {
      timers.current.delete(heroId)
      void drain()
    }, 200))
  }
  const reset = (heroId: string): void => {
    const timer = timers.current.get(heroId)
    if (timer !== undefined) window.clearTimeout(timer)
    timers.current.delete(heroId)
    pending.current.set(heroId, null)
    setDrafts(current => ({ ...current, [heroId]: CUSTOM_WALLPAPER_PLACEMENT_DEFAULTS }))
    void drain()
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
            accept={WALLPAPER_ACCEPT}
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
        {info?.kind === 'video' && <video className={css.backgroundPreview} src={info.url} controls muted playsInline preload="metadata" aria-label={seatNames.get(hero.skill) ?? hero.heroId} />}
        {info !== undefined && info.kind !== 'video' && <button type="button" className={previewCss.thumbnail}
          aria-label={t('imagePreview.open', { name: seatNames.get(hero.skill) ?? hero.heroId })} onClick={() => setPreviewId(hero.heroId)}>
          <img src={info.url} alt={seatNames.get(hero.skill) ?? hero.heroId} loading="lazy" />
          <span>{t('imagePreview.enlarge')}</span>
        </button>}
        {info !== undefined && expanded && (
          <div className={css.wpControls}>
            <SegmentedChoice label={t('settings.wallpaperFit')} value={placement.fit} disabled={busy}
              choices={(['cover', 'contain', 'fill'] as const).map(value => ({ value, label: t(`settings.wallpaperFit.${value}` as AmphoreusKey) }))}
              onChange={fit => patch(hero.heroId, { fit })} />
            <div className={css.sliderList}>
              <div className={css.sliderRow}>
                <label htmlFor={`${inputId}-x`}>{t('settings.wallpaperX')}</label>
                <input id={`${inputId}-x`} type="range" min={0} max={100} step={1} value={placement.x} disabled={busy} onChange={event => patch(hero.heroId, { x: Number(event.currentTarget.value) })} />
                <output>{placement.x}%</output>
              </div>
              <div className={css.sliderRow}>
                <label htmlFor={`${inputId}-y`}>{t('settings.wallpaperY')}</label>
                <input id={`${inputId}-y`} type="range" min={0} max={100} step={1} value={placement.y} disabled={busy} onChange={event => patch(hero.heroId, { y: Number(event.currentTarget.value) })} />
                <output>{placement.y}%</output>
              </div>
              <div className={css.sliderRow}>
                <label htmlFor={`${inputId}-scale`}>{t('settings.wallpaperScale')}</label>
                <input id={`${inputId}-scale`} type="range" min={1} max={3} step={0.05} value={placement.scale} disabled={busy} onChange={event => patch(hero.heroId, { scale: Number(event.currentTarget.value) })} />
                <output>×{placement.scale.toFixed(2)}</output>
              </div>
              {info.kind === 'video' && (
                <div className={css.sliderRow}>
                  <label htmlFor={`${inputId}-rate`}>{t('settings.wallpaperRate')}</label>
                  <input id={`${inputId}-rate`} type="range" min={0.25} max={2} step={0.05} value={placement.playbackRate} disabled={busy} onChange={event => patch(hero.heroId, { playbackRate: Number(event.currentTarget.value) })} />
                  <output>×{placement.playbackRate.toFixed(2)}</output>
                </div>
              )}
            </div>
            {info.kind === 'video' && (
              <p className={css.hintLine}>
                <label className={css.switchRow}><input type="checkbox" checked={!placement.paused} disabled={busy} onChange={event => patch(hero.heroId, { paused: !event.currentTarget.checked })} /><span>{t('settings.wallpaperPlay')}</span></label>
                <label className={css.switchRow}><input type="checkbox" checked={placement.loop} disabled={busy} onChange={event => patch(hero.heroId, { loop: event.currentTarget.checked })} /><span>{t('settings.wallpaperLoop')}</span></label>
                <label className={css.switchRow}><input type="checkbox" checked={!placement.muted} disabled={busy} onChange={event => patch(hero.heroId, { muted: !event.currentTarget.checked })} /><span>{t('settings.wallpaperSound')}</span></label>
              </p>
            )}
            <p className={css.hintLine}>
              <button type="button" className={css.linkButton} disabled={busy} onClick={() => reset(hero.heroId)}>{t('settings.wallpaperResetPlacement')}</button>
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
        <span className={css.index}>{String(customWallpapers.filter(item => item.heroId !== 'global').length).padStart(2, '0')} / 13</span>
      </div>
      <ul className={css.wpList}>{HERO_VISUALS.map(row)}</ul>
      <ImagePreview items={previewItems} activeId={previewId} onActiveIdChange={setPreviewId} onClose={() => setPreviewId(null)} t={t} />
    </section>
  )
}
