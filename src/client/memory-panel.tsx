import { useState, type CSSProperties } from 'react'
import { SEAT_NOTE_MAX_CHARS, type MemoryPublicConfig, type MemorySettings } from '../shared/api.ts'
import { countPoints, effectiveSeatMemory } from './memory-model.ts'
import type { MemoryRecord } from '../host/store.ts'
import type { AmphoreusKey } from './locales.ts'
import { seatColorOf } from './seat-model.ts'
import css from './memory-panel.module.css'
import shell from './settings.module.css'

type Translate = (key: AmphoreusKey, params?: Record<string, unknown>) => string

export interface MemoryPanelSeat {
  readonly skillName: string
  readonly displayName: string
}

export interface MemoryPanelProps {
  /** Deployed seats in display order; seats with notes but no seat record are appended. */
  readonly seats: readonly MemoryPanelSeat[]
  readonly memory: readonly MemoryRecord[]
  readonly config: MemoryPublicConfig
  readonly busy: boolean
  readonly t: Translate
  readonly onAdd: (skill: string, text: string) => void
  readonly onDelete: (skill: string, id: string) => void
  readonly onSettings: (skill: string, patch: Partial<MemorySettings>) => void
}

/**
 * Settings panel: one collapsible row per seat listing its saved notes (author badge, delete),
 * a textarea to add a Trailblazer note (live counter against the shared cap), and the seat's
 * three memory switches. Every write goes through append / delete / patch routes, never a
 * whole-record replace, so a concurrent seat note cannot be lost from here.
 */
export function MemoryPanel({ seats, memory, config, busy, t, onAdd, onDelete, onSettings }: MemoryPanelProps) {
  const [open, setOpen] = useState<string | undefined>(undefined)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const bySkill = new Map(memory.map(record => [record.skillName, record]))
  const known = new Set(seats.map(seat => seat.skillName))
  const rows: MemoryPanelSeat[] = [
    ...seats,
    ...memory.filter(record => !known.has(record.skillName) && record.notes.length > 0)
      .map(record => ({ skillName: record.skillName, displayName: record.skillName })),
  ]
  const total = memory.reduce((sum, record) => sum + record.notes.length, 0)

  const row = (seat: MemoryPanelSeat) => {
    const record = bySkill.get(seat.skillName)
    const notes = record?.notes ?? []
    const effective = effectiveSeatMemory(config, record)
    const expanded = open === seat.skillName
    const draft = drafts[seat.skillName] ?? ''
    const length = countPoints(draft)
    const overflow = length > SEAT_NOTE_MAX_CHARS
    const color = seatColorOf(seat.skillName)
    const textareaId = `amphoreus-memory-${seat.skillName}`
    const submit = (): void => {
      const text = draft.trim()
      if (text === '' || overflow || busy) return
      onAdd(seat.skillName, text)
      setDrafts(current => ({ ...current, [seat.skillName]: '' }))
    }
    return (
      <li key={seat.skillName} className={css.row} style={{ '--amph-seat-accent': color.accent } as CSSProperties} data-expanded={expanded || undefined} data-amph-memory-seat={seat.skillName}>
        <div className={css.head}>
          <button type="button" className={css.toggle} aria-expanded={expanded} onClick={() => { setOpen(expanded ? undefined : seat.skillName) }}>
            <span className={css.name}>{seat.displayName}</span>
            <span className={css.count}>{t('settings.memoryCount', { n: String(notes.length) })}</span>
          </button>
          <label className={shell.switchRow} title={t('settings.memoryInjectTip')}>
            <input type="checkbox" role="switch" aria-checked={effective.inject} checked={effective.inject} disabled={busy}
              onChange={event => { onSettings(seat.skillName, { inject: event.currentTarget.checked }) }} />
            {t('settings.memoryInject')}
          </label>
          <label className={shell.switchRow} title={t('settings.memoryAutoNoteTip')}>
            <input type="checkbox" role="switch" aria-checked={effective.autoNote} checked={effective.autoNote} disabled={busy}
              onChange={event => { onSettings(seat.skillName, { autoNote: event.currentTarget.checked }) }} />
            {t('settings.memoryAutoNote')}
          </label>
        </div>
        {expanded ? (
          <div className={css.body}>
            {notes.length === 0
              ? <p className={css.empty}>{t('settings.memoryEmpty')}</p>
              : (
                <ul className={css.notes}>
                  {notes.map(note => (
                    <li key={note.id} className={css.note} data-author={note.author ?? 'legacy'}>
                      <span className={css.badge}>
                        {note.author === 'seat' ? t('settings.memoryAuthorSeat') : note.author === 'user' ? t('settings.memoryAuthorUser') : t('settings.memoryAuthorLegacy')}
                      </span>
                      <span className={css.text}>{note.text}</span>
                      <button type="button" className={css.remove} disabled={busy} aria-label={t('settings.memoryDelete')} onClick={() => { onDelete(seat.skillName, note.id) }}>
                        {t('settings.memoryDelete')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            <div className={css.compose}>
              <textarea
                id={textareaId}
                className={css.textarea}
                rows={2}
                value={draft}
                placeholder={t('settings.memoryPlaceholder')}
                disabled={busy}
                aria-invalid={overflow || undefined}
                onChange={event => { const value = event.currentTarget.value; setDrafts(current => ({ ...current, [seat.skillName]: value })) }}
                onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit() } }}
              />
              <div className={css.composeFoot}>
                <span className={css.counter} data-overflow={overflow || undefined} aria-live="polite">{length} / {SEAT_NOTE_MAX_CHARS}</span>
                <label className={css.limit}>
                  {t('settings.memoryInjectLimit')}
                  <input type="number" min={0} max={50} step={1} value={effective.injectLimit} disabled={busy}
                    onChange={event => {
                      const value = Number.parseInt(event.currentTarget.value, 10)
                      if (Number.isInteger(value) && value >= 0 && value <= 50) onSettings(seat.skillName, { injectLimit: value })
                    }} />
                </label>
                <button type="button" className={shell.secondaryButton} disabled={busy || draft.trim() === '' || overflow} onClick={submit}>
                  {t('settings.memoryAdd')}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </li>
    )
  }

  return (
    <section className={shell.panel} aria-labelledby="amphoreus-memory" data-amph-memory-panel="">
      <div className={shell.sectionHeading}>
        <div>
          <h2 id="amphoreus-memory">{t('settings.memoryHeading')}</h2>
          <p>{t('settings.memoryHint')}</p>
        </div>
        <span className={shell.index}>{String(total).padStart(2, '0')}</span>
      </div>
      <ul className={css.list}>{rows.map(row)}</ul>
      <p className={shell.hintLine}>{t('settings.memoryCommandHint', { command: config.command })}</p>
    </section>
  )
}
