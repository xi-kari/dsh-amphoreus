/** dsh-amphoreus host half. @module dsh-amphoreus */
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { randomBytes, randomInt } from 'node:crypto'
import { join } from 'node:path'
import { AmphoreusBridge } from './host/bridge.ts'
import { Config, type AmphoreusConfig } from './host/config.ts'
import { registerFirstFrame } from './host/firstframe.ts'
import { registerInjector } from './host/injector.ts'
import { migrateSynapse } from './host/migrate-synapse.ts'
import { registerObserver } from './host/observer.ts'
import { registerSeatPrompt, stickerWebOrigin } from './host/seat-prompt.ts'
import { ensureSeatDirs, type EnsureSeatDirsResult } from './host/seatdirs.ts'
import { reconcileSeats } from './host/seats.ts'
import { openAmphoreusStores, updateAmphoreusGlobal, type AmphoreusStores } from './host/store.ts'
import { AmphoreusWebApi } from './host/webapi.ts'
import { ProjectionIndex, type ProjectableEvent, type ProjectableSession } from './host/workbench.ts'
import type { WorkbenchStatus } from './shared/api.ts'
// @anchor host-imports
import { registerSeatMemory } from './host/memory.ts'

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
    if (stores !== undefined) {
      await migrateSynapse(stores, resolveDshHome(), ctx.logger)
        .catch(error => ctx.logger.warn(`amphoreus synapse migration failed: ${String(error)}`))
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
    const coldReplayAbort = new AbortController()
    let coldReplayTask: Promise<void> = Promise.resolve()
    let projectionDisposed = false
    if (!config.workbench.enabled) {
      workbenchStatus = { kind: 'disabled' }
    } else if (stores === undefined) {
      workbenchStatus = { kind: 'unavailable', reason: '存储域不可用' }
    } else {
      const main = stores.main
      workbench = new ProjectionIndex({
        get: () => main.global.get().workbench.hiddenSessionIds,
        set: async ids => {
          await updateAmphoreusGlobal(main, global => ({
            ...global,
            workbench: { hiddenSessionIds: [...new Set([...global.workbench.hiddenSessionIds, ...ids])] },
          }))
        },
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
            list(signal?: AbortSignal): Promise<ColdHeader[]>
            inspect(id: string, signal?: AbortSignal): Promise<{
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
            if (projectionDisposed) {
              queue.length = 0
              return
            }
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
          const signal = coldReplayAbort.signal
          coldReplayTask = (async () => {
            const headers = await persistence.list(signal)
            if (signal.aborted) return
            const cold = headers.filter(header => header.cwd !== undefined && sessions.get(header.id) === undefined)
            // Register the complete parent graph before any asynchronous inspect finishes,
            // so hidden ancestors also suppress descendants loaded out of order.
            for (const header of cold) workbench!.replay({ id: header.id, header, events: [] })
            for (let index = 0; index < cold.length; index += COLD_REPLAY_CONCURRENCY) {
              if (signal.aborted) return
              await Promise.all(cold.slice(index, index + COLD_REPLAY_CONCURRENCY).map(async header => {
                try {
                  const inspection = await persistence.inspect(header.id, signal)
                  if (signal.aborted || projectionDisposed) return
                  replay({
                    id: header.id,
                    header: inspection.meta,
                    inheritedEventCount: inspection.inheritedEventCount,
                    events: inspection.events,
                  })
                } catch (error) {
                  if (!signal.aborted) ctx.logger.warn(`amphoreus workbench cold replay ${header.id}: ${String(error)}`)
                }
              }))
            }
          })().catch(error => {
            if (!signal.aborted) ctx.logger.warn(`amphoreus workbench cold replay: ${String(error)}`)
          })
        }
        disposeProjection = () => {
          projectionDisposed = true
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
          assetsCacheDir: join(dataDir, 'assets-cache'),
          dataDir,
          // @anchor webapi-construct
          workbenchStatus: () => workbenchStatus,
          ...(workbench === undefined ? {} : { workbench }),
          ...(seatDirs === undefined ? {} : { seatDirs: seatDirs.dirs }),
        })
    await webApi?.prepareAssets()
    const disposeWebApi = webApi?.register() ?? (() => {})
    const disposeInjector = stores === undefined ? () => {} : registerInjector(ctx, { config, stores })
    const disposeSeatPrompt = stores === undefined ? () => {} : registerSeatPrompt(ctx, {
      stores,
      current: () => bridge.resolver.current(),
      commonPath: config.commonPath,
      relationsPath: config.relationsPath,
      stickerOrigin: () => webApi === undefined ? undefined : stickerWebOrigin(ctx.webServer),
    })
    const disposeFirstFrame = registerFirstFrame(ctx, {
      config,
      nonce,
      current: () => bridge.resolver.current(),
      wallpaperIndex: randomInt(6),
      derivedWallpaper: index => webApi?.derivedWallpaperUrl(index) ?? null,
    })
    await bridge.start()
    const disposeObserver = stores === undefined
      ? () => Promise.resolve()
      : registerObserver(ctx, { config, stores, resolver: bridge.resolver })
    // @anchor host-register
    const disposeSeatMemory = stores === undefined
      ? () => Promise.resolve()
      : registerSeatMemory(ctx, { config, stores, current: () => bridge.resolver.current() })
    startColdReplay()
    return async () => {
      await disposeObserver()
      // @anchor host-dispose
      await disposeSeatMemory()
      disposeFirstFrame()
      disposeSeatPrompt()
      disposeInjector()
      disposeWebApi()
      disposeProjection()
      detach()
      coldReplayAbort.abort()
      await coldReplayTask
      workbench?.flush()
      await bridge.close()
      await stores?.close()
    }
  }, 'dsh-amphoreus/bridge')
}
