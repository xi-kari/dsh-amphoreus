import { useEffect, useState, type CSSProperties } from 'react'
import type { SeatRecord } from '../host/store.ts'
import { SEAT_PERMISSION_PRESETS, type SeatPreset } from '../shared/seat-preset.ts'
import type { AmphoreusKey } from './locales.ts'
import { seatColorOf } from './seat-model.ts'
import type { SeatPresetCatalog, SeatPresetDirectory, SeatPresetRosterRow } from './seat-preset-apply.ts'
import { encodeModelChoice, withTier, type SeatPresetTier } from './seat-preset-tiers.ts'
import css from './settings.module.css'
import own from './seat-preset-panel.module.css'

type Translate = (key: AmphoreusKey, params?: Record<string, unknown>) => string

export interface SeatPresetPanelProps {
  readonly seats: readonly SeatRecord[]
  readonly seatNames: ReadonlyMap<string, string>
  readonly directory: SeatPresetDirectory
  readonly busy: boolean
  readonly t: Translate
  /** Persists one seat's preset; the panel owns the saving / error state so it needs no settings-wide action name. */
  readonly onSave: (skillName: string, preset: SeatPreset | null) => Promise<void>
}

interface DirectoryState {
  readonly status: 'loading' | 'ready' | 'error'
  readonly presets: readonly SeatPresetRosterRow[]
  readonly catalog: SeatPresetCatalog | undefined
}

const PERMISSION_LABELS: Record<typeof SEAT_PERMISSION_PRESETS[number], AmphoreusKey> = {
  'read-only': 'settings.presetPermReadOnly',
  'workspace-write': 'settings.presetPermWorkspaceWrite',
  'danger-full-access': 'settings.presetPermDanger',
}

/**
 * Settings panel: one row per deployed, visible seat with three independent
 * selects — agent preset (roster), model (+ reasoning effort when the model
 * exposes efforts) and permission preset (fixed bundle table). "Default" means
 * the tier is unset and the platform default applies.
 */
export function SeatPresetPanel({ seats, seatNames, directory, busy, t, onSave }: SeatPresetPanelProps) {
  const [dir, setDir] = useState<DirectoryState>({ status: 'loading', presets: [], catalog: undefined })
  const [generation, setGeneration] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const save = async (skillName: string, preset: SeatPreset | null): Promise<void> => {
    if (saving) return
    setSaving(true)
    setSaveError(undefined)
    try {
      await onSave(skillName, preset)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }
  useEffect(() => {
    let cancelled = false
    setDir(current => ({ ...current, status: 'loading' }))
    void Promise.all([directory.listAgentPresets(), directory.modelCatalog()]).then(
      ([presets, catalog]) => {
        if (cancelled) return
        setDir({ status: 'ready', presets, catalog })
      },
      () => {
        if (cancelled) return
        setDir(current => ({ ...current, status: 'error' }))
      },
    )
    return () => { cancelled = true }
  }, [directory, generation])

  const visible = seats.filter(seat => seat.status === 'deployed' && seat.hidden !== true)
  const loading = dir.status === 'loading'
  const disabled = busy || loading || saving
  const usesModel = visible.some(seat => seat.preset?.model !== undefined)
  // Read at render time: the remote.settings inject scope may attach or detach after the directory loaded.
  const restorable = directory.canRestoreDefaultModel()

  return (
    <section className={css.panel} aria-labelledby="amphoreus-seat-presets" data-amph-seat-presets="">
      <div className={css.sectionHeading}>
        <div>
          <h2 id="amphoreus-seat-presets">{t('settings.presetHeading')}</h2>
          <p>{t('settings.presetHint')}</p>
        </div>
        <span className={css.index}>{String(visible.length).padStart(2, '0')}</span>
      </div>
      {visible.length === 0
        ? <p className={css.empty}>{t('settings.presetEmpty')}</p>
        : (
          <ul className={own.list}>
            {visible.map(seat => {
              const preset = seat.preset
              const modelValue = preset?.model === undefined ? '' : encodeModelChoice(preset.model.provider, preset.model.model)
              const catalogModel = preset?.model === undefined
                ? undefined
                : dir.catalog?.groups.find(group => group.id === preset.model!.provider)?.models.find(model => model.id === preset.model!.model)
              const efforts = catalogModel?.reasoning?.efforts ?? []
              const knownModel = catalogModel !== undefined
              const knownPreset = preset?.agentPreset === undefined || dir.presets.some(row => row.id === preset.agentPreset)
              const edit = (tier: SeatPresetTier, value: string): void => { void save(seat.skillName, withTier(preset, tier, value)) }
              return (
                <li
                  key={seat.skillName}
                  className={own.row}
                  data-has-preset={preset === undefined ? undefined : ''}
                  style={{ '--amph-seat-accent': seatColorOf(seat.skillName).accent } as CSSProperties}
                >
                  <span className={own.name}>{seatNames.get(seat.skillName) ?? seat.displayName}</span>
                  <div className={own.fields}>
                    <label className={own.field}>
                      {t('settings.presetAgent')}
                      <select className={own.select} disabled={disabled} value={preset?.agentPreset ?? ''} onChange={event => { edit('agentPreset', event.currentTarget.value) }}>
                        <option value="">{t('settings.presetDefault')}</option>
                        {dir.presets.map(row => <option key={row.id} value={row.id}>{row.name ?? row.id}{row.isDefault ? ' ·' : ''}</option>)}
                        {knownPreset ? null : <option value={preset!.agentPreset!}>{preset!.agentPreset}</option>}
                      </select>
                    </label>
                    <label className={own.field}>
                      {t('settings.presetModel')}
                      <select className={own.select} disabled={disabled} value={modelValue} onChange={event => { edit('model', event.currentTarget.value) }}>
                        <option value="">{t('settings.presetDefault')}</option>
                        {(dir.catalog?.groups ?? []).map(group => (
                          <optgroup key={group.id} label={group.name}>
                            {group.models.map(model => <option key={model.id} value={encodeModelChoice(group.id, model.id)}>{model.name}</option>)}
                          </optgroup>
                        ))}
                        {knownModel || preset?.model === undefined ? null : <option value={modelValue}>{preset.model.provider}/{preset.model.model}</option>}
                      </select>
                    </label>
                    {efforts.length === 0 ? null : (
                      <label className={own.field}>
                        {t('settings.presetEffort')}
                        <select className={own.select} disabled={disabled} value={preset?.model?.reasoningEffort ?? ''} onChange={event => { edit('reasoningEffort', event.currentTarget.value) }}>
                          <option value="">{t('settings.presetDefault')}</option>
                          {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
                        </select>
                      </label>
                    )}
                    <label className={own.field}>
                      {t('settings.presetPermission')}
                      <select className={own.select} disabled={disabled} value={preset?.permission ?? ''} onChange={event => { edit('permission', event.currentTarget.value) }}>
                        <option value="">{t('settings.presetDefault')}</option>
                        {SEAT_PERMISSION_PRESETS.map(name => <option key={name} value={name}>{t(PERMISSION_LABELS[name])}</option>)}
                        {preset?.permission === undefined || (SEAT_PERMISSION_PRESETS as readonly string[]).includes(preset.permission)
                          ? null
                          : <option value={preset.permission}>{preset.permission}</option>}
                      </select>
                    </label>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      {dir.status === 'error'
        ? <p className={`${own.note} ${own.error}`} role="alert">{t('settings.presetLoadFailed')}<button type="button" className={own.linkButton} disabled={busy} onClick={() => { setGeneration(value => value + 1) }}>{t('settings.presetReload')}</button></p>
        : null}
      {usesModel
        ? <p className={`${own.note} ${restorable ? '' : own.warn}`}>{t(restorable ? 'settings.presetModelRestore' : 'settings.presetModelWarning')}</p>
        : null}
      {saveError === undefined ? null : <p className={`${own.note} ${own.error}`} role="alert">{saveError}</p>}
      <p className={own.note}>{saving ? t('settings.presetSaving') : t('settings.presetBlankOnly')}</p>
    </section>
  )
}
