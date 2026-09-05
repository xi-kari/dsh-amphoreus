import type { Context } from '@deepseek-ai/cordis'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import { randomBytes } from 'node:crypto'
import { open, readFile, readdir, realpath, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { AmphoreusAssetsStatus, AmphoreusState, DeriveProgress, PublicSuite, WorkbenchBoot, WorkbenchStatus } from '../shared/api.ts'
import { GLOBAL_WALLPAPERS } from '../shared/heroes.ts'
import type { AmphoreusConfig } from './config.ts'
import { deriveAssets, probeMagick, resolveGlobalWallpaperDir, type DeriveOptions, type DeriveResult } from './derive.ts'
import { publicWorkbench } from './firstframe.ts'
import { BindingSchema, CanvasSchema, MemorySchema, ObservationSchema, updateAmphoreusGlobal, type AmphoreusStores } from './store.ts'
import type { SuiteResolver } from './bridge.ts'
import type { SuiteSnapshot } from './suite/types.ts'
import { InputError, NotFoundError, type ProjectionIndex } from './workbench.ts'
import type { SeatDirRecord } from './seatdirs.ts'

const MAX_BODY_BYTES = 4 * 1024
const MAX_CANVAS_BODY_BYTES = 64 * 1024
const MAX_SSE_CLIENTS = 8
const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const SKILL_NAME = /^amphoreus-[a-z0-9]+(?:-[a-z0-9]+)*$/u
const OBSERVATION_KEY = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d+:(?:handoff|notify|receipt|absence|dispatch)$/iu
const WORKBENCH_DIR = fileURLToPath(new URL('../workbench/', import.meta.url))

class BodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`request body exceeds ${limit} bytes`)
  }
}

const BindInput = z.object({
  skill: z.string(),
  face: z.string().optional(),
  boundBy: z.enum(['seat-new', 'seat-enter', 'handoff', 'handoff-fork', 'fork-inherit', 'manual', 'dispatch']),
  fromSessionId: z.string().optional(),
  fromSeq: z.number().int().nonnegative().optional(),
})

const PrefsInput = z.object({
  quickPhrases: z.array(z.string().max(16)).max(12).optional(),
  lastSeat: z.string().nullable().optional(),
  magazineMode: z.enum(['light', 'full']).nullable().optional(),
})

const DeriveInput = z.object({ force: z.boolean().optional() }).strict()

const ObservationCreateInput = z.object({
  sessionId: z.string().regex(SESSION_ID),
  seq: z.literal(0),
  kind: z.literal('dispatch'),
  targetSkillName: z.string().regex(SKILL_NAME),
  payload: z.string().min(1).max(4000),
  dispatchedFrom: z.enum(['panel', 'rail', 'pipeline']),
  pipeline: z.string().max(40).optional(),
  station: z.number().int().nonnegative().optional(),
})

const ObservationPatchInput = z.object({
  status: z.enum(['open', 'accepted', 'dismissed']),
  acceptedSessionId: z.string().regex(SESSION_ID).optional(),
})

interface ConnectionFence {
  requestRejection(request: IncomingMessage): 401 | 403 | undefined
}

type HostContext = Context & {
  readonly connection?: ConnectionFence
  readonly sessions: SessionStore
}

export interface WebApiOptions {
  readonly config: AmphoreusConfig
  readonly stores: AmphoreusStores
  readonly resolver: SuiteResolver
  readonly nonce?: string
  readonly workbenchDir?: string
  readonly workbench?: ProjectionIndex
  readonly workbenchStatus?: () => WorkbenchStatus
  readonly seatDirs?: readonly SeatDirRecord[]
  readonly assetsCacheDir?: string
  readonly deriveAssets?: (options: DeriveOptions) => Promise<DeriveResult>
  readonly probeMagick?: () => Promise<string | undefined>
}

interface SseClient {
  readonly id: number
  readonly response: ServerResponse
  readonly heartbeat: NodeJS.Timeout
}

class SseHub {
  readonly #clients: SseClient[] = []
  #nextId = 1

  add(request: IncomingMessage, response: ServerResponse, initial: unknown): void {
    while (this.#clients.length >= MAX_SSE_CLIENTS) this.#remove(this.#clients[0]!)
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    response.write('retry: 2000\n\n')
    const client: SseClient = {
      id: this.#nextId++,
      response,
      heartbeat: setInterval(() => response.write(': keepalive\n\n'), 20_000),
    }
    client.heartbeat.unref?.()
    this.#clients.push(client)
    this.send(client, 'snapshot', initial)
    request.once('close', () => this.#remove(client))
  }

  publish(event: string, value: unknown): void {
    for (const client of [...this.#clients]) this.send(client, event, value)
  }

  close(): void {
    for (const client of [...this.#clients]) this.#remove(client)
  }

  private send(client: SseClient, event: string, value: unknown): void {
    if (client.response.destroyed || client.response.writableEnded) {
      this.#remove(client)
      return
    }
    client.response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)
  }

  #remove(client: SseClient): void {
    const index = this.#clients.indexOf(client)
    if (index >= 0) this.#clients.splice(index, 1)
    clearInterval(client.heartbeat)
    if (!client.response.writableEnded) client.response.end()
  }
}

export class AmphoreusWebApi {
  readonly nonce: string
  readonly #ctx: HostContext
  readonly #config: AmphoreusConfig
  readonly #stores: AmphoreusStores
  readonly #resolver: SuiteResolver
  readonly #workbenchDir: string
  readonly #workbench: ProjectionIndex | undefined
  readonly #workbenchStatus: () => WorkbenchStatus
  readonly #seatDirs: readonly SeatDirRecord[]
  readonly #assetsCacheDir: string | undefined
  readonly #deriveAssets: (options: DeriveOptions) => Promise<DeriveResult>
  readonly #probeMagick: () => Promise<string | undefined>
  readonly #sse = new SseHub()
  readonly #canvasRevisions = new Map<string, number>()
  #assetsCacheRealDir: string | undefined
  #derived = new Set<string>()
  #magick: string | null = null
  #assetsPrepared = false
  #assetsPreparation: Promise<void> | undefined
  #deriveRunning = false
  #deriveGeneration = 0
  #lastDerive: AmphoreusAssetsStatus['lastDerive'] = null

  constructor(ctx: Context, options: WebApiOptions) {
    this.#ctx = ctx as HostContext
    this.#config = options.config
    this.#stores = options.stores
    this.#resolver = options.resolver
    this.#workbenchDir = options.workbenchDir ?? WORKBENCH_DIR
    this.#workbench = options.workbench
    this.#workbenchStatus = options.workbenchStatus ?? (() => (
      this.#workbench === undefined
        ? { kind: 'unavailable', reason: '工作台存储未初始化' }
        : { kind: 'ready' }
    ))
    this.#seatDirs = options.seatDirs ?? []
    this.#assetsCacheDir = options.assetsCacheDir === undefined ? undefined : resolve(options.assetsCacheDir)
    this.#deriveAssets = options.deriveAssets ?? deriveAssets
    this.#probeMagick = options.probeMagick ?? probeMagick
    this.nonce = options.nonce ?? randomBytes(24).toString('base64url')
  }

  async prepareAssets(): Promise<void> {
    if (this.#assetsPrepared) return
    if (this.#assetsPreparation !== undefined) return this.#assetsPreparation
    const preparation = (async () => {
      try {
        await this.#scanDerived()
      } catch (error) {
        this.#assetsCacheRealDir = undefined
        this.#derived = new Set()
        this.#warn(`amphoreus derived cache scan failed; using original assets: ${String(error)}`)
      }
      try {
        this.#magick = await this.#probeMagick() ?? null
      } catch (error) {
        this.#magick = null
        this.#warn(`amphoreus ImageMagick probe failed: ${String(error)}`)
      }
      this.#assetsPrepared = true
    })()
    this.#assetsPreparation = preparation
    try {
      await preparation
    } catch (error) {
      if (this.#assetsPreparation === preparation) this.#assetsPreparation = undefined
      throw error
    }
  }

  register(): () => void {
    void this.prepareAssets().catch(error => {
      this.#warn(`amphoreus assets preparation failed: ${String(error)}`)
    })
    const route = this.#ctx.webServer.register({
      kind: 'prefix',
      path: '/amphoreus',
      handler: (request, response) => this.handle(request, response),
    })
    const domain = this.#ctx.on('domain/changed', change => {
      if (change.domain !== 'amphoreus' && change.domain !== 'amphoreus_canvas') return
      this.#sse.publish('state-change', { domain: change.domain, table: change.table, key: change.key, operation: change.operation })
    })
    const snapshot = this.#resolver.onSnapshot(value => {
      this.#sse.publish('snapshot', snapshotSignal(value))
    })
    const workbench = this.#workbench?.subscribe(sessionIds => {
      this.#sse.publish('workbench-change', { sessionIds, revision: this.#workbench!.revision })
    }) ?? (() => {})
    return () => {
      workbench()
      snapshot()
      domain()
      route()
      this.#sse.close()
    }
  }

  #warn(message: string): void {
    const logger = (this.#ctx as HostContext & { logger?: { warn(value: string): void } }).logger
    logger?.warn(message)
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const path = url.pathname
      const derivedAssetRequest = path.startsWith('/amphoreus/derived/')
      const write = request.method !== 'GET' && request.method !== 'HEAD' && !derivedAssetRequest
      if (!this.#authorize(request, response, write)) return
      if (path === '/amphoreus/api/state' || path.startsWith('/amphoreus/derived/')) await this.prepareAssets()

      if (path === '/amphoreus' || path === '/amphoreus/workbench') {
        redirect(response, '/amphoreus/workbench/')
        return
      }
      if (path === '/amphoreus/api/state') {
        if (!method(request, response, 'GET')) return
        const state = this.state()
        const tag = `"${state.suite?.fingerprint?.manifestSha256 ?? `generation-${state.revision}`}"`
        if (request.headers['if-none-match'] === tag) {
          response.writeHead(304, { etag: tag, 'cache-control': 'no-store' })
          response.end()
          return
        }
        json(response, 200, state, { etag: tag })
        return
      }
      if (path === '/amphoreus/api/events') {
        if (!method(request, response, 'GET')) return
        this.#sse.add(request, response, snapshotSignal(this.#resolver.current()))
        return
      }
      if (path === '/amphoreus/api/reparse') {
        if (!method(request, response, 'POST')) return
        await this.#resolver.forceReparse()
        json(response, 200, { ok: true, revision: this.#resolver.current()?.generation ?? 0 })
        return
      }
      if (path === '/amphoreus/api/assets/derive') {
        await this.#deriveRoute(request, response)
        return
      }
      if (path === '/amphoreus/api/seats') {
        if (!method(request, response, 'GET')) return
        json(response, 200, { seats: values(this.#stores.main.table('seats').entries()) })
        return
      }
      if (path === '/amphoreus/api/bindings') {
        if (!method(request, response, 'GET')) return
        json(response, 200, { bindings: values(this.#stores.main.table('bindings').entries()) })
        return
      }
      if (path.startsWith('/amphoreus/api/bindings/')) {
        await this.#bindingsRoute(request, response, decodeTail(path, '/amphoreus/api/bindings/'))
        return
      }
      if (path === '/amphoreus/api/memory') {
        if (!method(request, response, 'GET')) return
        json(response, 200, { memory: values(this.#stores.main.table('memory').entries()) })
        return
      }
      if (path.startsWith('/amphoreus/api/memory/')) {
        await this.#memoryRoute(request, response, decodeTail(path, '/amphoreus/api/memory/'))
        return
      }
      if (path === '/amphoreus/api/observations' || path.startsWith('/amphoreus/api/observations/')) {
        await this.#observationsRoute(request, response, path === '/amphoreus/api/observations'
          ? undefined
          : decodeTail(path, '/amphoreus/api/observations/'))
        return
      }
      if (path === '/amphoreus/api/prefs') {
        if (request.method === 'GET') {
          json(response, 200, { prefs: this.#stores.main.global.get().prefs })
          return
        }
        if (!method(request, response, 'PUT')) return
        const input = PrefsInput.parse(await readJson(request))
        const updated = await updateAmphoreusGlobal(this.#stores.main, current => {
          const prefs = {
            ...current.prefs,
            ...(input.quickPhrases === undefined ? {} : { quickPhrases: input.quickPhrases, quickPhrasesInitialized: true }),
            ...(input.lastSeat === undefined ? {} : { lastSeat: input.lastSeat }),
          }
          if (input.magazineMode === null) delete prefs.magazineMode
          else if (input.magazineMode !== undefined) prefs.magazineMode = input.magazineMode
          return { ...current, prefs }
        })
        json(response, 200, { prefs: updated.prefs })
        return
      }
      if (path.startsWith('/amphoreus/api/canvas/')) {
        await this.#canvasRoute(request, response, decodeTail(path, '/amphoreus/api/canvas/'))
        return
      }
      if (path === '/amphoreus/workbench/' || path === '/amphoreus/workbench/index.html') {
        if (!method(request, response, 'GET')) return
        const workbenchConfig = publicWorkbench(this.#config)
        send(response, 200, 'text/html; charset=utf-8', workbenchPage({
          nonce: this.nonce,
          revision: this.#resolver.current()?.generation ?? 0,
          workbench: workbenchConfig,
        }))
        return
      }
      if (path.startsWith('/amphoreus/workbench/api/')) {
        await this.#workbenchRoute(request, response, url)
        return
      }
      if (path.startsWith('/amphoreus/workbench/')) {
        if (!method(request, response, 'GET')) return
        await this.#serveWorkbench(response, decodeTail(path, '/amphoreus/workbench/'))
        return
      }
      if (path.startsWith('/amphoreus/wallpaper/')) {
        if (!method(request, response, 'GET')) return
        await this.#serveWallpaper(response, decodeTail(path, '/amphoreus/wallpaper/'))
        return
      }
      if (path.startsWith('/amphoreus/derived/')) {
        await this.#derivedRoute(request, response, decodeTail(path, '/amphoreus/derived/'))
        return
      }
      if (path.startsWith('/amphoreus/assets/')) {
        if (!method(request, response, 'GET')) return
        await this.#serveLocalAsset(response, decodeTail(path, '/amphoreus/assets/'))
        return
      }
      json(response, 404, { error: 'not found' })
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        json(response, 413, { error: error.message })
        return
      }
      if (!response.headersSent) json(response, 500, { error: error instanceof Error ? error.message : String(error) })
      else if (!response.writableEnded) response.end()
    }
  }

  #effectiveMagazineMode(): 'light' | 'full' {
    return this.#stores.main.global.get().prefs.magazineMode ?? this.#config.magazineMode
  }

  state(): AmphoreusState {
    const snapshot = this.#resolver.current()
    const global = this.#stores.main.global.get()
    return {
      revision: snapshot?.generation ?? 0,
      nonce: this.nonce,
      suite: snapshot === undefined ? undefined : publicSuite(snapshot),
      seats: values(this.#stores.main.table('seats').entries()),
      seatDirs: this.#seatDirs.map(({ heroId, skillName, dir }) => ({ heroId, skillName, dir })),
      bindings: values(this.#stores.main.table('bindings').entries()),
      memory: values(this.#stores.main.table('memory').entries()),
      observations: values(this.#stores.main.table('observations').entries()),
      prefs: global.prefs,
      suiteEvents: values(this.#stores.main.table('suite_events').entries()).sort((a, b) => b.at - a.at),
      canvas: [...this.#stores.canvas.table('canvas').entries()].map(([sessionId, value]) => ({ sessionId, value })),
      assets: {
        root: this.#config.assetsRoot.trim(),
        cacheDir: this.#assetsCacheDir ?? '',
        derivedCount: this.#derived.size,
        derived: [...this.#derived].sort(),
        magick: this.#magick,
        running: this.#deriveRunning,
        lastDerive: this.#lastDerive,
      },
      workbench: {
        status: this.#workbenchStatus(),
        unprojectable: this.#workbench?.unprojectable() ?? [],
      },
      effectiveConfig: {
        wallpaper: this.#config.wallpaper,
        magazineMode: this.#effectiveMagazineMode(),
        magazineModeSource: global.prefs.magazineMode === undefined ? 'config' : 'prefs',
        seatStyle: this.#config.seatStyle,
        assetsConfigured: this.#config.assetsRoot.trim() !== '',
        heroWorkspaceMode: this.#config.heroWorkspaceMode,
        workbench: publicWorkbench(this.#config),
        handoffEnabled: this.#config.handoff.enabled && (snapshot?.features.handoffButtons ?? false),
        receiptParsing: this.#config.receiptParsing && (snapshot?.features.receiptDetection ?? false),
        dispatchHints: snapshot?.features.dispatchHints ?? false,
        pipelinesEnabled: snapshot?.features.pipelines ?? false,
      },
    }
  }

  async #bindingsRoute(request: IncomingMessage, response: ServerResponse, sessionId: string | undefined): Promise<void> {
    if (sessionId === undefined || !SESSION_ID.test(sessionId)) {
      json(response, 400, { error: 'invalid session id' })
      return
    }
    const table = this.#stores.main.table('bindings')
    if (request.method === 'GET') {
      const value = table.get(sessionId)
      if (value === undefined) json(response, 404, { error: 'binding not found' })
      else json(response, 200, { binding: value })
      return
    }
    if (request.method === 'DELETE') {
      const deleted = await table.delete(sessionId)
      json(response, deleted ? 200 : 404, deleted ? { deleted: true } : { error: 'binding not found' })
      return
    }
    if (!method(request, response, 'PUT')) return
    const input = BindInput.parse(await readJson(request))
    const snapshot = this.#resolver.current()
    const seat = this.#stores.main.table('seats').get(input.skill)
    const card = snapshot?.cards.get(input.skill)
    if (seat === undefined && card === undefined) {
      json(response, 404, { error: 'seat not found' })
      return
    }
    if (seat?.status === 'undeployed' && card === undefined) {
      json(response, 409, { error: 'seat is undeployed' })
      return
    }
    if (input.face !== undefined && card !== undefined && !card.faces.includes(input.face)) {
      json(response, 400, { error: 'unknown seat face' })
      return
    }
    const old = table.get(sessionId)
    const now = Date.now()
    const sameSeat = old?.skillName === input.skill && old.face === input.face
    const value = BindingSchema.parse({
      sessionId,
      skillName: input.skill,
      boundAt: sameSeat ? old.boundAt : now,
      source: input.boundBy,
      injection: sameSeat ? old.injection : { state: this.#config.autoInvoke.enabled ? 'pending' : 'skipped', ...(!this.#config.autoInvoke.enabled ? { reason: 'auto-invoke-disabled' } : {}) },
      ...(input.face === undefined ? {} : { face: input.face }),
      ...(input.fromSessionId === undefined ? {} : { handoffFrom: { sessionId: input.fromSessionId, seq: input.fromSeq ?? 0 } }),
    })
    await table.put(sessionId, value)
    json(response, 200, { binding: value })
  }

  async #memoryRoute(request: IncomingMessage, response: ServerResponse, skill: string | undefined): Promise<void> {
    if (skill === undefined || !SKILL_NAME.test(skill)) {
      json(response, 400, { error: 'invalid skill name' })
      return
    }
    const table = this.#stores.main.table('memory')
    if (request.method === 'GET') {
      json(response, 200, { memory: table.get(skill) })
      return
    }
    if (!method(request, response, 'PUT')) return
    const body = await readJson(request, 64 * 1024)
    const value = MemorySchema.parse({ ...asRecord(body), skillName: skill, updatedAt: Date.now() })
    await table.put(skill, value)
    json(response, 200, { memory: value })
  }

  async #observationsRoute(request: IncomingMessage, response: ServerResponse, key: string | undefined): Promise<void> {
    const table = this.#stores.main.table('observations')
    if (key === undefined) {
      if (request.method === 'GET') {
        const sessionId = new URL(request.url ?? '/', 'http://localhost').searchParams.get('sessionId')
        const observations = values(table.entries()).filter(value => sessionId === null || value.sessionId === sessionId)
        json(response, 200, { observations })
        return
      }
      if (!method(request, response, 'POST')) return
      const parsed = ObservationCreateInput.safeParse(await readJson(request, 64 * 1024))
      if (!parsed.success) {
        json(response, 400, { error: zodError(parsed.error) })
        return
      }
      const input = parsed.data
      const snapshot = this.#resolver.current()
      const seat = this.#stores.main.table('seats').get(input.targetSkillName)
      const card = snapshot?.cards.get(input.targetSkillName)
      if (seat === undefined && card === undefined) {
        json(response, 404, { error: 'seat not found' })
        return
      }
      if (seat?.status === 'undeployed' && card === undefined) {
        json(response, 409, { error: 'seat is undeployed' })
        return
      }
      const value = ObservationSchema.parse({
        sessionId: input.sessionId,
        seq: input.seq,
        kind: 'dispatch',
        skillName: input.targetSkillName,
        targetSkillName: input.targetSkillName,
        targetDisplayName: card?.displayName ?? seat?.displayName,
        rawLine: input.payload.slice(0, 200),
        payload: input.payload,
        parsedAt: Date.now(),
        status: 'accepted',
        acceptedSessionId: input.sessionId,
        dispatchedFrom: input.dispatchedFrom,
        ...(input.pipeline === undefined ? {} : { pipeline: input.pipeline }),
        ...(input.station === undefined ? {} : { station: input.station }),
      })
      await table.put(`${input.sessionId}:${input.seq}:dispatch`, value)
      json(response, 201, { observation: value })
      return
    }

    if (!OBSERVATION_KEY.test(key)) {
      json(response, 400, { error: 'invalid observation key' })
      return
    }
    if (!method(request, response, 'PUT')) return
    const current = table.get(key)
    if (current === undefined) {
      json(response, 404, { error: 'observation not found' })
      return
    }
    const parsed = ObservationPatchInput.safeParse(await readJson(request, 64 * 1024))
    if (!parsed.success) {
      json(response, 400, { error: zodError(parsed.error) })
      return
    }
    const next = await table.update(key, value => ({
      ...value,
      status: parsed.data.status,
      ...(parsed.data.acceptedSessionId === undefined ? {} : { acceptedSessionId: parsed.data.acceptedSessionId }),
    }))
    json(response, 200, { observation: next })
  }

  async #canvasRoute(request: IncomingMessage, response: ServerResponse, sessionId: string | undefined): Promise<void> {
    if (sessionId === undefined || !SESSION_ID.test(sessionId)) {
      json(response, 400, { error: 'invalid session id' })
      return
    }
    const table = this.#stores.canvas.table('canvas')
    if (request.method === 'GET') {
      json(response, 200, { canvas: table.get(sessionId) })
      return
    }
    if (!method(request, response, 'PUT')) return
    const rawRevision = request.headers['x-amphoreus-canvas-revision']
    const revision = parseCanvasRevision(rawRevision)
    if (revision === null) {
      json(response, 400, { error: 'invalid canvas revision' })
      return
    }
    const value = CanvasSchema.parse({ ...asRecord(await readJson(request, MAX_CANVAS_BODY_BYTES)), updatedAt: Date.now() })
    if (revision !== undefined) {
      const seen = this.#canvasRevisions.get(sessionId) ?? -1
      if (revision <= seen) {
        json(response, 200, { canvas: table.get(sessionId), stale: true, revision: seen })
        return
      }
      this.#canvasRevisions.set(sessionId, revision)
    }
    await table.put(sessionId, value)
    json(response, 200, { canvas: value, ...(revision === undefined ? {} : { stale: false, revision }) })
  }

  /**
   * Workbench projection API. Reads are open to trusted hosts; writes carry
   * the same nonce gate as the rest of the plugin API. When the store failed
   * to open, every route answers 503 so the iframe shows one clear error.
   */
  async #workbenchRoute(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const status = this.#workbenchStatus()
    const store = this.#workbench
    if (status.kind !== 'ready' || store === undefined) {
      json(response, 503, {
        error: status.kind === 'disabled'
          ? '工作台已在配置中关闭（workbench.enabled=false）'
          : status.kind === 'unavailable'
            ? status.reason
            : '工作台存储不可用',
      })
      return
    }
    const path = url.pathname
    try {
      if (path === '/amphoreus/workbench/api/index') {
        if (!method(request, response, 'GET')) return
        store.flush()
        const tag = `"wb-${store.revision}"`
        if (request.headers['if-none-match'] === tag) {
          response.writeHead(304, { etag: tag, 'cache-control': 'no-store' })
          response.end()
          return
        }
        json(response, 200, {
          revision: store.revision,
          sessions: store.list(url.searchParams.get('includeHidden') === '1'),
          unprojectable: store.unprojectable(),
        }, { etag: tag })
        return
      }

      const sessionId = decodeTail(path, '/amphoreus/workbench/api/index/')
      if (path.startsWith('/amphoreus/workbench/api/index/') && sessionId !== undefined && SESSION_ID.test(sessionId)) {
        if (request.method === 'GET') {
          const session = store.get(sessionId)
          if (session === undefined) json(response, 404, { error: '会话不在索引中' })
          else json(response, 200, { session })
          return
        }
        if (request.method === 'DELETE') {
          json(response, 200, await store.hide(sessionId))
          return
        }
        response.writeHead(405, { allow: 'GET, DELETE' })
        response.end()
        return
      }
      json(response, 404, { error: '接口不存在' })
    } catch (error) {
      if (error instanceof InputError) json(response, 400, { error: error.message })
      else if (error instanceof NotFoundError) json(response, 404, { error: error.message })
      else throw error
    }
  }

  async #serveWorkbench(response: ServerResponse, name: string | undefined): Promise<void> {
    if (name === undefined || !['app.js', 'styles.css', 'mark.svg'].includes(name)) {
      json(response, 404, { error: 'not found' })
      return
    }
    const path = join(this.#workbenchDir, name)
    send(response, 200, mediaType(path), await readFile(path))
  }

  async #serveWallpaper(response: ServerResponse, name: string | undefined): Promise<void> {
    if (name === undefined || !GLOBAL_WALLPAPERS.includes(name as typeof GLOBAL_WALLPAPERS[number])) {
      json(response, 404, { error: 'wallpaper not found' })
      return
    }
    const configured = this.#config.assetsRoot.trim()
    const directory = configured === '' ? ['昔涟壁纸'] : await resolveGlobalWallpaperDir(resolve(configured))
    await this.#serveAssetPath(response, [...directory, name])
  }

  async #deriveRoute(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!method(request, response, 'POST')) return
    if (this.#deriveRunning) {
      json(response, 409, { error: 'asset derivation is already running' })
      return
    }
    let body: unknown
    try {
      body = await readJson(request)
    } catch (error) {
      if (error instanceof BodyTooLargeError) throw error
      json(response, 400, { error: 'invalid derive request' })
      return
    }
    const parsed = DeriveInput.safeParse(body)
    if (!parsed.success) {
      json(response, 400, { error: 'invalid derive request' })
      return
    }
    const assetsRoot = this.#config.assetsRoot.trim()
    if (assetsRoot === '') {
      json(response, 400, { error: 'assetsRoot is not configured' })
      return
    }
    const cacheDir = this.#assetsCacheDir
    if (cacheDir === undefined) {
      json(response, 400, { error: 'assets cache is not configured' })
      return
    }
    if (this.#deriveRunning) {
      json(response, 409, { error: 'asset derivation is already running' })
      return
    }
    this.#deriveRunning = true
    const generation = ++this.#deriveGeneration
    this.#publishAssetState('put')
    json(response, 202, { started: true })
    queueMicrotask(() => { void this.#runDerive(generation, assetsRoot, cacheDir, parsed.data.force === true) })
  }

  async #runDerive(generation: number, assetsRoot: string, cacheDir: string, force: boolean): Promise<void> {
    let written = 0
    let failed = 0
    let error: string | undefined
    try {
      const result = await this.#deriveAssets({
        assetsRoot,
        cacheDir,
        force,
        onProgress: (progress: DeriveProgress) => {
          if (this.#deriveRunning && generation === this.#deriveGeneration) {
            this.#publishSse('derive-progress', {
              ...progress,
              current: boundedText(progress.current, 500),
              ...(progress.error === undefined ? {} : { error: boundedText(progress.error, 2_000) }),
            })
          }
        },
      })
      written = result.written
      failed = result.failed.length
      if (failed > 0) error = boundedText(result.failed[0]?.error ?? `${failed} derived assets failed`, 2_000)
    } catch (cause) {
      failed = 1
      error = boundedText(cause instanceof Error ? cause.message : String(cause), 2_000)
    }
    try {
      await this.#scanDerived()
    } catch (cause) {
      failed = Math.max(1, failed)
      const scanError = boundedText(cause instanceof Error ? cause.message : String(cause), 2_000)
      error = boundedText(error === undefined ? scanError : `${error}; cache scan failed: ${scanError}`, 2_000)
    }
    if (generation !== this.#deriveGeneration) return
    this.#lastDerive = {
      at: Date.now(),
      written,
      failed,
      ...(error === undefined ? {} : { error }),
    }
    this.#deriveRunning = false
    this.#publishAssetState('put')
  }

  #publishAssetState(operation: 'put' | 'remove'): void {
    this.#publishSse('state-change', { domain: 'amphoreus', table: 'assets', key: 'derive', operation })
  }

  #publishSse(event: string, value: unknown): void {
    try {
      this.#sse.publish(event, value)
    } catch (error) {
      this.#warn(`amphoreus SSE publish failed (${event}): ${String(error)}`)
    }
  }

  derivedWallpaperUrl(index: number): string | null {
    if (!this.#assetsPrepared || !Number.isSafeInteger(index) || index < 0 || index >= GLOBAL_WALLPAPERS.length) return null
    return this.#derivedUrl('_global', `wallpaper-${index}.webp`)
  }

  #derivedUrl(directory: string, file: string): string | null {
    return this.#derived.has(`${directory}/${file}`) ? `/amphoreus/derived/${directory}/${file}` : null
  }

  async #scanDerived(): Promise<void> {
    const next = new Set<string>()
    const configured = this.#assetsCacheDir
    if (configured === undefined) {
      this.#assetsCacheRealDir = undefined
      this.#derived = next
      return
    }
    let root: string
    try {
      root = await realpath(configured)
      if (!(await stat(root)).isDirectory()) throw new Error('assets cache is not a directory')
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        this.#assetsCacheRealDir = undefined
        this.#derived = next
        return
      }
      throw error
    }
    const directories = (await readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && /^[a-z0-9_]+$/u.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const directory of directories) {
      let files
      try {
        files = await readdir(join(root, directory.name), { withFileTypes: true })
      } catch (error) {
        if (isErrno(error, 'ENOENT')) continue
        throw error
      }
      for (const file of files
        .filter(entry => entry.isFile() && /^[a-z0-9-]+\.webp$/u.test(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
        next.add(`${directory.name}/${file.name}`)
      }
    }
    this.#assetsCacheRealDir = root
    this.#derived = next
  }

  async #derivedRoute(request: IncomingMessage, response: ServerResponse, rel: string | undefined): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' })
      response.end()
      return
    }
    const match = rel === undefined ? null : /^([a-z0-9_]+)\/([a-z0-9-]+\.webp)$/u.exec(rel)
    const root = this.#assetsCacheRealDir
    const key = match === null ? undefined : `${match[1]}/${match[2]}`
    if (match === null || root === undefined || key === undefined || !this.#derived.has(key)) {
      json(response, 404, { error: 'derived asset not found' })
      return
    }
    const candidate = join(root, match[1]!, match[2]!)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let handle
      try {
        const beforeResolved = await realpath(candidate)
        if (!contained(root, beforeResolved)) throw new Error('derived asset escaped cache directory')
        const beforeInfo = await stat(beforeResolved)
        if (!beforeInfo.isFile()) throw new Error('derived asset is not a file')
        handle = await open(beforeResolved, 'r')
        const afterResolved = await realpath(candidate)
        if (!contained(root, afterResolved) || !samePath(beforeResolved, afterResolved)) {
          throw new Error('derived asset changed during lookup')
        }
        const pathInfo = await stat(afterResolved)
        const openedInfo = await handle.stat()
        if (!openedInfo.isFile() || openedInfo.dev !== pathInfo.dev || openedInfo.ino !== pathInfo.ino) {
          throw new Error('derived asset changed during lookup')
        }
        const headers = {
          'content-type': 'image/webp',
          'content-length': String(openedInfo.size),
          'cache-control': 'private, max-age=86400',
          'x-content-type-options': 'nosniff',
        }
        if (request.method === 'HEAD') {
          response.writeHead(200, headers)
          response.end()
          return
        }
        const body = await handle.readFile()
        send(response, 200, 'image/webp', body, { 'content-length': String(body.byteLength), 'cache-control': headers['cache-control'] })
        return
      } catch (error) {
        const lookupFailure = isErrno(error, 'ENOENT') || (error instanceof Error && error.message.startsWith('derived asset '))
        if (!lookupFailure) throw error
        if (attempt === 0) {
          await new Promise<void>(resolveRetry => setImmediate(resolveRetry))
          continue
        }
        if (this.#derived.delete(key)) {
          this.#sse.publish('state-change', { domain: 'amphoreus', table: 'assets', key, operation: 'remove' })
        }
        json(response, 404, { error: 'derived asset not found' })
        return
      } finally {
        await handle?.close()
      }
    }
  }

  async #serveLocalAsset(response: ServerResponse, rel: string | undefined): Promise<void> {
    if (rel === undefined) {
      json(response, 404, { error: 'asset not found' })
      return
    }
    const segments = rel.replaceAll('\\', '/').split('/')
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
      json(response, 400, { error: 'invalid asset path' })
      return
    }
    await this.#serveAssetPath(response, segments)
  }

  async #serveAssetPath(response: ServerResponse, segments: readonly string[]): Promise<void> {
    const configured = this.#config.assetsRoot.trim()
    if (configured === '') {
      json(response, 404, { error: 'assetsRoot is not configured' })
      return
    }
    const root = await realpath(resolve(configured))
    const candidate = await realpath(join(root, ...segments))
    if (!contained(root, candidate) || !(await stat(candidate)).isFile()) {
      json(response, 404, { error: 'asset not found' })
      return
    }
    send(response, 200, mediaType(candidate), await readFile(candidate))
  }

  #authorize(request: IncomingMessage, response: ServerResponse, write: boolean): boolean {
    if (!trustedHost(request.headers.host, this.#config.trustedHosts)) {
      send(response, 403, 'text/plain; charset=utf-8', 'forbidden')
      return false
    }
    const rejection = this.#ctx.connection?.requestRejection(request)
    if (rejection !== undefined) {
      send(response, rejection, 'text/plain; charset=utf-8', rejection === 401 ? 'unauthorized' : 'forbidden')
      return false
    }
    if (!write) return true
    if (request.method !== 'DELETE' && !(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      json(response, 415, { error: 'application/json required' })
      return false
    }
    if (request.headers['x-amphoreus-nonce'] !== this.nonce) {
      json(response, 403, { error: 'invalid amphoreus nonce' })
      return false
    }
    return true
  }
}

export function publicSuite(snapshot: SuiteSnapshot): PublicSuite {
  return {
    parserVersion: snapshot.parserVersion,
    parsedAt: snapshot.parsedAt,
    generation: snapshot.generation,
    level: snapshot.level,
    features: snapshot.features,
    roots: snapshot.roots.map(root => ({ index: root.index, configured: root.configured, canonical: root.canonical })),
    cards: [...snapshot.cards.values()].map(card => ({
      name: card.name,
      displayName: card.displayName,
      aliases: card.aliases,
      faces: card.faces,
      description: card.frontmatter.description,
      duties: card.duties,
      modelInvocable: card.modelInvocable,
      userInvocable: card.userInvocable,
      hasPersona: card.hasPersona,
      status: card.status,
      ...(card.ordinal === undefined ? {} : { ordinal: card.ordinal }),
    })).sort((left, right) => (left.ordinal ?? Number.MAX_SAFE_INTEGER) - (right.ordinal ?? Number.MAX_SAFE_INTEGER) || left.name.localeCompare(right.name, 'en')),
    dispatch: snapshot.dispatch.map(row => ({ needs: row.needs, roleText: row.roleText, skill: row.skill, ...(row.face === undefined ? {} : { face: row.face }) })),
    pipelines: snapshot.pipelines.map(pipeline => ({
      name: pipeline.name,
      source: pipeline.source,
      stations: pipeline.stations.map(station => ({
        text: station.text,
        ...(station.to === undefined ? {} : { skill: station.to.skill, ...(station.to.face === undefined ? {} : { face: station.to.face }) }),
      })),
    })),
    diagnostics: snapshot.diagnostics.map(diagnostic => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      detail: diagnostic.detail,
      ...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
      ...(diagnostic.skill === undefined ? {} : { skill: diagnostic.skill }),
    })),
    ...(snapshot.root === undefined ? {} : { root: { configured: snapshot.root.configured, canonical: snapshot.root.canonical } }),
    ...(snapshot.fingerprint === undefined ? {} : { fingerprint: {
      manifestSha256: snapshot.fingerprint.manifestSha256,
      label: snapshot.fingerprint.label,
      fileCount: snapshot.fingerprint.fileCount,
      computedAt: snapshot.fingerprint.computedAt,
    } }),
    ...(snapshot.contracts === undefined ? {} : { contracts: {
      ...(snapshot.contracts.receipt === undefined ? {} : { receipt: { source: snapshot.contracts.receipt.regex.source, tiers: snapshot.contracts.receipt.tiers } }),
      absence: { template: snapshot.contracts.absence.template, fromFile: snapshot.contracts.absence.fromFile, ...(snapshot.contracts.absence.regex === undefined ? {} : { source: snapshot.contracts.absence.regex.source }) },
      handoff: { template: snapshot.contracts.handoff.template, verb: snapshot.contracts.handoff.verb, fromFile: snapshot.contracts.handoff.fromFile, ...(snapshot.contracts.handoff.regex === undefined ? {} : { source: snapshot.contracts.handoff.regex.source }) },
      firewallWords: snapshot.contracts.firewallWords,
    } }),
  }
}

function snapshotSignal(snapshot: SuiteSnapshot | undefined): unknown {
  return snapshot === undefined
    ? { generation: 0, level: 'loading' }
    : { generation: snapshot.generation, level: snapshot.level, fingerprint: snapshot.fingerprint?.label }
}

function values<V>(entries: IterableIterator<[string, V]>): V[] {
  return [...entries].map(([, value]) => value)
}

function method(request: IncomingMessage, response: ServerResponse, expected: string): boolean {
  if (request.method === expected) return true
  response.writeHead(405, { allow: expected })
  response.end()
  return false
}

async function readJson(request: IncomingMessage, limit = MAX_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new BodyTooLargeError(limit)
    chunks.push(buffer)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function parseCanvasRevision(value: string | string[] | undefined): number | null | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return null
  const revision = Number(value)
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('JSON object required')
  return value as Record<string, unknown>
}

function zodError(error: z.ZodError): string {
  return error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`).join('; ')
}

function decodeTail(path: string, prefix: string): string | undefined {
  try {
    const value = decodeURIComponent(path.slice(prefix.length))
    return value === '' ? undefined : value
  } catch {
    return undefined
  }
}

export function trustedHost(value: string | undefined, extras: readonly string[]): boolean {
  if (value === undefined) return false
  const host = value.toLowerCase()
  if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/u.test(host) || /^\[::1\](?::\d+)?$/u.test(host)) return true
  return extras.some(extra => extra.trim().toLowerCase() === host)
}

function contained(root: string, child: string): boolean {
  const fold = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value
  const base = fold(resolve(root))
  const target = fold(resolve(child))
  const rel = relative(base, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right)
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === code
}

function boundedText(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit)
}

export function workbenchPage(boot: WorkbenchBoot): string {
  const serializedBoot = JSON.stringify(boot).replaceAll('<', '\\u003c')
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>δ-me13 工作台</title><link rel="stylesheet" href="/amphoreus/workbench/styles.css"></head><body><div id="app"></div><script>globalThis.__AMPHOREUS_BOOT__=' + serializedBoot + '</script><script src="/amphoreus/workbench/app.js"></script></body></html>'
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { location })
  response.end()
}

function json(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  send(response, status, 'application/json; charset=utf-8', JSON.stringify(value), headers)
}

function send(response: ServerResponse, status: number, contentType: string, body: string | Buffer, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers })
  response.end(body)
}

function mediaType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.svg': return 'image/svg+xml; charset=utf-8'
    case '.png': return 'image/png'
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    default: return 'application/octet-stream'
  }
}
