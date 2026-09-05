/**
 * Apply a seat's preset tiers to a freshly created (blank) seat session.
 *
 * Pure: every platform face is injected, so the module never sees ctx. The three
 * tiers are independent platform mechanisms and each one degrades on its own:
 *
 * - agent preset → `remote.agentPresets.select(sessionId, id)`; legal only while
 *   the session is blank ('agent-preset/locked' otherwise). Locked / unavailable
 *   are silent; a missing or broken preset falls back to the deployment default
 *   with a warning (the session is still created).
 * - model → `remote.session.selectModel(...)`. The platform ALSO rewrites the
 *   deployment default model (settings namespace 'agent-default-model'); we read
 *   the default from `modelCatalog().default` first and write it back through
 *   `remote.settings.replace` afterwards when that face is attached.
 * - permission → applied host-side (src/host/seat-permission.ts); nothing here.
 */
import type { SeatPreset, SeatPresetModel } from '../shared/seat-preset.ts'

export type SeatPresetRemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

export interface SeatPresetRosterRow {
  readonly id: string
  readonly isDefault: boolean
  readonly name?: string
}

export interface SeatPresetCatalogEffort { readonly id: string; readonly name: string }

export interface SeatPresetCatalogModel {
  readonly id: string
  readonly name: string
  readonly reasoning?: { readonly efforts: readonly SeatPresetCatalogEffort[]; readonly defaultEffort?: string }
}

export interface SeatPresetCatalogGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly SeatPresetCatalogModel[]
}

export interface SeatPresetCatalog {
  readonly default: SeatPresetModel
  readonly groups: readonly SeatPresetCatalogGroup[]
}

/** Platform directory the settings panel reads (injected as plain callbacks, never ctx). */
export interface SeatPresetDirectory {
  listAgentPresets(): Promise<readonly SeatPresetRosterRow[]>
  modelCatalog(): Promise<SeatPresetCatalog | undefined>
  /** Whether the deployment default model can be restored after a per-seat model lands. */
  canRestoreDefaultModel(): boolean
}

export interface SeatPresetApplyDeps {
  readonly presetOf: (skillName: string) => SeatPreset | undefined
  readonly selectModel: (request: SeatPresetModel & { readonly sessionId: string }) => Promise<SeatPresetRemoteResult<unknown>>
  readonly modelCatalog: () => Promise<SeatPresetRemoteResult<SeatPresetCatalog>>
  readonly warn?: (message: string) => void
}

/** Optional faces that arrive (and leave) with `ctx.inject` scopes. */
export interface SeatPresetOptionalFaces {
  readonly selectAgentPreset?: (sessionId: string, agentPreset: string) => Promise<SeatPresetRemoteResult<string>>
  readonly listAgentPresets?: () => Promise<SeatPresetRemoteResult<{
    readonly presets: readonly { readonly id: string; readonly isDefault: boolean; readonly name?: string; readonly broken?: string }[]
  }>>
  readonly restoreDefaultModel?: (selection: SeatPresetModel) => Promise<SeatPresetRemoteResult<unknown>>
}

export interface SeatPresetApplier extends SeatPresetDirectory {
  /** `SeatActionDeps.applySeatPreset` shape: applies the seat's stored tiers, never throws on a refusal. */
  apply(sessionId: string, skillName: string): Promise<void>
  /** Attach optional faces; returns the detacher (for `scope.effect`). */
  attach(faces: SeatPresetOptionalFaces): () => void
}

const UNAVAILABLE = 'gateway/invocation-unavailable'

export function sameModelSelection(left: SeatPresetModel | undefined, right: SeatPresetModel | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.provider === right.provider && left.model === right.model
    && (left.reasoningEffort ?? undefined) === (right.reasoningEffort ?? undefined)
}

export function createSeatPresetApplier(deps: SeatPresetApplyDeps): SeatPresetApplier {
  const warn = deps.warn ?? ((message: string) => { console.warn(message) })
  let faces: SeatPresetOptionalFaces = {}

  const applyAgentPreset = async (sessionId: string, agentPreset: string): Promise<void> => {
    const select = faces.selectAgentPreset
    if (select === undefined) return
    const result = await select(sessionId, agentPreset)
    if (result.ok) return
    if (result.error.code === 'agent-preset/locked' || result.error.code === UNAVAILABLE) return
    warn(`amphoreus seat preset: agent preset "${agentPreset}" not applied (${result.error.code}): ${result.error.message}`)
  }

  const applyModel = async (sessionId: string, model: SeatPresetModel): Promise<void> => {
    let previousDefault: SeatPresetModel | undefined
    const restore = faces.restoreDefaultModel
    if (restore !== undefined) {
      const catalog = await deps.modelCatalog()
      if (catalog.ok) previousDefault = catalog.value.default
      else if (catalog.error.code !== UNAVAILABLE) warn(`amphoreus seat preset: model catalog unavailable (${catalog.error.code}); the deployment default model cannot be restored`)
    }
    const selected = await deps.selectModel({
      sessionId,
      provider: model.provider,
      model: model.model,
      ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }),
    })
    if (!selected.ok) {
      if (selected.error.code !== UNAVAILABLE) warn(`amphoreus seat preset: model ${model.provider}/${model.model} not applied (${selected.error.code}): ${selected.error.message}`)
      return
    }
    if (restore === undefined) {
      warn(`amphoreus seat preset: model ${model.provider}/${model.model} applied; the platform also made it the deployment default (no settings face to restore it)`)
      return
    }
    if (previousDefault === undefined || sameModelSelection(previousDefault, model)) return
    const restored = await restore(previousDefault)
    if (!restored.ok) warn(`amphoreus seat preset: deployment default model could not be restored to ${previousDefault.provider}/${previousDefault.model} (${restored.error.code}): ${restored.error.message}`)
  }

  return {
    async apply(sessionId, skillName) {
      const preset = deps.presetOf(skillName)
      if (preset === undefined) return
      if (preset.agentPreset !== undefined) await applyAgentPreset(sessionId, preset.agentPreset)
      if (preset.model !== undefined) await applyModel(sessionId, preset.model)
    },
    attach(next) {
      faces = { ...faces, ...next }
      return () => {
        const remaining: Record<string, unknown> = { ...faces }
        for (const [key, value] of Object.entries(next)) if (remaining[key] === value) delete remaining[key]
        faces = remaining as SeatPresetOptionalFaces
      }
    },
    canRestoreDefaultModel() {
      return faces.restoreDefaultModel !== undefined
    },
    async listAgentPresets() {
      const list = faces.listAgentPresets
      if (list === undefined) return []
      const result = await list()
      if (!result.ok) {
        if (result.error.code !== UNAVAILABLE) warn(`amphoreus seat preset: agent preset roster failed (${result.error.code}): ${result.error.message}`)
        return []
      }
      return result.value.presets
        .filter(row => row.broken === undefined)
        .map(row => ({ id: row.id, isDefault: row.isDefault, ...(row.name === undefined ? {} : { name: row.name }) }))
    },
    async modelCatalog() {
      const result = await deps.modelCatalog()
      if (!result.ok) {
        if (result.error.code !== UNAVAILABLE) warn(`amphoreus seat preset: model catalog failed (${result.error.code}): ${result.error.message}`)
        return undefined
      }
      return {
        default: result.value.default,
        groups: result.value.groups.map(group => ({
          id: group.id,
          name: group.name,
          models: group.models.map(model => ({
            id: model.id,
            name: model.name,
            ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
          })),
        })),
      }
    },
  }
}
