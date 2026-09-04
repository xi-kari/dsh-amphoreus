import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useId, useRef, useState, useSyncExternalStore } from 'react'
import type { ObservationRecord } from '../host/store.ts'
import { acceptHandoff, dismissHandoff, type HandoffDeps } from './handoff.ts'
import css from './handoff-dock.module.css'
import { SeatBadge } from './seat-badge.tsx'
import type { AmphoreusClientModel } from './state.ts'

export type HandoffDockProps =
  & PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'amphoreus'>
  & {
    readonly model: AmphoreusClientModel
    readonly seatDeps: HandoffDeps
  }

export function latestOpenHandoff(
  observations: readonly ObservationRecord[],
  sessionId: string,
): ObservationRecord | undefined {
  return observations
    .filter(observation => (
      observation.sessionId === sessionId
      && observation.kind === 'handoff'
      && observation.status === 'open'
    ))
    .sort((left, right) => right.seq - left.seq)[0]
}

export function acquireHandoffAction(lock: { current: boolean }): boolean {
  if (lock.current) return false
  lock.current = true
  return true
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function HandoffDock({ session, model, seatDeps, t }: HandoffDockProps) {
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [showPayload, setShowPayload] = useState(false)
  const actionLock = useRef(false)
  const payloadId = useId()
  const state = snapshot.state

  if (state?.effectiveConfig.handoffEnabled !== true) return null
  const open = latestOpenHandoff(state.observations, session.sessionId)
  if (open === undefined) return null

  const seat = open.targetSkillName === null || open.targetSkillName === undefined
    ? undefined
    : state.seats.find(candidate => candidate.skillName === open.targetSkillName)
  const deployed = seat?.status === 'deployed'
  const name = open.targetDisplayName ?? seat?.displayName ?? '?'

  const runAction = async (action: () => Promise<unknown>): Promise<void> => {
    if (!acquireHandoffAction(actionLock)) return
    setBusy(true)
    setError(undefined)
    try {
      await action()
    } catch (actionError) {
      setError(errorMessage(actionError))
    } finally {
      actionLock.current = false
      setBusy(false)
    }
  }

  return (
    <div
      className={css.dock}
      role="status"
      aria-busy={busy}
      data-amphoreus-handoff=""
      data-magazine={state.effectiveConfig.magazineMode}
    >
      <SeatBadge
        skill={open.targetSkillName ?? null}
        label={name}
        size={state.effectiveConfig.magazineMode === 'full' ? 48 : 28}
        assetsConfigured={state.effectiveConfig.assetsConfigured}
        {...(open.targetFace === undefined ? {} : { face: open.targetFace })}
      />
      <div className={css.copy}>
        <strong>
          {deployed ? t('handoff.ask', { name }) : t('handoff.absent', { name })}
        </strong>
        {showPayload && (
          <pre id={payloadId} className={css.payload}>{open.payload ?? ''}</pre>
        )}
        {error === undefined ? null : <span className={css.error}>{error}</span>}
      </div>
      <div className={css.actions}>
        <button
          type="button"
          title={t('handoff.payloadTip')}
          aria-controls={payloadId}
          aria-expanded={showPayload}
          onClick={() => setShowPayload(value => !value)}
        >
          {t('handoff.view')}
        </button>
        {deployed && (
          <button
            type="button"
            className={css.primary}
            disabled={busy}
            onClick={() => { void runAction(() => acceptHandoff(seatDeps, open)) }}
          >
            {t('handoff.accept')}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => { void runAction(() => dismissHandoff(seatDeps, open)) }}
        >
          {t('handoff.dismiss')}
        </button>
      </div>
    </div>
  )
}
