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
import { ProjectionIndex, type ProjectableEvent, type ProjectableSession } from './host/workbench.ts'
import type { WorkbenchStatus } from './shared/api.ts'

export { Config }
export type { AmphoreusConfig }

/** Stable Cordis plugin name (row id in cordis.patch.yml is also `amphoreus`). */
export const name = 'amphoreus'

/** Host services this row waits for before mounting. */
export const inject = ['webServer', 'connection', 'skills', 'storageDomain', 'sessions', 'sessionPersistence', 'agents', 'commands']

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

    // Seat workspace folders (one per hero).
    let seatDirs: EnsureSeatDirsResult | undefined
    try {
      seatDirs = await ensureSeatDirs(dataDir, bridge.resolver.current())
      ctx.logger.info(`amphoreus seat dirs ready at ${seatDirs.seatsRoot} (created=${seatDirs.created})`)
    } catch (error) {
      ctx.logger.error(`amphoreus seat dirs unavailable: ${String(error)}`)
    }

    let workbench: ProjectionIndex | undefined
    let workbenchStatus: WorkbenchStatus = { kind: 'ready' }
    let disposeProjection = () => {}
    let startColdReplay = () => {}
    if (!config.workbench.enabled) {
      workbenchStatus = { kind: 'disabled' }
    } else if (stores === undefined) {
      workbenchStatus = { kind: 'unavailable', reason: '存储域不可用' }
    } else {
      const main = stores.main
      workbench = new ProjectionIndex({
        get: () => main.global.get().workbench.hiddenSessionIds,
        set: ids => main.global.set({
          ...main.global.get(),
          workbench: { hiddenSessionIds: [...ids] },
        }),
      })
      workbenchStatus = { kind: 'unavailable', reason: '工作台正在初始化' }
      void workbench.ready()
        .then(() => { workbenchStatus = { kind: 'ready' } })
        .catch(error => {
          workbenchStatus = { kind: 'unavailable', reason: `工作台初始化失败：${String(error)}` }
        })
      if (config.workbench.autoProjection) {
        interface ColdHeader { id: string; cwd?: string; parentSession?: string }
        const sessions = (ctx as Context & {
          sessions: { list(): ProjectableSession[]; get(id: string): unknown }
        }).sessions
        const persistence = (ctx as Context & {
          sessionPersistence: {
            list(): Promise<ColdHeader[]>
            inspect(id: string): Promise<{
              meta: ColdHeader
              inheritedEventCount: number
              events: readonly ProjectableEvent[]
            }>
          }
        }).sessionPersistence
        const replay = (session: ProjectableSession): void => {
          try {
            workbench!.replay(session)
            workbench!.clearUnprojectable(session.id)
          } catch (error) {
            ctx.logger.warn(`amphoreus workbench projection: ${String(error)}`)
            workbench!.markUnprojectable(session, error)
          }
        }

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
              try {
                workbench!.apply(session, events)
                workbench!.clearUnprojectable(session.id)
              } catch (error) {
                ctx.logger.warn(`amphoreus workbench projection: ${String(error)}`)
                workbench!.markUnprojectable(session, error)
              }
            }
          })
        })
        for (const session of sessions.list()) replay(session)

        const COLD_REPLAY_CONCURRENCY = 4
        startColdReplay = () => {
          void (async () => {
            const headers = await persistence.list()
            const cold = headers.filter(header => header.cwd !== undefined && sessions.get(header.id) === undefined)
            for (let index = 0; index < cold.length; index += COLD_REPLAY_CONCURRENCY) {
              await Promise.all(cold.slice(index, index + COLD_REPLAY_CONCURRENCY).map(async header => {
                try {
                  const inspection = await persistence.inspect(header.id)
                  replay({
                    id: header.id,
                    header: inspection.meta,
                    inheritedEventCount: inspection.inheritedEventCount,
                    events: inspection.events,
                  })
                } catch (error) {
                  ctx.logger.warn(`amphoreus workbench cold replay ${header.id}: ${String(error)}`)
                }
              }))
            }
          })().catch(error => ctx.logger.warn(`amphoreus workbench cold replay: ${String(error)}`))
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
    startColdReplay()
    return async () => {
      disposeFirstFrame()
      disposeInjector()
      disposeWebApi()
      disposeProjection()
      detach()
      workbench?.flush()
      await bridge.close()
      await stores?.close()
    }
  }, 'dsh-amphoreus/bridge')
}
