/** dsh-amphoreus host half. @module dsh-amphoreus */
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { randomBytes, randomInt } from 'node:crypto'
import { join } from 'node:path'
import { AmphoreusBridge } from './host/bridge.ts'
import { Config, type AmphoreusConfig } from './host/config.ts'
import { registerFirstFrame } from './host/firstframe.ts'
import { registerInjector } from './host/injector.ts'
import { ensureSeatDirs, type EnsureSeatDirsResult } from './host/seatdirs.ts'
import { reconcileSeats } from './host/seats.ts'
import { openAmphoreusStores, type AmphoreusStores } from './host/store.ts'
import { AmphoreusWebApi } from './host/webapi.ts'
import { createSeatResolver, WorkbenchStore, type ProjectableEvent, type ProjectableSession } from './host/workbench.ts'
import type { WorkbenchStatus } from './shared/api.ts'
import { heroVisualOf } from './shared/heroes.ts'

export { Config }
export type { AmphoreusConfig }

/** Stable Cordis plugin name (row id in cordis.patch.yml is also `amphoreus`). */
export const name = 'amphoreus'

/** Host services this row waits for before mounting. */
export const inject = ['webServer', 'connection', 'skills', 'storageDomain', 'sessions', 'agents', 'commands']

export function apply(ctx: Context, config: AmphoreusConfig): void {
  ctx.effect(async () => {
    const bridge = new AmphoreusBridge(ctx, config)
    const nonce = randomBytes(24).toString('base64url')
    const dataDir = config.dataDir.trim() === '' ? join(resolveDshHome(), 'amphoreus') : config.dataDir
    let stores: AmphoreusStores | undefined
    try {
      stores = await openAmphoreusStores(ctx)
    } catch (error) {
      ctx.logger.error(`amphoreus storage unavailable; seats disabled: ${String(error)}`)
    }
    const detach = stores === undefined
      ? () => {}
      : bridge.resolver.onSnapshot(async snapshot => {
          const result = await reconcileSeats(stores!.main, snapshot)
          ctx.logger.info(`amphoreus seats reconciled added=${result.added} updated=${result.updated} undeployed=${result.undeployed} renamed=${result.renamed}`)
        })

    // Seat workspace folders (one per hero) + the seat-scoped workbench store.
    let seatDirs: EnsureSeatDirsResult | undefined
    let seatDirsError: string | undefined
    try {
      seatDirs = await ensureSeatDirs(dataDir, bridge.resolver.current())
      ctx.logger.info(`amphoreus seat dirs ready at ${seatDirs.seatsRoot} (created=${seatDirs.created})`)
    } catch (error) {
      seatDirsError = String(error)
      ctx.logger.error(`amphoreus seat dirs unavailable: ${seatDirsError}`)
    }
    let workbench: WorkbenchStore | undefined
    let workbenchStatus: WorkbenchStatus = { kind: 'ready' }
    let disposeProjection = () => {}
    if (!config.workbench.enabled) {
      workbenchStatus = { kind: 'disabled' }
    } else if (seatDirs === undefined) {
      workbenchStatus = { kind: 'unavailable', reason: `席位目录不可用：${seatDirsError ?? '未知错误'}` }
    } else if (stores !== undefined) {
      const resolver = createSeatResolver({
        bindingSeat: sessionId => stores!.main.table('bindings').get(sessionId)?.skillName,
        heroIdOfSkill: skillName => heroVisualOf(skillName)?.heroId,
        seatDirs: seatDirs.dirs,
        seatTitle: heroId => {
          const visual = [...(bridge.resolver.current()?.cards.values() ?? [])]
            .find(card => heroVisualOf(card.name)?.heroId === heroId)
          return visual?.displayName ?? heroId
        },
      })
      workbench = new WorkbenchStore(join(dataDir, 'workbench.json'), resolver)
      void workbench.ready().catch(error => {
        workbenchStatus = { kind: 'unavailable', reason: `workbench.json 读取失败：${String(error)}` }
      })
      if (config.workbench.autoProjection) {
        const sessions = (ctx as Context & { sessions: { list(): ProjectableSession[] } }).sessions
        const replay = (session: ProjectableSession & { firstLiveSeq?: number; snapshotEvents?: () => readonly ProjectableEvent[] }): void => {
          const events = session.snapshotEvents?.() ?? session.events ?? []
          const replayFrom = session.header?.parentSession === undefined ? 0 : (session.firstLiveSeq ?? 0)
          void workbench!.projectSession({ ...session, events }, replayFrom)
            .then(() => workbench!.clearUnprojectable(session.id))
            .catch(error => {
              ctx.logger.warn(`amphoreus workbench projection: ${String(error)}`)
              workbench!.markUnprojectable(session, error)
            })
        }
        // Coalesce a burst of turn events into one deferred write per session.
        const queue: { session: ProjectableSession; event: ProjectableEvent }[] = []
        let scheduled = false
        const disposeCreated = ctx.on('session/created', replay)
        const disposeEvent = ctx.on('session/event', (session: ProjectableSession, event: ProjectableEvent) => {
          queue.push({ session, event })
          if (scheduled) return
          scheduled = true
          queueMicrotask(() => {
            scheduled = false
            const batch = queue.splice(0)
            const bySession = new Map<string, [ProjectableSession, ProjectableEvent[]]>()
            for (const item of batch) {
              const entry = bySession.get(item.session.id)
              if (entry === undefined) bySession.set(item.session.id, [item.session, [item.event]])
              else entry[1].push(item.event)
            }
            for (const [, [session, events]] of bySession) {
              void workbench!.projectEvents(session, events)
                .then(() => workbench!.clearUnprojectable(session.id))
                .catch(error => {
                  ctx.logger.warn(`amphoreus workbench projection: ${String(error)}`)
                  workbench!.markUnprojectable(session, error)
                })
            }
          })
        })
        for (const session of sessions.list()) {
          replay(session as ProjectableSession & { firstLiveSeq?: number; snapshotEvents?: () => readonly ProjectableEvent[] })
        }
        disposeProjection = () => {
          disposeCreated()
          disposeEvent()
        }
      }
    }

    const webApi = stores === undefined
      ? undefined
      : new AmphoreusWebApi(ctx, {
          config,
          stores,
          resolver: bridge.resolver,
          nonce,
          workbenchStatus: () => workbenchStatus,
          ...(workbench === undefined ? {} : { workbench }),
          ...(seatDirs === undefined ? {} : { seatDirs: seatDirs.dirs }),
        })
    const disposeWebApi = webApi?.register() ?? (() => {})
    const disposeInjector = stores === undefined ? () => {} : registerInjector(ctx, { config, stores })
    const disposeFirstFrame = registerFirstFrame(ctx, {
      config,
      nonce,
      current: () => bridge.resolver.current(),
      wallpaperIndex: randomInt(6),
    })
    await bridge.start()
    return async () => {
      disposeFirstFrame()
      disposeInjector()
      disposeWebApi()
      disposeProjection()
      detach()
      await workbench?.flush()
      await bridge.close()
      await stores?.close()
    }
  }, 'dsh-amphoreus/bridge')
}
