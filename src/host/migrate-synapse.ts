import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { updateAmphoreusGlobal, type AmphoreusStores, type CanvasRecord } from './store.ts'

const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const MIN_COORDINATE = -2000
const MAX_COORDINATE = 5000

export interface SynapseWorkspacesV4 {
  version: number
  workspaces: { threads: { dshSessionId: string | null; position?: { x?: unknown; y?: unknown } }[] }[]
}

export interface SynapseMigrationItem {
  sessionId: string
  record: CanvasRecord
}

interface MigrationLogger {
  info(message: string): void
  warn(message: string): void
}

const migrationQueues = new WeakMap<object, Promise<void>>()

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function coordinate(value: number): number {
  return Math.round(Math.max(MIN_COORDINATE, Math.min(MAX_COORDINATE, value)))
}

export function planSynapseMigration(doc: unknown, existing: ReadonlySet<string>): SynapseMigrationItem[] {
  const root = record(doc)
  if (root?.version !== 4 || !Array.isArray(root.workspaces)) return []
  const seen = new Set(existing)
  const plan: SynapseMigrationItem[] = []
  for (const workspaceValue of root.workspaces) {
    const workspace = record(workspaceValue)
    if (!Array.isArray(workspace?.threads)) continue
    for (const threadValue of workspace.threads) {
      const thread = record(threadValue)
      const sessionId = thread?.dshSessionId
      const position = record(thread?.position)
      const x = position?.x
      const y = position?.y
      if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId) || seen.has(sessionId)) continue
      if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) continue
      seen.add(sessionId)
      plan.push({
        sessionId,
        record: {
          positions: { [`${sessionId}:turn-index:0`]: { x: coordinate(x), y: coordinate(y) } },
          collapsed: [],
          branchAnchors: {},
          updatedAt: Date.now(),
        },
      })
    }
  }
  return plan
}

async function markMigration(stores: AmphoreusStores, marker: string): Promise<void> {
  await updateAmphoreusGlobal(stores.main, current => current.synapseMigratedFrom === undefined
    ? { ...current, synapseMigratedFrom: marker }
    : current)
}

async function runSynapseMigration(
  stores: AmphoreusStores,
  dshHome: string,
  logger: MigrationLogger,
): Promise<void> {
  if (stores.main.global.get().synapseMigratedFrom !== undefined) return
  const file = join(dshHome, 'synapse', 'workspaces.json')
  let sourceStat
  try {
    sourceStat = await stat(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const source = await readFile(file, 'utf8')
  const doc: unknown = JSON.parse(source)
  const version = record(doc)?.version
  if (version !== 4) {
    logger.warn(`amphoreus synapse migration: unsupported version ${String(version)}`)
    await markMigration(stores, `${file}@unsupported-v${String(version)}`)
    return
  }

  const table = stores.canvas.table('canvas')
  const existing = new Set([...table.entries()].map(([sessionId]) => sessionId))
  const plan = planSynapseMigration(doc, existing)
  for (const item of plan) await table.put(item.sessionId, item.record)
  await markMigration(stores, `${file}@${sourceStat.mtimeMs}`)
  logger.info(`amphoreus synapse migration: ${plan.length} positions folded`)
}

export async function migrateSynapse(
  stores: AmphoreusStores,
  dshHome: string,
  logger: MigrationLogger,
): Promise<void> {
  const key = stores.main as object
  const previous = migrationQueues.get(key) ?? Promise.resolve()
  const operation = previous.catch(() => {}).then(() => runSynapseMigration(stores, dshHome, logger))
  migrationQueues.set(key, operation.catch(() => {}))
  return operation
}
