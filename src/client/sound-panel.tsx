import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { SEAT_SOUND_DEFAULTS, type SeatSoundInfo, type SeatSoundPrefs, type SeatSoundPrefsPatch, type SeatSoundSlot } from '../shared/api.ts'
import { HERO_VISUALS, type HeroVisual } from '../shared/heroes.ts'
import type { AmphoreusKey } from './locales.ts'
import { seatColorOf } from './seat-model.ts'
import { mergeSeatSoundPatch, slotsForHero } from './seat-sounds.ts'
import css from './settings.module.css'
import own from './sound-panel.module.css'

type Translate = (key: AmphoreusKey, params?: Record<string, unknown>) => string

export interface SoundPanelProps {
  readonly seatSounds: readonly SeatSoundInfo[]
  readonly master: boolean
  readonly seatNames: ReadonlyMap<string, string>
  readonly busy: boolean
  readonly t: Translate
  readonly onUpload: (heroId: string, slot: SeatSoundSlot, file: File) => void
  readonly onRemove: (heroId: string, slot: SeatSoundSlot) => void
  readonly onPrefs: (patch: SeatSoundPrefsPatch) => void
  /** Preview from a click (a user gesture, so the autoplay policy allows it). */
  readonly onPreview: (url: string, volume: number) => void
}

/** Accept list mirrors the host MIME map; extensions cover browsers that report an empty File.type. */
export const SEAT_SOUND_ACCEPT = 'audio/mpeg,audio/ogg,audio/wav,audio/x-wav,audio/webm,audio/mp4,audio/aac,audio/flac,.mp3,.ogg,.wav,.webm,.m4a,.aac,.flac'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Settings panel: master switch, then one row per seat with a greeting slot and a
 * send slot. Each slot: upload / replace / remove, enabled toggle, debounced volume
 * slider, and a preview button. Files are user uploads only — nothing ships.
 */
export function SoundPanel({ seatSounds, master, seatNames, busy, t, onUpload, onRemove, onPrefs, onPreview }: SoundPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, number>>({})
  const timers = useRef(new Map<string, number>())
  const inputs = useRef(new Map<string, HTMLInputElement | null>())
  const byKey = new Map(seatSounds.map(item => [`${item.heroId}/${item.slot}`, item]))
  // Pref writes that land while the settings action lock is busy would be dropped by `run`; hold and flush them instead.
  const queued = useRef<SeatSoundPrefsPatch | undefined>(undefined)
  const busyRef = useRef(busy)
  busyRef.current = busy
  const emitPrefs = (patch: SeatSoundPrefsPatch): void => {
    // Read the ref: the debounce timer below fires from a closure taken before `busy` may have flipped.
    if (busyRef.current) queued.current = mergeSeatSoundPatch(queued.current, patch)
    else onPrefs(patch)
  }
  useEffect(() => {
    if (busy || queued.current === undefined) return
    const patch = queued.current
    queued.current = undefined
    onPrefs(patch)
  }, [busy, onPrefs])

  const setVolume = (heroId: string, slot: SeatSoundSlot, volume: number): void => {
    const key = `${heroId}/${slot}`
    setDrafts(current => ({ ...current, [key]: volume }))
    const pending = timers.current.get(key)
    if (pending !== undefined) window.clearTimeout(pending)
    timers.current.set(key, window.setTimeout(() => {
      timers.current.delete(key)
      setDrafts(current => {
        const value = current[key]
        if (value !== undefined) emitPrefs({ seats: { [heroId]: { [slot]: { volume: value } } } })
        const { [key]: _drop, ...rest } = current
        return rest
      })
    }, 200))
  }

  const slotRow = (hero: HeroVisual, slot: SeatSoundSlot) => {
    const key = `${hero.heroId}/${slot}`
    const info = byKey.get(key)
    const prefs: SeatSoundPrefs = { ...SEAT_SOUND_DEFAULTS, ...info?.prefs, ...(drafts[key] === undefined ? {} : { volume: drafts[key] }) }
    const inputId = `amphoreus-snd-${hero.heroId}-${slot}`
    const percent = Math.round(prefs.volume * 100)
    return (
      <div key={slot} className={own.slotRow} aria-disabled={!master || undefined} data-slot={slot}>
        <span className={own.slotName}>{t(slot === 'greeting' ? 'settings.soundGreeting' : 'settings.soundSend')}</span>
        <span className={own.slotMeta}>{info === undefined ? t('settings.soundNone') : `${info.mime.replace(/^audio\//u, '').toUpperCase()} · ${formatBytes(info.bytes)}`}</span>
        <span className={own.slotActions}>
          <input
            id={inputId}
            ref={element => { inputs.current.set(key, element) }}
            className={css.wpFile}
            type="file"
            accept={SEAT_SOUND_ACCEPT}
            disabled={busy}
            onChange={event => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file !== undefined) onUpload(hero.heroId, slot, file)
            }}
          />
          <button className={css.secondaryButton} type="button" disabled={busy} onClick={() => inputs.current.get(key)?.click()}>
            {info === undefined ? t('settings.soundUpload') : t('settings.soundReplace')}
          </button>
          {info !== undefined && (
            <>
              <button className={css.linkButton} type="button" disabled={busy} onClick={() => onPreview(info.url, prefs.volume)}>
                {t('settings.soundPreview')}
              </button>
              <label className={css.switchRow}>
                <input type="checkbox" checked={prefs.enabled} disabled={busy} onChange={event => emitPrefs({ seats: { [hero.heroId]: { [slot]: { enabled: event.currentTarget.checked } } } })} />
                <span>{t('settings.soundEnabled')}</span>
              </label>
              <span className={own.volume}>
                <label htmlFor={`${inputId}-vol`}>{t('settings.soundVolume')}</label>
                <input id={`${inputId}-vol`} type="range" min={0} max={1} step={0.05} value={prefs.volume} disabled={busy} onChange={event => setVolume(hero.heroId, slot, Number(event.currentTarget.value))} />
                <output>{percent}%</output>
              </span>
              <button className={css.linkButton} type="button" disabled={busy} onClick={() => onRemove(hero.heroId, slot)}>
                {t('settings.soundRemove')}
              </button>
            </>
          )}
        </span>
      </div>
    )
  }

  const row = (hero: HeroVisual) => {
    const color = seatColorOf(hero.skill)
    const has = slotsForHero(hero.heroId).some(slot => byKey.has(`${hero.heroId}/${slot}`))
    return (
      <li key={hero.heroId} className={css.wpRow} style={{ '--amph-seat-accent': color.accent } as CSSProperties} data-has-custom={has || undefined}>
        <div className={css.wpHead}>
          <span className={css.wpName}>{seatNames.get(hero.skill) ?? hero.heroId}</span>
        </div>
        <div className={own.slots}>{slotsForHero(hero.heroId).map(slot => slotRow(hero, slot))}</div>
      </li>
    )
  }

  return (
    <section className={css.panel} aria-labelledby="amphoreus-sounds" data-amph-sound-panel="">
      <div className={css.sectionHeading}>
        <div>
          <h2 id="amphoreus-sounds">{t('settings.soundHeading')}</h2>
          <p>{t('settings.soundHint')}</p>
        </div>
        <span className={css.index}>{String(seatSounds.length).padStart(2, '0')}</span>
      </div>
      <div className={own.masterRow}>
        <label className={css.switchRow}>
          <input type="checkbox" checked={master} disabled={busy} onChange={event => emitPrefs({ master: event.currentTarget.checked })} />
          <span>{master ? t('settings.soundMasterOn') : t('settings.soundMasterOff')}</span>
        </label>
        <span className={css.index}>{t('settings.soundFormats')}</span>
      </div>
      <ul className={css.wpList}>{HERO_VISUALS.map(row)}</ul>
    </section>
  )
}
