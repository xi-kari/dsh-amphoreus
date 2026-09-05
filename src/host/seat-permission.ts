/**
 * Permission tier of a seat preset, applied on the host.
 *
 * `session/created` fires after the seat binding was PUT (startSeatSession
 * writes the binding before `sessions.create`), and our listener registers
 * after the permission service's own default pin (base bundle row precedes the
 * amphoreus patch row), so the seat value wins. The service is optional (absent
 * on non-confining shell executors): resolve it with `ctx.get` per event, never
 * inject it.
 *
 * `session/created` is announced for EVERY publish source (startup, resume,
 * clear, compact — core/agent-loop publish → sessions.announce), and the seat
 * binding persists, so only a genuinely fresh session may receive the tier:
 * `firstLiveSeq === 0` (empty constructor seed; restore/fork seeds are > 0) and
 * no `parentSession` (a handoff fork keeps its parent's knobs). Anything else
 * would silently undo a user's manual `/permission` switch on reopen.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: merges `permissionPresets` into Context and the session/* events into Events.
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session'
import type { AmphoreusStores } from './store.ts'

export interface SeatPermissionOptions {
  readonly stores: AmphoreusStores
}

/** The permission preset name a new session should start with, or undefined when the seat sets none. */
export function seatPermissionFor(stores: AmphoreusStores, sessionId: string): string | undefined {
  const binding = stores.main.table('bindings').get(sessionId)
  if (binding === undefined) return undefined
  return stores.main.table('seats').get(binding.skillName)?.preset?.permission
}

/** True only for a brand-new session: no seed events and no fork parent. */
export function isFreshSession(session: { readonly firstLiveSeq: number; readonly header: { readonly parentSession?: string } }): boolean {
  return session.firstLiveSeq === 0 && session.header.parentSession === undefined
}

export function registerSeatPermission(ctx: Context, options: SeatPermissionOptions): () => void {
  return ctx.on('session/created', session => {
    if (!isFreshSession(session)) return
    let name: string | undefined
    try {
      name = seatPermissionFor(options.stores, session.id)
    } catch (error) {
      ctx.logger.warn(`amphoreus seat permission: ${String(error)}`)
      return
    }
    if (name === undefined) return
    const service = ctx.get('permissionPresets')
    if (service === undefined) {
      ctx.logger.warn(`amphoreus seat permission: preset "${name}" skipped for ${session.id}; permission service not composed`)
      return
    }
    try {
      service.set(session, name)
    } catch (error) {
      ctx.logger.warn(`amphoreus seat permission: preset "${name}" refused for ${session.id}: ${String(error)}`)
    }
  })
}
