import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useRef } from 'react'
import { freshSubmissionIds, resolveSeatSound, type SeatSoundPlayer } from './seat-sounds.ts'
import type { SeatWatch } from './seat-watch.ts'
import type { AmphoreusClientModel } from './state.ts'

export interface SendSoundInjected {
  readonly player: Pick<SeatSoundPlayer, 'play'>
  readonly model: Pick<AmphoreusClientModel, 'getSnapshot'>
  readonly seat: Pick<SeatWatch, 'getSnapshot'>
}

export type SendSoundProps = PropsRuntime<'conversation.input.dock'> & SendSoundInjected

/**
 * Null-rendering sentinel in the session-scoped composer dock: plays the current
 * seat's "send" sound once per composer submission. A submission is detected as a
 * new `pendingSubmissions` requestId — the composer sink always registers one
 * (`session.beginSubmission`), whereas plugin-initiated `session.prompt()` calls
 * (handoff / dispatch / conference) never do, so those stay silent. Ids present
 * at mount (session switch mid-flight) are not replayed.
 */
export function SendSound({ useSession, player, model, seat }: SendSoundProps) {
  const pending = useSession(snapshot => snapshot.pendingSubmissions)
  const seen = useRef<Set<string> | undefined>(undefined)
  useEffect(() => {
    const ids = pending.map(item => String(item.requestId))
    if (seen.current === undefined) {
      seen.current = new Set(ids)
      return
    }
    const fresh = freshSubmissionIds(seen.current, ids)
    for (const id of ids) seen.current.add(id)
    // Retired ids never come back; keep the set bounded to what is still in flight plus this batch.
    if (seen.current.size > 64) seen.current = new Set(ids)
    if (fresh.length === 0) return
    const sound = resolveSeatSound(model.getSnapshot().state, seat.getSnapshot(), 'send')
    if (sound !== undefined) player.play(sound.url, sound.volume)
  }, [pending, player, model, seat])
  return null
}
