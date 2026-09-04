import type { Context } from '@deepseek-ai/cordis'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import { randomBytes } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { AmphoreusState, PublicSuite, WorkbenchBoot, WorkbenchStatus } from '../shared/api.ts'
import { GLOBAL_WALLPAPERS, heroVisualOf } from '../shared/heroes.ts'
import type { AmphoreusConfig } from './config.ts'
import { publicWorkbench } from './firstframe.ts'
import { BindingSchema, CanvasSchema, MemorySchema, type AmphoreusStores } from './store.ts'
import type { SuiteResolver } from './bridge.ts'
import type { SuiteSnapshot } from './suite/types.ts'
import { InputError, NotFoundError, type WorkbenchStore } from './workbench.ts'
import type { SeatDirRecord } from './seatdirs.ts'

const MAX_BODY_BYTES = 4 * 1024
const MAX_SSE_CLIENTS = 8
const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const WORKBENCH_DIR = fileURLToPath(new URL('../workbench/', import.meta.url))

const BindInput = z.object({
  skill: z.string(),
  face: z.string().optional(),
  boundBy: z.enum(['seat-new', 'seat-enter', 'handoff', 'handoff-fork', 'fork-inherit', 'manual']),
  fromSessionId: z.string().optional(),
  fromSeq: z.number().int().nonnegative().optional(),
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
  readonly workbench?: WorkbenchStore
  readonly workbenchStatus?: () => WorkbenchStatus
  readonly seatDirs?: readonly SeatDirRecord[]
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
  readonly #workbench: WorkbenchStore | undefined
  readonly #workbenchStatus: () => WorkbenchStatus
  readonly #seatDirs: readonly SeatDirRecord[]
  readonly #sse = new SseHub()

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
    this.nonce = options.nonce ?? randomBytes(24).toString('base64url')
  }

  register(): () => void {
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
    return () => {
      snapshot()
      domain()
      route()
      this.#sse.close()
    }
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const write = request.method !== 'GET' && request.method !== 'HEAD'
      if (!this.#authorize(request, response, write)) return
      const path = url.pathname

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
      if (path === '/amphoreus/api/observations') {
        if (!method(request, response, 'GET')) return
        json(response, 200, { observations: values(this.#stores.main.table('observations').entries()) })
        return
      }
      if (path.startsWith('/amphoreus/api/canvas/')) {
        await this.#canvasRoute(request, response, decodeTail(path, '/amphoreus/api/canvas/'))
        return
      }
      if (path === '/amphoreus/workbench/' || path === '/amphoreus/workbench/index.html') {
        if (!method(request, response, 'GET')) return
        send(response, 200, 'text/html; charset=utf-8', workbenchPage({
          nonce: this.nonce,
          revision: this.#resolver.current()?.generation ?? 0,
          workbench: publicWorkbench(this.#config),
        }))
        return
      }
      if (path.startsWith('/amphoreus/workbench/api/')) {
        await this.#workbenchRoute(request, response, path)
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
      if (path.startsWith('/amphoreus/assets/')) {
        if (!method(request, response, 'GET')) return
        await this.#serveLocalAsset(response, decodeTail(path, '/amphoreus/assets/'))
        return
      }
      json(response, 404, { error: 'not found' })
    } catch (error) {
      if (!response.headersSent) json(response, 500, { error: error instanceof Error ? error.message : String(error) })
      else if (!response.writableEnded) response.end()
    }
  }

  state(): AmphoreusState {
    const snapshot = this.#resolver.current()
    return {
      revision: snapshot?.generation ?? 0,
      nonce: this.nonce,
      suite: snapshot === undefined ? undefined : publicSuite(snapshot),
      seats: values(this.#stores.main.table('seats').entries()),
      bindings: values(this.#stores.main.table('bindings').entries()),
      memory: values(this.#stores.main.table('memory').entries()),
      observations: values(this.#stores.main.table('observations').entries()),
      suiteEvents: values(this.#stores.main.table('suite_events').entries()).sort((a, b) => b.at - a.at),
      canvas: [...this.#stores.canvas.table('canvas').entries()].map(([sessionId, value]) => ({ sessionId, value })),
      workbench: {
        status: this.#workbenchStatus(),
        unprojectable: this.#workbench?.unprojectable() ?? [],
      },
      effectiveConfig: {
        wallpaper: this.#config.wallpaper,
        magazineMode: this.#config.magazineMode,
        seatStyle: this.#config.seatStyle,
        assetsConfigured: this.#config.assetsRoot.trim() !== '',
        heroWorkspaceMode: this.#config.heroWorkspaceMode,
        workbench: publicWorkbench(this.#config),
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
    const value = BindingSchema.parse({
      sessionId,
      skillName: input.skill,
      boundAt: old?.boundAt ?? now,
      source: input.boundBy,
      injection: { state: this.#config.autoInvoke.enabled ? 'pending' : 'skipped', ...(!this.#config.autoInvoke.enabled ? { reason: 'auto-invoke-disabled' } : {}) },
      ...(input.face === undefined ? {} : { face: input.face }),
      ...(input.fromSessionId === undefined ? {} : { handoffFrom: { sessionId: input.fromSessionId, seq: input.fromSeq ?? 0 } }),
    })
    await table.put(sessionId, value)
    json(response, 200, { binding: value })
  }

  async #memoryRoute(request: IncomingMessage, response: ServerResponse, skill: string | undefined): Promise<void> {
    if (skill === undefined || !/^amphoreus-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(skill)) {
      json(response, 400, { error: 'invalid skill name' })
      return
    }
    const table = this.#stores.main.table('memory')
    if (request.method === 'GET') {
      json(response, 200, { memory: table.get(skill) })
      return
    }
    if (!method(request, response, 'PUT')) return
    const body = await readJson(request)
    const value = MemorySchema.parse({ ...asRecord(body), skillName: skill, updatedAt: Date.now() })
    await table.put(skill, value)
    json(response, 200, { memory: value })
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
    const value = CanvasSchema.parse({ ...asRecord(await readJson(request)), updatedAt: Date.now() })
    await table.put(sessionId, value)
    json(response, 200, { canvas: value })
  }

  /**
   * Workbench projection API. Reads are open to trusted hosts; writes carry
   * the same nonce gate as the rest of the plugin API. When the store failed
   * to open, every route answers 503 so the iframe shows one clear error.
   */
  async #workbenchRoute(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
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
    try {
      if (path === '/amphoreus/workbench/api/workspaces') {
        if (!method(request, response, 'GET')) return
        const snapshot = this.#resolver.current()
        const assetsConfigured = this.#config.assetsRoot.trim() !== ''
        json(response, 200, {
          workspaces: await store.list(),
          seats: this.#seatDirs.map(entry => {
            const visual = heroVisualOf(entry.skillName)
            const card = snapshot?.cards.get(entry.skillName)
            return {
              heroId: entry.heroId,
              skillName: entry.skillName,
              dir: entry.dir,
              displayName: card?.displayName ?? null,
              duties: card?.duties ?? [],
              ordinal: card?.ordinal ?? null,
              deployed: card !== undefined,
              order: visual?.order ?? 99,
              accent: visual?.palette.accent ?? null,
              accent2: visual?.palette.accent2 ?? null,
              lightBase: visual?.palette.lightBase ?? null,
              darkBase: visual?.palette.darkBase ?? null,
              // Chronicle art (英雄纪) as the portal card face; card art as detail bg.
              chronicleUrl: assetsConfigured && visual !== undefined
                ? `/amphoreus/assets/${encodeURIComponent('翁法罗斯英雄纪')}/${encodeURIComponent(visual.assets.chronicle)}`
                : null,
              cardUrl: assetsConfigured && visual !== undefined
                ? `/amphoreus/assets/${encodeURIComponent('翁法罗斯如我所书卡牌')}/${encodeURIComponent(visual.assets.card)}`
                : null,
              stickerUrl: assetsConfigured && visual !== undefined
                ? `/amphoreus/assets/${encodeURIComponent('表情包')}/${encodeURIComponent(visual.assets.sticker)}`
                : null,
            }
          }).sort((left, right) => left.order - right.order),
          assetsConfigured,
          unprojectable: store.unprojectable(),
        })
        return
      }
      const workspace = /^\/amphoreus\/workbench\/api\/workspaces\/([A-Za-z0-9:_-]+)$/.exec(path)
      if (workspace !== null) {
        if (!method(request, response, 'GET')) return
        json(response, 200, { workspace: await store.get(workspace[1]!) })
        return
      }
      const branch = /^\/amphoreus\/workbench\/api\/threads\/([0-9a-f-]+)\/branch$/i.exec(path)
      if (branch !== null) {
        if (!method(request, response, 'POST')) return
        json(response, 201, { thread: await store.branch(branch[1]!, asRecord(await readJson(request))) })
        return
      }
      const notes = /^\/amphoreus\/workbench\/api\/threads\/([0-9a-f-]+)\/messages$/i.exec(path)
      if (notes !== null) {
        if (!method(request, response, 'POST')) return
        const body = asRecord(await readJson(request))
        json(response, 201, { thread: await store.addNote(notes[1]!, String(body.text ?? '')) })
        return
      }
      const thread = /^\/amphoreus\/workbench\/api\/threads\/([0-9a-f-]+)$/i.exec(path)
      if (thread !== null && request.method === 'PATCH') {
        json(response, 200, { thread: await store.updateThread(thread[1]!, asRecord(await readJson(request))) })
        return
      }
      if (thread !== null && request.method === 'DELETE') {
        json(response, 200, await store.removeThread(thread[1]!))
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
    await this.#serveAssetPath(response, ['昔涟壁纸', name])
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
    if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
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

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`)
    chunks.push(buffer)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('JSON object required')
  return value as Record<string, unknown>
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

export function workbenchPage(boot: WorkbenchBoot): string {
  const serializedBoot = JSON.stringify(boot).replaceAll('<', '\\u003c')
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>翁法罗斯工作台</title><link rel="stylesheet" href="/amphoreus/workbench/styles.css"></head><body><div id="app"></div><script>globalThis.__AMPHOREUS_BOOT__=' + serializedBoot + '</script><script src="/amphoreus/workbench/app.js"></script></body></html>'
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
