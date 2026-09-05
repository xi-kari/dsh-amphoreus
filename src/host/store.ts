import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export const InjectionSchema = z.object({
  state: z.enum(['pending', 'done', 'skipped', 'failed']),
  at: z.number().optional(),
  reason: z.string().optional(),
})

export const SeatSchema = z.object({
  skillName: z.string(),
  heroId: z.string().nullable(),
  displayName: z.string(),
  aliases: z.array(z.string()),
  duties: z.array(z.string()).default([]),
  lastDuty: z.string().optional(),
  status: z.enum(['deployed', 'undeployed']),
  renamedFrom: z.string().optional(),
  renamedTo: z.string().optional(),
  order: z.number().int(),
  firstSeenAt: z.number(),
  lastSeenAt: z.number(),
  lastSeenRevision: z.string().optional(),
  userOrder: z.number().int().optional(),
  userDisplayName: z.string().optional(),
  hidden: z.boolean().optional(),
})

export const BindingSchema = z.object({
  sessionId: z.string(),
  skillName: z.string(),
  face: z.string().optional(),
  boundAt: z.number(),
  source: z.enum(['seat-new', 'seat-enter', 'handoff', 'handoff-fork', 'fork-inherit', 'manual', 'dispatch']),
  injection: InjectionSchema,
  handoffFrom: z.object({ sessionId: z.string(), seq: z.number().int().nonnegative() }).optional(),
  orphaned: z.boolean().optional(),
})

export const MemoryNoteSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.number(),
  sessionId: z.string().optional(),
  seq: z.number().int().nonnegative().optional(),
})

export const MemorySchema = z.object({
  skillName: z.string(),
  notes: z.array(MemoryNoteSchema),
  pinnedSessionIds: z.array(z.string()),
  quickPhrases: z.array(z.string()).optional(),
  updatedAt: z.number(),
})

export const ObservationSchema = z.object({
  sessionId: z.string(),
  seq: z.number().int().nonnegative(),
  kind: z.enum(['handoff', 'notify', 'receipt', 'absence', 'dispatch']),
  skillName: z.string().optional(),
  targetSkillName: z.string().nullable().optional(),
  targetDisplayName: z.string().optional(),
  targetFace: z.string().optional(),
  rawLine: z.string(),
  payload: z.string().optional(),
  tier: z.string().optional(),
  parsedAt: z.number(),
  status: z.enum(['open', 'accepted', 'dismissed']),
  acceptedSessionId: z.string().optional(),
  dispatchedFrom: z.enum(['panel', 'rail', 'pipeline']).optional(),
  pipeline: z.string().optional(),
  station: z.number().int().nonnegative().optional(),
})

export const SuiteEventSchema = z.object({
  at: z.number(),
  kind: z.enum(['parsed', 'degraded', 'missing', 'seat-added', 'seat-removed', 'seat-renamed', 'synced', 'validated']),
  detail: z.string(),
})

export const GlobalSchema = z.object({
  dataVersion: z.literal(1),
  seeded: z.boolean(),
  suite: z.object({
    revision: z.string().optional(),
    kind: z.enum(['git', 'digest', 'none']),
    rootPath: z.string().optional(),
    parsedAt: z.number(),
    status: z.enum(['ok', 'degraded', 'missing']),
    degradedReasons: z.array(z.string()),
  }),
  prefs: z.object({
    lastSeat: z.string().nullable(),
    wallpaperCursor: z.number().int().nonnegative(),
    quickPhrases: z.array(z.string()),
    quickPhrasesInitialized: z.boolean().default(false),
    magazineMode: z.enum(['light', 'full']).optional(),
    grammar: z.object({
      enabled: z.boolean().optional(),
      blurScale: z.number().min(0).max(2).optional(),
      frostScale: z.number().min(0.6).max(1.4).optional(),
      scrimBoost: z.number().min(0).max(0.4).optional(),
      motifScale: z.number().min(0).max(1).optional(),
      mascot: z.enum(['reactive', 'static', 'off']).optional(),
      ambient: z.boolean().optional(),
    }).optional(),
    customWallpapers: z.record(z.string(), z.object({
      fit: z.enum(['cover', 'contain', 'fill']).optional(),
      x: z.number().min(0).max(100).optional(),
      y: z.number().min(0).max(100).optional(),
      scale: z.number().min(1).max(3).optional(),
      playbackRate: z.number().min(0.25).max(2).optional(),
      muted: z.boolean().optional(),
      loop: z.boolean().optional(),
      paused: z.boolean().optional(),
    })).optional(),
  }),
  workbench: z.object({
    hiddenSessionIds: z.array(z.string()).default([]),
  }).default({ hiddenSessionIds: [] }),
  synapseMigratedFrom: z.string().optional(),
})

export const CanvasSchema = z.object({
  positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
  collapsed: z.array(z.string()),
  branchAnchors: z.record(z.string(), z.number().int().nonnegative()),
  camera: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }).optional(),
  updatedAt: z.number(),
})

export type SeatRecord = z.infer<typeof SeatSchema>
export type BindingRecord = z.infer<typeof BindingSchema>
export type MemoryRecord = z.infer<typeof MemorySchema>
export type ObservationRecord = z.infer<typeof ObservationSchema>
export type SuiteEventRecord = z.infer<typeof SuiteEventSchema>
export type AmphoreusGlobal = z.infer<typeof GlobalSchema>
export type CanvasRecord = z.infer<typeof CanvasSchema>

export const INITIAL_GLOBAL: AmphoreusGlobal = {
  dataVersion: 1,
  seeded: false,
  suite: { kind: 'none', parsedAt: 0, status: 'missing', degradedReasons: [] },
  prefs: { lastSeat: null, wallpaperCursor: 0, quickPhrases: [], quickPhrasesInitialized: false },
  workbench: { hiddenSessionIds: [] },
}

export const amphoreusDomain = defineDomain({
  name: 'amphoreus',
  version: 1,
  layout: 'single',
  global: { schema: GlobalSchema, initial: INITIAL_GLOBAL },
  tables: {
    seats: domainTable<string, SeatRecord>(SeatSchema),
    bindings: domainTable<string, BindingRecord>(BindingSchema),
    memory: domainTable<string, MemoryRecord>(MemorySchema),
    observations: domainTable<string, ObservationRecord>(ObservationSchema),
    suite_events: domainTable<string, SuiteEventRecord>(SuiteEventSchema),
  },
})

export const amphoreusCanvasDomain = defineDomain({
  name: 'amphoreus_canvas',
  version: 1,
  layout: 'per-record',
  tables: {
    canvas: domainTable<string, CanvasRecord>(CanvasSchema),
  },
})

export type AmphoreusDomain = Domain<typeof amphoreusDomain>
export type AmphoreusCanvasDomain = Domain<typeof amphoreusCanvasDomain>

const globalUpdateQueues = new WeakMap<AmphoreusDomain, Promise<void>>()

/** Serialize global read-modify-write operations so independent features cannot overwrite each other. */
export async function updateAmphoreusGlobal(
  domain: AmphoreusDomain,
  transform: (current: AmphoreusGlobal) => AmphoreusGlobal,
): Promise<AmphoreusGlobal> {
  const previous = globalUpdateQueues.get(domain) ?? Promise.resolve()
  const task = previous.catch(() => {}).then(async () => {
    const next = transform(domain.global.get())
    await domain.global.set(next)
    return next
  })
  globalUpdateQueues.set(domain, task.then(() => {}, () => {}))
  return task
}

export interface AmphoreusStores {
  readonly main: AmphoreusDomain
  readonly canvas: AmphoreusCanvasDomain
  close(): Promise<void>
}

export async function openAmphoreusStores(ctx: Context): Promise<AmphoreusStores> {
  const main = await ctx.storageDomain.open(amphoreusDomain)
  try {
    const canvas = await ctx.storageDomain.open(amphoreusCanvasDomain)
    return {
      main,
      canvas,
      async close() {
        await Promise.all([canvas.close(), main.close()])
      },
    }
  } catch (error) {
    await main.close()
    throw error
  }
}
