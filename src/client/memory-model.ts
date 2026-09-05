import type { MemoryRecord } from '../host/store.ts'
import type { MemoryPublicConfig, MemorySettings } from '../shared/api.ts'

/** Same merge the host applies: config defaults under the seat record's overrides. */
export function effectiveSeatMemory(config: MemoryPublicConfig, record: MemoryRecord | undefined): MemorySettings {
  return {
    inject: record?.settings?.inject ?? config.inject,
    autoNote: record?.settings?.autoNote ?? config.autoNote,
    injectLimit: record?.settings?.injectLimit ?? config.injectLimit,
  }
}

/** Length in code points (what the host clamps by), not UTF-16 units. */
export function countPoints(text: string): number {
  return [...text].length
}
