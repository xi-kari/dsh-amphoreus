/**
 * Seat preset vocabulary shared by host and client.
 *
 * A "seat preset" is three INDEPENDENT platform tiers stored on the seat record
 * (src/host/store.ts `SeatSchema.preset`): the agent preset (plugin composition,
 * changeable only while the session is blank), the model route (+ optional
 * reasoning effort) and the permission preset name. Each tier is applied through
 * its own platform path; none of them is a property of the others.
 */
import type { SeatRecord } from '../host/store.ts'

export type SeatPreset = NonNullable<SeatRecord['preset']>
export type SeatPresetModel = NonNullable<SeatPreset['model']>

/** Bundle permission table (interaction/permission-presets; base bundle rows). No roster remote exists, so the client offers this fixed list. */
export const SEAT_PERMISSION_PRESETS = ['read-only', 'workspace-write', 'danger-full-access'] as const
export type SeatPermissionPreset = typeof SEAT_PERMISSION_PRESETS[number]

/** True when no tier is set; such a preset is stored as "absent" rather than `{}`. */
export function isEmptySeatPreset(preset: SeatPreset | null | undefined): boolean {
  return preset === null || preset === undefined
    || (preset.agentPreset === undefined && preset.model === undefined && preset.permission === undefined)
}

/** Drop undefined tiers so stored/compared presets have a canonical shape. */
export function normalizeSeatPreset(preset: SeatPreset): SeatPreset {
  return {
    ...(preset.agentPreset === undefined ? {} : { agentPreset: preset.agentPreset }),
    ...(preset.model === undefined ? {} : {
      model: {
        provider: preset.model.provider,
        model: preset.model.model,
        ...(preset.model.reasoningEffort === undefined ? {} : { reasoningEffort: preset.model.reasoningEffort }),
      },
    }),
    ...(preset.permission === undefined ? {} : { permission: preset.permission }),
  }
}
