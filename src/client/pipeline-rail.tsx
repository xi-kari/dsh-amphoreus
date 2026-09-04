import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import clsx from 'clsx'
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { BindingRecord, SeatRecord } from '../host/store.ts'
import type { PublicSuite } from '../shared/api.ts'
import { dispatchTask, type HandoffDeps } from './handoff.ts'
import css from './pipeline-rail.module.css'
import { SeatBadge } from './seat-badge.tsx'
import type { AmphoreusClientModel } from './state.ts'

type Pipeline = PublicSuite['pipelines'][number]
type PipelineStation = Pipeline['stations'][number]

export type PipelineRailProps =
  & PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'amphoreus'>
  & {
    readonly model: AmphoreusClientModel
    readonly seatDeps: HandoffDeps
    readonly cwdOf: (sessionId: string) => string | undefined
  }

export interface PipelinePosition {
  readonly pipeline: number
  readonly station: number
}

export interface PipelineTarget {
  readonly skill: string
  readonly face?: string
  readonly name: string
  readonly pipeline: string
  readonly station: number
}

export function matchesBinding(
  station: PipelineStation,
  binding: Pick<BindingRecord, 'skillName' | 'face'> | undefined,
): boolean {
  if (binding === undefined || station.skill !== binding.skillName) return false
  return binding.face === undefined || station.face === binding.face
}

export function findPipelinePosition(
  pipelines: PublicSuite['pipelines'],
  binding: Pick<BindingRecord, 'skillName' | 'face'> | undefined,
): PipelinePosition | undefined {
  for (let pipeline = 0; pipeline < pipelines.length; pipeline += 1) {
    const stations = pipelines[pipeline]!.stations
    const station = stations.findIndex(candidate => matchesBinding(candidate, binding))
    if (station >= 0) return { pipeline, station }
  }
  return undefined
}

export function stationIsDeployed(
  station: PipelineStation,
  seats: readonly SeatRecord[],
): boolean {
  return station.skill !== undefined
    && seats.some(seat => seat.skillName === station.skill && seat.status === 'deployed')
}

export function targetIsAvailable(
  target: PipelineTarget,
  pipelines: PublicSuite['pipelines'],
  seats: readonly SeatRecord[],
): boolean {
  const pipeline = pipelines.find(candidate => candidate.name === target.pipeline)
  const station = pipeline?.stations[target.station]
  return station !== undefined
    && station.skill === target.skill
    && station.face === target.face
    && station.text === target.name
    && stationIsDeployed(station, seats)
}

export function acquirePipelineDispatch(lock: { current: boolean }): boolean {
  if (lock.current) return false
  lock.current = true
  return true
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function PipelineRail({ model, seatDeps, sessionId, cwdOf, t }: PipelineRailProps) {
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const rootRef = useRef<HTMLDivElement>(null)
  const submitLock = useRef(false)
  const panelId = useId()
  const textareaId = useId()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<PipelineTarget>()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const closePanel = useCallback((): void => {
    setOpen(false)
    setTarget(undefined)
    setError(undefined)
  }, [])
  const state = snapshot.state
  const available = state?.suite !== undefined
    && state.effectiveConfig.pipelinesEnabled
    && state.suite.pipelines.length > 0

  useEffect(() => {
    if (!available) {
      closePanel()
      return
    }
    if (!open) return
    const onDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) !== true) {
        closePanel()
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closePanel()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [available, closePanel, open])

  if (!available || state?.suite === undefined) return null

  const pipelines = state.suite.pipelines
  const binding = state.bindings.find(candidate => candidate.sessionId === sessionId)
  const position = findPipelinePosition(pipelines, binding)
  const positionPipeline = position === undefined ? undefined : pipelines[position.pipeline]
  const chipLabel = position === undefined || positionPipeline === undefined
    ? t('rail.title')
    : `${positionPipeline.name} ${position.station + 1}/${positionPipeline.stations.length}`

  const submit = async (): Promise<void> => {
    if (target === undefined || text.trim() === '' || !acquirePipelineDispatch(submitLock)) return
    const latest = model.getSnapshot().state
    if (latest?.suite === undefined
      || !latest.effectiveConfig.pipelinesEnabled
      || !targetIsAvailable(target, latest.suite.pipelines, latest.seats)) {
      submitLock.current = false
      setTarget(undefined)
      setError(undefined)
      return
    }
    const cwd = cwdOf(sessionId)
    setBusy(true)
    setError(undefined)
    try {
      await dispatchTask(seatDeps, {
        skillName: target.skill,
        text,
        from: 'rail',
        pipeline: target.pipeline,
        station: target.station,
        open: true,
        ...(cwd === undefined ? {} : { cwd }),
        ...(target.face === undefined ? {} : { face: target.face }),
      })
      setText('')
      closePanel()
    } catch (dispatchError) {
      setError(errorMessage(dispatchError))
    } finally {
      submitLock.current = false
      setBusy(false)
    }
  }

  return (
    <div className={css.root} ref={rootRef}>
      <button
        type="button"
        className={css.chip}
        aria-controls={panelId}
        aria-expanded={open}
        title={t('rail.tip')}
        onClick={() => {
          if (open) closePanel()
          else setOpen(true)
        }}
      >
        {chipLabel}
      </button>
      {open && (
        <div id={panelId} className={css.panel} role="dialog" aria-label={t('rail.title')}>
          {pipelines.map((pipeline, pipelineIndex) => (
            <div key={`${pipeline.source}:${pipeline.name}:${pipelineIndex}`} className={css.line}>
              <strong>{pipeline.name}</strong>
              {pipeline.stations.map((station, stationIndex) => {
                const deployed = stationIsDeployed(station, state.seats)
                const current = matchesBinding(station, binding)
                const stationTitle = `${station.text}${deployed ? '' : ` · ${t('seats.undeployed')}`}`
                return (
                  <button
                    key={stationIndex}
                    type="button"
                    className={clsx(css.station, current && css.current, !deployed && css.undeployed)}
                    disabled={!deployed || busy}
                    title={stationTitle}
                    aria-label={stationTitle}
                    onClick={() => {
                      if (!deployed || station.skill === undefined) return
                      setTarget({
                        skill: station.skill,
                        name: station.text,
                        pipeline: pipeline.name,
                        station: stationIndex,
                        ...(station.face === undefined ? {} : { face: station.face }),
                      })
                      setError(undefined)
                    }}
                  >
                    <SeatBadge
                      skill={station.skill ?? null}
                      label={station.text}
                      size={18}
                      assetsConfigured={state.effectiveConfig.assetsConfigured}
                      {...(station.face === undefined ? {} : { face: station.face })}
                    />
                  </button>
                )
              })}
            </div>
          ))}
          {target && (
            <form
              className={css.compose}
              aria-busy={busy}
              onSubmit={(event) => {
                event.preventDefault()
                void submit()
              }}
            >
              <label htmlFor={textareaId}>{t('rail.dispatchTo', { name: target.name })}</label>
              <textarea
                id={textareaId}
                value={text}
                maxLength={4000}
                rows={3}
                placeholder={t('rail.placeholder')}
                onChange={event => setText(event.target.value)}
              />
              {error === undefined ? null : <span className={css.error}>{error}</span>}
              <div className={css.composeActions}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setTarget(undefined)
                    setError(undefined)
                  }}
                >
                  {t('rail.cancel')}
                </button>
                <button type="submit" disabled={busy || text.trim() === ''}>{t('rail.send')}</button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
