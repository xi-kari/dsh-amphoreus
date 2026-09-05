/** Pure helpers behind the seat preset panel's selects (no React, no CSS, testable in Node). */
import { isEmptySeatPreset, normalizeSeatPreset, type SeatPreset } from '../shared/seat-preset.ts'

export type SeatPresetTier = 'agentPreset' | 'model' | 'reasoningEffort' | 'permission'

/** Unit separator: never part of a provider route or model id. */
const MODEL_SEPARATOR = ''

/** `provider<US>model` option value; empty string = deployment default. */
export function encodeModelChoice(provider: string, model: string): string {
  return `${provider}${MODEL_SEPARATOR}${model}`
}

export function decodeModelChoice(value: string): { provider: string; model: string } | undefined {
  const index = value.indexOf(MODEL_SEPARATOR)
  if (index <= 0 || index === value.length - 1) return undefined
  return { provider: value.slice(0, index), model: value.slice(index + 1) }
}

/**
 * Apply one select's new value to the stored preset. Changing the model drops
 * the reasoning effort (efforts are per model); an all-default result is `null`
 * so the route clears the field instead of storing `{}`.
 */
export function withTier(current: SeatPreset | undefined, tier: SeatPresetTier, value: string): SeatPreset | null {
  const base: SeatPreset = current === undefined ? {} : normalizeSeatPreset(current)
  let next: SeatPreset
  if (tier === 'agentPreset' || tier === 'permission') {
    const { [tier]: _dropped, ...rest } = base
    next = value === '' ? rest : { ...rest, [tier]: value }
  } else if (tier === 'model') {
    const { model: _dropped, ...rest } = base
    const decoded = decodeModelChoice(value)
    next = decoded === undefined ? rest : { ...rest, model: decoded }
  } else {
    if (base.model === undefined) return isEmptySeatPreset(base) ? null : base
    const { reasoningEffort: _dropped, ...model } = base.model
    next = { ...base, model: value === '' ? model : { ...model, reasoningEffort: value } }
  }
  return isEmptySeatPreset(next) ? null : next
}
